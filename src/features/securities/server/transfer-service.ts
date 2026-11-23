import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { today } from "@/lib/time";
import { syncLease, withLease } from "@/server/jobs/lease";
import { archivedAccountMessage } from "@/features/transactions/server/booking-accounts";
import { parseMicros } from "../quantities";
import { checkSecurityChange } from "./security-history";
import { findBrokerageAccount, findSecurity, nextTradeSequence, withSecurityTransaction } from "./security-repository";
import { transferCorrectionInput, transferInput } from "./security-schema";
import { deleteTransfer, findTransfer, insertTransfer, saveTransferCorrection } from "./transfer-repository";

function notFuture(date: string, now: Temporal.Instant) {
  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(date), today(now)) > 0) {
    throw new ValidationError("The transfer date cannot be in the future.");
  }
}

/**
 * Moves a quantity of a security from one brokerage account to another without a sale: the receiving account takes over the moved part's cost basis, and neither account realizes a gain.
 * Holds the sync lease like trades, and refuses a transfer beyond the quantity held then, or one that would leave a later sale or transfer of either account uncovered.
 */
export async function recordTransfer(fromAccountId: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = transferInput.parse(payload);

  notFuture(input.date, now);

  if (input.to_account_id === fromAccountId) {
    throw new ValidationError("Choose another brokerage account to receive the transfer.");
  }

  const quantity = parseMicros(input.quantity, "quantity");
  const id = randomUUID();

  return withLease(syncLease, "A sync is running. Record the transfer after it has finished.", () => withSecurityTransaction(async tx => {
    const from = await findBrokerageAccount(tx, fromAccountId);

    if (!from) {
      throw new HttpError(404, "Brokerage account not found.");
    }

    const to = await findBrokerageAccount(tx, input.to_account_id);

    if (!to) {
      throw new ValidationError("Choose a brokerage account to receive the transfer.");
    }

    if (from.archived_at !== null || to.archived_at !== null) {
      throw new HttpError(409, archivedAccountMessage);
    }

    const security = await findSecurity(tx, input.security_id);

    if (!security) {
      throw new ValidationError("Security does not exist.");
    }

    // Cost basis is never converted between currencies.
    if (to.currency !== security.currency || from.currency !== security.currency) {
      throw new ValidationError("Both brokerage accounts must use the security's currency.");
    }

    const transfer = {
      id,
      security_id: security.id,
      from_account_id: from.id,
      to_account_id: to.id,
      date: input.date,
      from_sequence: await nextTradeSequence(tx, from.id),
      to_sequence: await nextTradeSequence(tx, to.id),
      quantity_micros: quantity
    };

    await checkSecurityChange(tx, security.id, legs => [...legs, ...transferLegs(transfer)]);
    await insertTransfer(tx, transfer);

    return {
      id
    };
  }));
}

function transferLegs(transfer: {
  id: string;
  from_account_id: string;
  to_account_id: string;
  date: string;
  from_sequence: number;
  to_sequence: number;
  quantity_micros: number;
}) {
  const leg = {
    date: transfer.date,
    quantity_micros: transfer.quantity_micros,
    gross_minor: 0,
    fee_minor: 0,
    transfer_id: transfer.id
  };

  return [{
    ...leg,
    account_id: transfer.from_account_id,
    side: "transfer_out" as const,
    sequence: transfer.from_sequence
  }, {
    ...leg,
    account_id: transfer.to_account_id,
    side: "transfer_in" as const,
    sequence: transfer.to_sequence
  }];
}

async function requireTransfer(tx: Parameters<Parameters<typeof withSecurityTransaction>[0]>[0], id: string) {
  const transfer = await findTransfer(tx, id);

  if (!transfer) {
    throw new HttpError(404, "Transfer not found.");
  }

  for (const accountId of [transfer.from_account_id, transfer.to_account_id]) {
    const account = await findBrokerageAccount(tx, accountId);

    if (!account || account.archived_at !== null) {
      throw new HttpError(409, archivedAccountMessage);
    }
  }

  return transfer;
}

/** Corrects a transfer's date and quantity; both accounts' histories are replayed again. */
export async function correctTransfer(id: string, payload: unknown, now = Temporal.Now.instant()) {
  const input = transferCorrectionInput.parse(payload);

  notFuture(input.date, now);

  const quantity = parseMicros(input.quantity, "quantity");

  await withLease(syncLease, "A sync is running. Change the transfer after it has finished.", () => withSecurityTransaction(async tx => {
    const transfer = await requireTransfer(tx, id);
    const corrected = {
      ...transfer,
      date: input.date,
      quantity_micros: quantity
    };

    await checkSecurityChange(tx, transfer.security_id, legs => [...legs.filter(leg => leg.transfer_id !== id), ...transferLegs(corrected)]);
    await saveTransferCorrection(tx, id, {
      date: input.date,
      quantity_micros: quantity
    });
  }));

  return {
    ok: true
  };
}

/** Removes a transfer, unless the receiving account later sold or sent on what it received. */
export async function removeTransfer(id: string) {
  await withLease(syncLease, "A sync is running. Delete the transfer after it has finished.", () => withSecurityTransaction(async tx => {
    const transfer = await requireTransfer(tx, id);

    await checkSecurityChange(tx, transfer.security_id, legs => legs.filter(leg => leg.transfer_id !== id));
    await deleteTransfer(tx, id);
  }));

  return {
    ok: true
  };
}
