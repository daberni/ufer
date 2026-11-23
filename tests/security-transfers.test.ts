import assert from "node:assert/strict";
import { test } from "node:test";
import type { Database } from "../src/server/database/connection";
import * as schema from "../src/server/database/schema";
import { archiveAccount, deleteAccount } from "../src/features/accounts/server/account-service";
import { correctTrade, readBrokeragePerformance, readBrokerageTrades, readCombinedBrokeragePerformance, removeTrade } from "../src/features/securities/server/security-service";
import { correctTransfer, recordTransfer, removeTransfer } from "../src/features/securities/server/transfer-service";
import { ValidationError } from "../src/lib/errors";
import { depot, isolatedDatabase, now, rejectsWith, security, settlementAccount, trade } from "./fixtures/brokerage";

async function price(db: Database, securityId: string, date: string, close: number) {
  await db.insert(schema.securityPrices).values({
    security_id: securityId,
    date,
    close_micros: close * 1_000_000,
    source: "test",
    fetched_at: `${date}T20:00:00.000Z`
  });
}

async function setup(context: Parameters<typeof isolatedDatabase>[0]) {
  const db = await isolatedDatabase(context);
  const cash = await settlementAccount();
  const sender = await depot();
  const receiver = await depot();
  const etf = await security();

  function record(account: string, date: string, side: "buy" | "sell", quantity: string, unitPrice: string, fee = "0") {
    return trade(account, {
      security_id: etf,
      date,
      side,
      quantity,
      price: unitPrice,
      fee,
      settlement: {
        account_id: cash
      }
    });
  }

  function transfer(date: string, quantity: string, from = sender, to = receiver) {
    return recordTransfer(from, {
      security_id: etf,
      to_account_id: to,
      date,
      quantity
    }, now);
  }

  return {
    db,
    sender,
    receiver,
    etf,
    record,
    transfer
  };
}

async function holdingOf(accountId: string) {
  const holding = (await readBrokerageTrades(accountId, now)).valuation.holdings[0];

  return holding ? [holding.quantity_micros / 1_000_000, holding.cost_minor, holding.realized_minor] : null;
}

test("a partial transfer carries the moving-average cost of the moved part and realizes nothing in either account", async context => {
  const {
    sender,
    receiver,
    record,
    transfer
  } = await setup(context);

  await record(sender, "2026-09-01", "buy", "10", "100", "5");
  await record(sender, "2026-09-15", "buy", "10", "120", "5");
  await transfer("2026-10-01", "5");

  // 20 shares cost 2210.00, so 110.50 each; 5 move for 552.50.
  assert.deepEqual(await holdingOf(sender), [15, 1657_50, 0]);
  assert.deepEqual(await holdingOf(receiver), [5, 552_50, 0]);

  const sent = (await readBrokerageTrades(sender, now)).trades.at(-1);
  const received = (await readBrokerageTrades(receiver, now)).trades;

  assert.equal(sent?.side, "transfer_out");
  assert.equal(sent?.gross_minor, 552_50);
  assert.equal(sent?.realized_minor, null);
  assert.equal(sent?.transfer?.counterpart_account_id, receiver);
  assert.equal(received.length, 1);
  assert.equal(received[0]?.side, "transfer_in");
  assert.equal(received[0]?.price_micros, 110_500_000);
  assert.equal(received[0]?.transfer?.counterpart_account_id, sender);
});

test("a full transfer closes the sending holding, and a later sale in the receiving account gains against the original cost", async context => {
  const {
    sender,
    receiver,
    record,
    transfer
  } = await setup(context);

  await record(sender, "2026-09-01", "buy", "10", "100", "5");
  await transfer("2026-10-01", "10");
  await record(receiver, "2026-10-10", "sell", "4", "130", "2");

  assert.deepEqual(await holdingOf(sender), [0, 0, 0]);
  // 4 of 10 shares bought for 1005.00 cost 402.00; the sale receives 520.00 less 2.00.
  assert.deepEqual(await holdingOf(receiver), [6, 603_00, 116_00]);

  const sale = (await readBrokerageTrades(receiver, now)).trades.at(-1);

  assert.equal(sale?.realized_minor, 116_00);
});

test("a correction of an earlier buy carries through the transfer into the receiving account", async context => {
  const {
    sender,
    receiver,
    record,
    transfer
  } = await setup(context);
  const { id } = await record(sender, "2026-09-01", "buy", "10", "100");

  await transfer("2026-10-01", "10");
  await correctTrade(id, {
    date: "2026-09-01",
    quantity: "10",
    price: "90"
  }, now);

  assert.deepEqual(await holdingOf(receiver), [10, 900_00, 0]);
});

test("transfers never exceed what an account held, now or after a later change", async context => {
  const {
    sender,
    receiver,
    record,
    transfer
  } = await setup(context);
  const { id: buy } = await record(sender, "2026-09-01", "buy", "10", "100");

  await assert.rejects(transfer("2026-10-01", "11"), ValidationError);
  await assert.rejects(transfer("2026-08-31", "1"), ValidationError);

  const { id } = await transfer("2026-10-01", "10");

  await record(receiver, "2026-10-10", "sell", "10", "120");

  // Each change would leave the receiving account's sale uncovered.
  await assert.rejects(removeTransfer(id), ValidationError);
  await assert.rejects(correctTransfer(id, {
    date: "2026-10-01",
    quantity: "5"
  }, now), ValidationError);
  await assert.rejects(correctTransfer(id, {
    date: "2026-10-11",
    quantity: "10"
  }, now), ValidationError);
  await assert.rejects(removeTrade(buy), ValidationError);
  await assert.rejects(recordTransfer(sender, {
    security_id: "missing",
    to_account_id: sender,
    date: "2026-10-01",
    quantity: "1"
  }, now), ValidationError);
});

test("a transfer can be corrected and removed, restoring both holdings", async context => {
  const {
    sender,
    receiver,
    record,
    transfer
  } = await setup(context);

  await record(sender, "2026-09-01", "buy", "10", "100");

  const { id } = await transfer("2026-10-01", "4");

  await correctTransfer(id, {
    date: "2026-10-02",
    quantity: "6"
  }, now);

  assert.deepEqual(await holdingOf(sender), [4, 400_00, 0]);
  assert.deepEqual(await holdingOf(receiver), [6, 600_00, 0]);
  assert.equal((await readBrokerageTrades(receiver, now)).trades[0]?.date, "2026-10-02");

  await removeTransfer(id);

  assert.deepEqual(await holdingOf(sender), [10, 1000_00, 0]);
  assert.equal(await holdingOf(receiver), null);
  assert.deepEqual((await readBrokerageTrades(receiver, now)).trades, []);
});

test("time-weighted performance treats a transfer as each account's external flow and leaves the combined series unchanged", async context => {
  const {
    db,
    sender,
    receiver,
    etf,
    record,
    transfer
  } = await setup(context);

  await price(db, etf, "2026-09-01", 100);
  await price(db, etf, "2026-10-01", 110);
  await price(db, etf, "2026-10-15", 121);
  await record(sender, "2026-09-01", "buy", "10", "100");

  const before = await readCombinedBrokeragePerformance(now);

  await transfer("2026-10-01", "10");

  const sending = (await readBrokeragePerformance(sender, now)).points;
  const receiving = (await readBrokeragePerformance(receiver, now)).points;
  const growthOn = (points: typeof sending, date: string) => Math.round(points.findLast(point => point.date <= date)!.growth * 10_000) / 10_000;

  // The sender earned 10% until it sent the holding at 1100.00 and nothing after.
  assert.equal(growthOn(sending, "2026-10-01"), 1.1);
  assert.equal(growthOn(sending, "2026-10-31"), 1.1);
  assert.equal(sending.at(-1)?.value_minor, 0);
  // The receiver starts at the moved value, so only the later 10% counts.
  assert.equal(growthOn(receiving, "2026-10-01"), 1);
  assert.equal(growthOn(receiving, "2026-10-31"), 1.1);
  assert.equal(receiving.find(point => point.date === "2026-10-01")?.invested_minor, 1100_00);
  assert.deepEqual((await readCombinedBrokeragePerformance(now)).currencies[0]?.points, before.currencies[0]?.points);
});

test("transfers chain through several accounts and block archiving and deleting a receiving account", async context => {
  const {
    sender,
    receiver,
    record,
    transfer
  } = await setup(context);
  const third = await depot();

  await record(sender, "2026-09-01", "buy", "10", "100", "10");
  await transfer("2026-10-01", "10");
  await transfer("2026-10-05", "5", receiver, third);

  assert.deepEqual(await holdingOf(third), [5, 505_00, 0]);
  await rejectsWith(archiveAccount(receiver, {}, now), 409);
  await rejectsWith(deleteAccount(sender, {
    name: "Synthetic depot"
  }), 409);
});
