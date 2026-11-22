"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./overview-accounts.module.css";
import { ArrowRight, Landmark, Plus } from "lucide-react";
import { accountIcon, kinds } from "@/features/accounts/account-presentation";
import { AccountSourceStatus } from "./account-source-status";
import { DateValue } from "@/components/ui/date-value";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { money } from "@/lib/money";
import type { Account } from "@/features/accounts/types";
import { recentlyBookedAccounts } from "@/features/accounts/recent-accounts";
import { useState } from "react";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import { CreateAccountDialog } from "./create-account-form";
import { useAccountHref, useChangeView } from "@/client/use-app-url";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { shownStatus, valueMask } from "@/components/ui/result-presentation";
import type { Area, PendingArea } from "@/components/ui/use-area-result";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

type Props = {
  /** Accounts in the display currency. */
  currencyAccounts: Area<Account[]>;
};

type OpenDialog = {
  kind: "account";
} | {
  kind: "bank";
};

// Three rows keep the panel about as tall as the net-worth card; the heading links to all accounts.
const shownRows = 3;

const placeholderAccount = {
  provider: "manual",
  institution: null,
  requisition_id: null,
  last_synced_at: null,
  valid_until: null,
  sync_error: null,
  archived_at: null
};

export function OverviewAccounts({ currencyAccounts }: Props) {
  const locale = useLocale();
  const changeView = useChangeView();

  return (
    <section className={styles["accounts-section"]}>
      <div className={styles["section-heading"]}>
        <h2>
          Your accounts <span className={clsx(ui["count-badge"], valueMask(shownStatus(currencyAccounts)))}>{formatCount(currencyAccounts.data?.length ?? 0, locale)}</span>
        </h2>
        <button className={ui["text-button"]} onClick={() => changeView("accounts")}>
          Manage all <ArrowRight size={15} />
        </button>
      </div>
      {currencyAccounts.status === "pending" ? <AccountStripSkeleton area={currencyAccounts} /> : <AccountStrip currencyAccounts={currencyAccounts.data} />}
    </section>
  );
}

// The skeleton repeats a loaded row's elements, including the source indicator, so each row keeps its final height.
function AccountStripSkeleton({ area }: {
  area: PendingArea
}) {
  return (
    <AreaPlaceholder area={area} subject="Your accounts">
      <div className={styles["account-strip"]}>
        {Array.from({
          length: shownRows
        }, (_, index) => (
          <div className={styles["account-tile"]} key={index}>
            <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
            <span className={styles["account-tile-name"]}>
              <span className={ui["skeleton"]}>Everyday account</span>
            </span>
            <strong>
              <span className={ui["skeleton"]}>€0,000.00</span>
            </strong>
            <span className={clsx(styles["account-tile-meta"], ui["skeleton"])}>
              <span className={styles["account-tile-kind"]}>Bank account</span>
              <span className={styles["account-tile-separator"]} aria-hidden="true">·</span>
              <AccountSourceStatus account={placeholderAccount} />
            </span>
            <span className={styles["account-tile-date"]}>
              <span className={ui["skeleton"]}>Today</span>
            </span>
          </div>
        ))}
      </div>
    </AreaPlaceholder>
  );
}

function AccountStrip({ currencyAccounts }: {
  currencyAccounts: Account[]
}) {
  const locale = useLocale();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const accountHref = useAccountHref();
  const sandbox = useBankingConfiguration().environment === "SANDBOX";

  const content = currencyAccounts.length ? (
    <div className={styles["account-strip"]}>
      {recentlyBookedAccounts(currencyAccounts, shownRows).map(account => {
        const Icon = accountIcon(account.kind);

        return (
          <Link className={styles["account-tile"]} key={account.id} href={accountHref(account.id)}>
            <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
              <Icon size={21} />
            </span>
            <span className={styles["account-tile-name"]}>{account.name}</span>
            <strong>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency, locale)}</strong>
            <span className={styles["account-tile-meta"]}>
              <span className={styles["account-tile-kind"]}>{kinds[account.kind] ?? account.kind}</span>
              {/* A manual account's status starts with its own dot, so a separator would repeat it. */}
              {account.provider !== "manual" && <span className={styles["account-tile-separator"]} aria-hidden="true">·</span>}
              <AccountSourceStatus account={account} />
            </span>
            <span className={styles["account-tile-date"]}>
              <DateValue value={account.balance_date} fallback="No balance yet" />
            </span>
          </Link>
        );
      })}
    </div>
  ) : (
    <div className={styles["onboarding"]}>
      <span className={styles["onboarding-icon"]}>
        <Landmark size={27} />
      </span>
      <div>
        <h3>Your overview starts with your first account.</h3>
        <p>{sandbox ? "Connect a sandbox bank" : "Connect your bank"}, or manually add accounts, investments, property and debts.</p>
      </div>
      <button
        className={clsx(styles["button"], ui["primary"])}
        onClick={() => setDialog({
          kind: "bank"
        })}
      >
        <Plus size={15} />
        Connect bank
      </button>
      <button
        className={styles["button"]}
        onClick={() => setDialog({
          kind: "account"
        })}
      >
        Add manually
      </button>
    </div>
  );

  return (
    <>
      {content}
      {dialog?.kind === "account" && <CreateAccountDialog close={closeDialog} />}
      {dialog?.kind === "bank" && <BankConnectionDialog connection={null} close={closeDialog} />}
    </>
  );
}
