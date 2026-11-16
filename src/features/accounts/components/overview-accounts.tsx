"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import styles from "./overview-accounts.module.css";
import { ArrowRight, Landmark, Plus } from "lucide-react";
import { accountIcon, kinds, accountSyncLabel } from "@/features/accounts/account-presentation";
import { DateValue } from "@/components/ui/date-value";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { money } from "@/lib/money";
import type { Account } from "@/features/accounts/types";
import { useState } from "react";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import { CreateAccountDialog } from "./create-account-form";
import { ValuationDialog } from "./valuation-form";
import { useChangeView } from "@/client/use-app-url";
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
} | {
  kind: "balance";
  account: Account;
};

const shownTiles = 4;

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
              <small>
                <span className={ui["skeleton"]}>Bank account · Bank</span>
              </small>
            </span>
            <strong>
              <span className={ui["skeleton"]}>€0,000.00</span>
            </strong>
            <span className={styles["account-tile-foot"]}>
              <span className={ui["skeleton"]}>Synced today</span>
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
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const changeView = useChangeView();
  const sandbox = useBankingConfiguration().environment === "SANDBOX";

  const content = currencyAccounts.length ? (
    <div className={styles["account-strip"]}>
      {currencyAccounts.slice(0, shownTiles).map(account => {
        const Icon = accountIcon(account.kind);

        return (
          <button
            className={styles["account-tile"]}
            key={account.id}
            onClick={() => {
              if (account.provider === "manual") {
                setDialog({
                  kind: "balance",
                  account
                });
              } else {
                changeView("accounts");
              }
            }}
          >
            <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
              <Icon size={21} />
            </span>
            <span className={styles["account-tile-name"]}>
              {account.name}
              <small>
                {kinds[account.kind]} · {account.institution}
              </small>
            </span>
            <strong>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency)}</strong>
            <span className={styles["account-tile-foot"]}>
              <span className={clsx(styles["status-dot"], account.sync_error ? styles["warn"] : "")} />
              {accountSyncLabel(account)}
              <span><DateValue value={account.balance_date} fallback="No balance yet" /></span>
            </span>
          </button>
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
      {dialog?.kind === "balance" && <ValuationDialog selectedAccount={dialog.account} close={closeDialog} />}
    </>
  );
}
