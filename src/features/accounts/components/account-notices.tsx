"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./account-summary.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import { ArrowRight, RefreshCw, TriangleAlert } from "lucide-react";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { DateValue, TimestampValue } from "@/components/ui/date-value";
import { FormError } from "@/components/ui/form-error";
import { money } from "@/lib/money";
import { useReconcileBalance } from "@/features/accounts/mutations";
import { bankConnectionsHref } from "@/features/banking/connections-location";
import type { AccountProblem } from "@/features/accounts/account-presentation";
import type { Account } from "@/features/accounts/types";
import type { Connection } from "@/features/banking/types";

/** A problem that stops syncing, with reconnecting as its one action; without a known connection the action leads to the bank connections. */
export function ProblemNotice({
  problem,
  connection,
  reconnect
}: {
  problem: AccountProblem;
  connection: Connection | null;
  reconnect: () => void;
}) {
  return (
    <div className={clsx(ui["notice"], ui["error"], styles["notice"])} role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div className={styles["notice-body"]}>
        <p>
          {problem.kind === "expired" ? (
            <>The bank authorization expired on <TimestampValue value={problem.since} />. Reconnect the bank to continue syncing.</>
          ) : (
            <>The last sync failed: {problem.message}</>
          )}
        </p>
        {connection ? (
          <button type="button" className={ui["button"]} onClick={reconnect}>
            <RefreshCw size={15} aria-hidden="true" />
            Reconnect bank
          </button>
        ) : (
          <Link className={ui["button"]} href={bankConnectionsHref}>
            Manage bank connections <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}

/** The bank's booked balance differs from the bookings up to its date; booking the difference as an adjustment on that date resolves it. */
export function BalanceMismatchNotice({
  account,
  difference
}: {
  account: Account;
  difference: number;
}) {
  const locale = useLocale();
  const reconcile = useReconcileBalance(account.id);
  const reported = account.reported_balance_minor ?? 0;

  return (
    <div className={clsx(ui["notice"], ui["warning"], styles["notice"])} role="status">
      <TriangleAlert size={18} aria-hidden="true" />
      <div className={styles["notice-body"]}>
        <p>
          The bank reports {money(reported, account.currency, locale)} on <DateValue value={account.reported_balance_date} />, but the bookings up to that day add up to {money(reported - difference, account.currency, locale)}.
        </p>
        <button
          type="button"
          className={ui["button"]}
          disabled={reconcile.isPending}
          onClick={() => reconcile.mutate()}
        >
          Book {money(difference, account.currency, locale)} adjustment
        </button>
        <FormError failure={reconcile.error ? toFailure(reconcile.error) : null} />
      </div>
    </div>
  );
}
