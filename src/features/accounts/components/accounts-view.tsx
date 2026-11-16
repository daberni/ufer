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
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "openBank" | "setModal" | "setSelectedAccount"> & {
  accounts: Account[];
};

export function AccountsView({
  accounts,
  openBank,
  setModal,
  setSelectedAccount
}: Props) {
  return (
    <>
      <div className={ui["section-heading"]}>
        <span className={ui["section-kicker"]}>{accounts.length} ACCOUNTS & ASSETS</span>
        <div className={ui["button-group"]}>
          <button className={ui["button"]} onClick={() => setModal("account")}>
            <Plus size={15} />
            Add account
          </button>
          <button className={clsx(ui["button"], ui["primary"])} onClick={() => openBank()}>
            <Link2 size={15} />
            Connect bank
          </button>
        </div>
      </div>
      {accounts.length ? (
        <div className={styles["accounts-grid"]}>
          {accounts.map(account => {
            const Icon = accountIcon(account.kind);

            return (
              <section className={clsx(ui["panel"], styles["account-detail"])} key={account.id}>
                <div className={ui["card-heading"]}>
                  <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
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
                    onClick={() => {
                      setSelectedAccount(account);
                      setModal("balance");
                    }}
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
              <button className={clsx(ui["button"], ui["primary"])} onClick={() => setModal("account")}>
                <Plus size={15} />
                Add your first account
              </button>
            )}
          >
            Add bank accounts, investments, property and debts to build your overview.
          </Empty>
        </section>
      )}
    </>
  );
}
