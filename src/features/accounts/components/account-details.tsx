"use client";

import ui from "../../../components/ui/primitives.module.css";
import contextStyles from "./account-context.module.css";

import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import Link from "next/link";
import styles from "./account-details.module.css";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { BalanceHistoryPanel } from "./balance-history";
import { PerformancePanel } from "@/features/securities/components/performance-panel";
import { AccountSummary, AccountSummarySkeleton } from "./account-summary";
import { FileDropArea } from "@/features/imports/components/file-drop-area";
import { acceptsFileImport } from "@/features/accounts/queries";
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
  const t = useTranslations("accounts.details");
  const tiles = (
    <>
      {account.status === "pending" ? (
        <AreaPlaceholder area={account} failureTitle={t("failure")}>
          <AccountSummarySkeleton />
        </AreaPlaceholder>
      ) : <AccountSummary account={account.data} connections={connections.data ?? []} />}
      {/* A brokerage account's value says little about how it performed, so it shows its return instead. */}
      {account.status !== "pending" && account.data.kind === "brokerage" ? <PerformancePanel accountId={account.data.id} /> : <BalanceHistoryPanel history={history} />}
    </>
  );
  const importTarget = account.status !== "pending" && acceptsFileImport(account.data) ? account.data.id : null;

  return (
    <>
      <BackNavigation back={back} />
      {importTarget ? (
        <FileDropArea accountId={importTarget} className={styles["details-grid"]}>{tiles}</FileDropArea>
      ) : (
        <div className={styles["details-grid"]}>{tiles}</div>
      )}
    </>
  );
}

export function BackNavigation({ back }: {
  back: BackLink
}) {
  const t = useTranslations("accounts.details");

  return (
    <nav className={contextStyles["context-row"]} aria-label={t("back")}>
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
  const t = useTranslations("accounts.details");

  return (
    <>
      <BackNavigation back={back} />
      <section className={ui["panel"]}>
        <Empty
          title={t("notFoundTitle")}
          action={(
            <Link className={clsx(ui["button"], ui["primary"])} href={back.href}>
              {back.label} <ArrowRight size={15} />
            </Link>
          )}
        >
          {t("notFoundBody")}
        </Empty>
      </section>
    </>
  );
}
