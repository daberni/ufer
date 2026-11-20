"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./overview-accounts.module.css";
import { ArrowRight, Landmark, Plus } from "lucide-react";
import { accountIcon, kinds } from "@/features/accounts/account-presentation";
import { AccountSourceIndicator } from "./account-source-indicator";
import { DateValue } from "@/components/ui/date-value";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { money } from "@/lib/money";
import type { Account } from "@/features/accounts/types";
import { useState } from "react";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import { CreateAccountDialog } from "./create-account-form";
import { useAccountHref, useChangeView } from "@/client/use-app-url";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { shownStatus, valueMask } from "@/components/ui/result-presentation";
import type { Area, PendingArea } from "@/components/ui/use-area-result";

type Props = {
  /** Accounts in the display currency. */
  currencyAccounts: Area<Account[]>;
};

type OpenDialog = {
  kind: "account";
} | {
  kind: "bank";
};

const shownTiles = 5;

export function OverviewAccounts({ currencyAccounts }: Props) {
  const changeView = useChangeView();

  return (
    <section className={styles["accounts-section"]}>
      <div className={styles["section-heading"]}>
        <h2>
          Your accounts <span className={clsx(styles["count-badge"], valueMask(shownStatus(currencyAccounts)))}>{currencyAccounts.data?.length ?? 0}</span>
        </h2>
        <button className={ui["text-button"]} onClick={() => changeView("accounts")}>
          Manage all <ArrowRight size={15} />
        </button>
      </div>
      {currencyAccounts.status === "pending" ? <AccountStripSkeleton area={currencyAccounts} /> : <AccountStrip currencyAccounts={currencyAccounts.data} />}
    </section>
  );
}

function AccountStripSkeleton({ area }: {
  area: PendingArea
}) {
  return (
    <AreaPlaceholder area={area} subject="Your accounts">
      <div className={styles["account-strip"]}>
        {Array.from({
          length: shownTiles
        }, (_, index) => (
          <div className={styles["account-tile"]} key={index}>
            <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
            <span className={styles["account-tile-name"]}>
              <span className={ui["skeleton"]}>Everyday account</span>
            </span>
            <strong>
              <span className={ui["skeleton"]}>€0,000.00</span>
            </strong>
            <span className={styles["account-tile-meta"]}>
              <span className={ui["skeleton"]}>Bank account · Bank</span>
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

// The largest balances, whatever their sign, keep the panel about as tall as the net-worth card; the heading links to all accounts.
function largestAccounts(accounts: Account[]) {
  return accounts.toSorted((left, right) => Math.abs(right.balance_minor ?? 0) - Math.abs(left.balance_minor ?? 0)).slice(0, shownTiles);
}

function AccountStrip({ currencyAccounts }: {
  currencyAccounts: Account[]
}) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const accountHref = useAccountHref();
  const sandbox = useBankingConfiguration().environment === "SANDBOX";

  const content = currencyAccounts.length ? (
    <div className={styles["account-strip"]}>
      {largestAccounts(currencyAccounts).map(account => {
        const Icon = accountIcon(account.kind);

        return (
          <Link className={styles["account-tile"]} key={account.id} href={accountHref(account.id)}>
            <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
              <Icon size={21} />
            </span>
            <span className={styles["account-tile-name"]}>{account.name}</span>
            <strong>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency)}</strong>
            <span className={styles["account-tile-meta"]}>
              <span className={styles["account-tile-kind"]}>{kinds[account.kind]} · {account.institution}</span>
              <AccountSourceIndicator account={account} />
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
