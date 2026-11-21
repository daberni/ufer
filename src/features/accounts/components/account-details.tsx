"use client";

import ui from "../../../components/ui/primitives.module.css";
import contextStyles from "./account-context.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./account-details.module.css";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { BalanceHistoryPanel } from "./balance-history";
import { AccountSummary, AccountSummarySkeleton } from "./account-summary";
import type { Area } from "@/components/ui/use-area-result";
import type { Account, BalanceHistory } from "@/features/accounts/types";
import type { Connection } from "@/features/banking/types";

/** Where an account's details return to: the list they were opened from. */
export type BackLink = {
  href: string;
  label: string;
};

type Props = {
  account: Area<Account>;
  back: BackLink;
  /** Bank connections; a synced account offers to reauthorize its own. */
  connections: Area<Connection[]>;
  history: Area<BalanceHistory>;
};

/** An account's summary beside its balance history. */
export function AccountDetails({
  account,
  back,
  connections,
  history
}: Props) {
  return (
    <>
      <BackNavigation back={back} />
      <div className={styles["details-grid"]}>
        {account.status === "pending" ? (
          <AreaPlaceholder area={account} subject="This account">
            <AccountSummarySkeleton />
          </AreaPlaceholder>
        ) : <AccountSummary account={account.data} connections={connections.data ?? []} />}
        <BalanceHistoryPanel history={history} />
      </div>
    </>
  );
}

function BackNavigation({ back }: {
  back: BackLink
}) {
  return (
    <nav className={contextStyles["context-row"]} aria-label="Back">
      <Link className={clsx(contextStyles["back-link"], ui["text-button"])} href={back.href}>
        <ArrowLeft size={15} />
        {back.label}
      </Link>
    </nav>
  );
}

/** Shown for an id that is unknown or removed. */
export function AccountNotFound({ back }: {
  back: BackLink
}) {
  return (
    <>
      <BackNavigation back={back} />
      <section className={ui["panel"]}>
        <Empty
          title="This account is not available"
          action={(
            <Link className={clsx(ui["button"], ui["primary"])} href={back.href}>
              {back.label} <ArrowRight size={15} />
            </Link>
          )}
        >
          It may have been removed, or the link belongs to another installation.
        </Empty>
      </section>
    </>
  );
}
