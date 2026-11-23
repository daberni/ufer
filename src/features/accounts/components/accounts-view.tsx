"use client";

import { Tooltip } from "@/components/ui/tooltip";
import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./accounts-view.module.css";
import { Link2, Plus, TriangleAlert } from "lucide-react";
import { accountIcon, kinds } from "@/features/accounts/account-presentation";
import { money } from "@/lib/money";
import { Empty } from "@/components/ui/empty-state";
import { ActionMenu, MenuItem } from "@/components/ui/action-menu";
import type { Account } from "@/features/accounts/types";
import { activeAccounts } from "@/features/accounts/queries";
import { useState } from "react";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import { AccountSourceStatus } from "./account-source-status";
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
  const connectBank = () => setDialog({
    kind: "bank"
  });

  return (
    <>
      <SectionHeading title="Accounts & assets" count={mapArea(accounts, data => activeAccounts(data).length)}>
        <button className={clsx(ui["button"], ui["phone-hidden"])} onClick={addAccount}>
          <Plus size={15} />
          Add account
        </button>
        <button className={clsx(ui["button"], ui["primary"], ui["phone-hidden"])} onClick={connectBank}>
          <Link2 size={15} />
          Connect bank
        </button>
        <ActionMenu label="Account actions" appearance="button" phoneOnly>
          <MenuItem icon={<Plus size={15} aria-hidden="true" />} onSelect={addAccount}>
            Add account
          </MenuItem>
          <MenuItem icon={<Link2 size={15} aria-hidden="true" />} onSelect={connectBank}>
            Connect bank
          </MenuItem>
        </ActionMenu>
      </SectionHeading>
      {accounts.status === "pending" ? (
        <AreaPlaceholder area={accounts} failureTitle="Your accounts could not be loaded">
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
          <div className={styles["card-header"]}>
            <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
            <h2>
              <span className={ui["skeleton"]}>Everyday account</span>
            </h2>
            <span className={clsx(ui["pill"], ui["skeleton"])}>Bank account</span>
          </div>
          <strong className={styles["account-detail-balance"]}>
            <span className={ui["skeleton"]}>€0,000.00</span>
          </strong>
          <div className={styles["account-detail-meta"]}>
            <span className={ui["skeleton"]}>Example bank · Synced 12 Jan</span>
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
      <div className={styles["card-header"]}>
        <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
          <Icon size={23} />
        </span>
        <h2 className={styles["card-name"]}>
          <Tooltip text={account.name} describes={false} onlyWhenTruncated>
            {trigger => (
              <Link {...trigger} className={styles["account-link"]} href={accountHref(account.id)}>
                <span className={styles["card-name-text"]}>{account.name}</span>
              </Link>
            )}
          </Tooltip>
        </h2>
        <span className={ui["pill"]}>{kinds[account.kind] ?? account.kind}</span>
      </div>
      <strong className={styles["account-detail-balance"]}>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency, locale)}</strong>
      <div className={styles["account-detail-meta"]}>
        <AccountSourceStatus account={account} withDate />
      </div>
      {account.reported_difference_minor !== null && account.reported_difference_minor !== 0 && (
        <p className={styles["mismatch"]}>
          <TriangleAlert size={15} aria-hidden="true" />
          Differs from bank by {money(account.reported_difference_minor, account.currency, locale)}
        </p>
      )}
    </section>
  );
}
