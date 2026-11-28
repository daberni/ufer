"use client";

import { Tooltip } from "@/components/ui/tooltip";
import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./accounts-view.module.css";
import { Link2, Plus, TriangleAlert } from "lucide-react";
import { accountIcon } from "@/features/accounts/account-presentation";
import { useAccountKindLabel } from "./use-account-kind-label";
import { useTranslations } from "next-intl";
import { money } from "@/lib/money";
import { Empty } from "@/components/ui/empty-state";
import { ActionMenu, MenuItem } from "@/components/ui/action-menu";
import type { Account } from "@/features/accounts/types";
import { acceptsFileImport, activeAccounts } from "@/features/accounts/queries";
import { useState, type ReactNode } from "react";
import { useFileDropTarget } from "@/features/imports/components/file-drop-area";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import { AccountSourceStatus } from "./account-source-status";
import { CreateAccountDialog } from "./create-account-form";
import { setArchivedAccountsOpen, useAccountHref, useArchivedAccountsOpen } from "@/client/use-app-url";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { mapArea, type Area } from "@/components/ui/use-area-result";
import { SectionHeading } from "@/components/ui/section-heading";
import { useLocale } from "@/client/locale-provider";

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
  const t = useTranslations("accounts.list");
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
      <SectionHeading title={t("title")} count={mapArea(accounts, data => activeAccounts(data).length)}>
        <button className={clsx(ui["button"], ui["phone-hidden"])} onClick={addAccount}>
          <Plus size={15} />
          {t("addAccount")}
        </button>
        <button className={clsx(ui["button"], ui["primary"], ui["phone-hidden"])} onClick={connectBank}>
          <Link2 size={15} />
          {t("connectBank")}
        </button>
        <ActionMenu label={t("actions")} appearance="button" phoneOnly>
          <MenuItem icon={<Plus size={15} aria-hidden="true" />} onSelect={addAccount}>
            {t("addAccount")}
          </MenuItem>
          <MenuItem icon={<Link2 size={15} aria-hidden="true" />} onSelect={connectBank}>
            {t("connectBank")}
          </MenuItem>
        </ActionMenu>
      </SectionHeading>
      {accounts.status === "pending" ? (
        <AreaPlaceholder area={accounts} failureTitle={t("failure")}>
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
  const t = useTranslations("accounts.list");
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
            title={t("emptyTitle")}
            action={(
              <button className={clsx(ui["button"], ui["primary"])} onClick={addAccount}>
                <Plus size={15} />
                {t("addFirst")}
              </button>
            )}
          >
            {t("emptyBody")}
          </Empty>
        </section>
      )}
      {archived.length > 0 && (
        <details className={styles["archived"]} open={archivedOpen} onToggle={event => setArchivedAccountsOpen(event.currentTarget.open)}>
          <summary className={ui["text-button"]}>{t("archived", {
            count: archived.length
          })}</summary>
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
  const t = useTranslations("accounts.list");
  const kindLabel = useAccountKindLabel();
  const locale = useLocale();
  const accountHref = useAccountHref();
  const Icon = accountIcon(account.kind);

  return (
    <AccountCardFrame account={account}>
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
        <span className={ui["pill"]}>{kindLabel(account.kind)}</span>
      </div>
      <strong className={styles["account-detail-balance"]}>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency, locale)}</strong>
      <div className={styles["account-detail-meta"]}>
        <AccountSourceStatus account={account} withDate />
      </div>
      {account.reported_difference_minor !== null && account.reported_difference_minor !== 0 && (
        <p className={styles["mismatch"]}>
          <TriangleAlert size={15} aria-hidden="true" />
          {t("differsFromBank", {
            amount: money(account.reported_difference_minor, account.currency, locale)
          })}
        </p>
      )}
    </AccountCardFrame>
  );
}

// An account that accepts imports is its own drop target and preselects itself; brokerage and archived accounts are not.
function AccountCardFrame({
  account,
  children
}: {
  account: Account;
  children: ReactNode;
}) {
  const className = clsx(ui["panel"], styles["account-detail"]);

  if (!acceptsFileImport(account)) {
    return <section className={className}>{children}</section>;
  }

  return <ImportableAccountCard accountId={account.id} className={className}>{children}</ImportableAccountCard>;
}

function ImportableAccountCard({
  accountId,
  className,
  children
}: {
  accountId: string;
  className: string;
  children: ReactNode;
}) {
  const drop = useFileDropTarget(accountId);

  return <section className={clsx(className, drop.className)} {...drop.handlers}>{children}</section>;
}
