"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import styles from "./accounts-view.module.css";
import { ArrowRight, Link2, Plus } from "lucide-react";
import { accountIcon, accountSourceLabel, kinds } from "@/features/dashboard/presentation";
import { DateValue } from "@/components/ui/date-value";
import { money } from "@/lib/money";
import { Empty } from "@/components/ui/empty-state";
import type { Account } from "@/features/dashboard/types";
import { useDashboardStore } from "@/features/dashboard/dashboard-store";
import { AreaPlaceholder } from "@/features/dashboard/components/area-placeholder";
import { shownStatus, valueMask } from "@/features/dashboard/components/result-presentation";
import type { Area } from "@/features/dashboard/use-area-result";

type Props = {
  accounts: Area<Account[]>;
};

const skeletonAccounts = 3;

export function AccountsView({
  accounts
}: Props) {
  const openDialog = useDashboardStore(state => state.openDialog);
  const addAccount = () => openDialog({
    kind: "account"
  });

  return (
    <>
      <div className={ui["section-heading"]}>
        <span className={clsx(ui["section-kicker"], valueMask(shownStatus(accounts)))}>{accounts.data?.length ?? 0} ACCOUNTS & ASSETS</span>
        <div className={ui["button-group"]}>
          <button className={ui["button"]} onClick={addAccount}>
            <Plus size={15} />
            Add account
          </button>
          <button
            className={clsx(ui["button"], ui["primary"])}
            onClick={() => openDialog({
              kind: "bank",
              connection: null
            })}
          >
            <Link2 size={15} />
            Connect bank
          </button>
        </div>
      </div>
      {accounts.status === "pending" ? (
        <AreaPlaceholder area={accounts} subject="Your accounts">
          <AccountCardsSkeleton />
        </AreaPlaceholder>
      ) : <AccountCards accounts={accounts.data} addAccount={addAccount} />}
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
          <span className={clsx(ui["button"], ui["full-width"], ui["skeleton"])}>Update balance</span>
        </div>
      ))}
    </div>
  );
}

function AccountCards({
  accounts,
  addAccount
}: {
  accounts: Account[];
  addAccount: () => void;
}) {
  const openDialog = useDashboardStore(state => state.openDialog);

  return accounts.length ? (
    <div className={styles["accounts-grid"]}>
      {accounts.map(account => {
        const Icon = accountIcon(account.kind);

        return (
          <section className={clsx(ui["panel"], styles["account-detail"])} key={account.id}>
            <div className={ui["card-heading"]}>
              <span className={clsx(accountStyles["account-logo"], styles[account.kind])}>
                <Icon size={23} />
              </span>
              <span className={ui["pill"]}>{kinds[account.kind]}</span>
            </div>
            <h2>{account.name}</h2>
            <p className={ui["muted"]}>{account.institution}</p>
            <strong className={styles["account-detail-balance"]}>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency)}</strong>
            <div className={styles["account-detail-meta"]}>
              <span>Balance <DateValue value={account.balance_date} fallback="not recorded yet" /></span>
              <span>{accountSourceLabel(account)}</span>
            </div>
            {account.sync_error && <p className={ui["error-text"]}>{account.sync_error}</p>}
            {account.provider === "manual" && (
              <button
                className={clsx(ui["button"], ui["full-width"])}
                onClick={() => openDialog({
                  kind: "balance",
                  account
                })}
              >
                Update balance <ArrowRight size={15} />
              </button>
            )}
          </section>
        );
      })}
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
  );
}
