"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./accounts-view.module.css";
import { Link2, Plus, TriangleAlert } from "lucide-react";
import { accountIcon, accountSourceLabel, kinds } from "@/features/accounts/account-presentation";
import { DateValue } from "@/components/ui/date-value";
import { money } from "@/lib/money";
import { Empty } from "@/components/ui/empty-state";
import type { Account } from "@/features/accounts/types";
import { activeAccounts } from "@/features/accounts/queries";
import { useState } from "react";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import { CreateAccountDialog } from "./create-account-form";
import { setArchivedAccountsOpen, useAccountHref, useArchivedAccountsOpen } from "@/client/use-app-url";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { mapArea, type Area } from "@/components/ui/use-area-result";
import { SectionHeading } from "@/components/ui/section-heading";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

type Props = {
  accounts: Area<Account[]>;
};

type OpenDialog = {
  kind: "account";
} | {
  kind: "bank";
};

const skeletonAccounts = 3;

export function AccountsView({
  accounts
}: Props) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const addAccount = () => setDialog({
    kind: "account"
  });

  return (
    <>
      <SectionHeading title="Accounts & assets" count={mapArea(accounts, data => activeAccounts(data).length)}>
        <button className={ui["button"]} onClick={addAccount}>
          <Plus size={15} />
          Add account
        </button>
        <button
          className={clsx(ui["button"], ui["primary"])}
          onClick={() => setDialog({
            kind: "bank"
          })}
        >
          <Link2 size={15} />
          Connect bank
        </button>
      </SectionHeading>
      {accounts.status === "pending" ? (
        <AreaPlaceholder area={accounts} subject="Your accounts">
          <AccountCardsSkeleton />
        </AreaPlaceholder>
      ) : (
        <AccountCards
          accounts={accounts.data}
          addAccount={addAccount}
        />
      )}
      {dialog?.kind === "account" && <CreateAccountDialog close={closeDialog} />}
      {dialog?.kind === "bank" && <BankConnectionDialog connection={null} close={closeDialog} />}
    </>
  );
}

function AccountCardsSkeleton() {
  return (
    <div className={styles["accounts-grid"]}>
      {Array.from({
        length: skeletonAccounts
      }, (_, index) => (
        <div className={clsx(ui["panel"], styles["account-detail"])} key={index}>
          <div className={ui["card-heading"]}>
            <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
            <span className={clsx(ui["pill"], ui["skeleton"])}>Bank account</span>
          </div>
          <h2>
            <span className={ui["skeleton"]}>Everyday account</span>
          </h2>
          <p>
            <span className={ui["skeleton"]}>Example bank</span>
          </p>
          <strong className={styles["account-detail-balance"]}>
            <span className={ui["skeleton"]}>€0,000.00</span>
          </strong>
          <div className={styles["account-detail-meta"]}>
            <span className={ui["skeleton"]}>Balance 12 Jan 2025</span>
            <span className={ui["skeleton"]}>Bank sync</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// The whole card links to the account's details, where account-specific actions are offered.
function AccountCards({
  accounts,
  addAccount
}: {
  accounts: Account[];
  addAccount: () => void;
}) {
  const locale = useLocale();
  const shown = activeAccounts(accounts);
  const archived = accounts.filter(account => account.archived_at !== null);
  const archivedOpen = useArchivedAccountsOpen();

  return (
    <>
      {shown.length ? (
        <div className={styles["accounts-grid"]}>
          {shown.map(account => <AccountCard account={account} key={account.id} />)}
        </div>
      ) : (
        <section className={ui["panel"]}>
          <Empty
            title="Everything in one place"
            action={(
              <button className={clsx(ui["button"], ui["primary"])} onClick={addAccount}>
                <Plus size={15} />
                Add your first account
              </button>
            )}
          >
            Add bank accounts, investments, property and debts to build your overview.
          </Empty>
        </section>
      )}
      {archived.length > 0 && (
        <details className={styles["archived"]} open={archivedOpen} onToggle={event => setArchivedAccountsOpen(event.currentTarget.open)}>
          <summary className={ui["text-button"]}>{`Archived accounts (${formatCount(archived.length, locale)})`}</summary>
          <div className={styles["accounts-grid"]}>
            {archived.map(account => <AccountCard account={account} key={account.id} />)}
          </div>
        </details>
      )}
    </>
  );
}

function AccountCard({ account }: {
  account: Account
}) {
  const locale = useLocale();
  const accountHref = useAccountHref();
  const Icon = accountIcon(account.kind);

  return (
    <section className={clsx(ui["panel"], styles["account-detail"])}>
      <div className={ui["card-heading"]}>
        <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
          <Icon size={23} />
        </span>
        <span className={ui["pill"]}>{account.archived_at ? "Archived" : kinds[account.kind]}</span>
      </div>
      <h2>
        <Link className={styles["account-link"]} href={accountHref(account.id)}>{account.name}</Link>
      </h2>
      <p className={ui["muted"]}>{account.institution}</p>
      <strong className={styles["account-detail-balance"]}>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency, locale)}</strong>
      <div className={styles["account-detail-meta"]}>
        <span>Balance <DateValue value={account.balance_date} fallback="not recorded yet" /></span>
        <span>{accountSourceLabel(account)}</span>
      </div>
      {account.reported_difference_minor !== null && account.reported_difference_minor !== 0 && (
        <p className={styles["mismatch"]}>
          <TriangleAlert size={15} aria-hidden="true" />
          Differs from bank by {money(account.reported_difference_minor, account.currency, locale)}
        </p>
      )}
      {account.sync_error && <p className={ui["error-text"]}>{account.sync_error}</p>}
    </section>
  );
}
