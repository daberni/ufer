"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import styles from "./overview-accounts.module.css";
import { ArrowRight, Landmark, Plus } from "lucide-react";
import { accountIcon, kinds, accountSyncLabel } from "@/features/dashboard/presentation";
import { DateValue } from "@/components/ui/date-value";
import { money } from "@/lib/money";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "changeView" | "openBank" | "selectedCurrencyAccounts" | "setModal" | "setSelectedAccount">;

export function OverviewAccounts({
  changeView,
  openBank,
  selectedCurrencyAccounts,
  setModal,
  setSelectedAccount
}: Props) {
  return (
    <section className={styles["accounts-section"]}>
      <div className={styles["section-heading"]}>
        <h2>
          Your accounts <span className={styles["count-badge"]}>{selectedCurrencyAccounts.length}</span>
        </h2>
        <button className={ui["text-button"]} onClick={() => changeView("accounts")}>
          Manage all <ArrowRight size={15} />
        </button>
      </div>
      {selectedCurrencyAccounts.length ? (
        <div className={styles["account-strip"]}>
          {selectedCurrencyAccounts.slice(0, 4).map(account => {
            const Icon = accountIcon(account.kind);

            return (
              <button
                className={styles["account-tile"]}
                key={account.id}
                onClick={() => {
                  setSelectedAccount(account);

                  if (account.provider === "manual") {
                    setModal("balance");
                  } else {
                    changeView("accounts");
                  }
                }}
              >
                <span className={clsx(accountStyles["account-logo"], styles[account.kind])}>
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
            <p>Connect a sandbox bank, or manually add accounts, investments, property and debts.</p>
          </div>
          <button className={clsx(styles["button"], ui["primary"])} onClick={() => openBank()}>
            <Plus size={15} />
            Connect bank
          </button>
          <button className={styles["button"]} onClick={() => setModal("account")}>
            Add manually
          </button>
        </div>
      )}
    </section>
  );
}
