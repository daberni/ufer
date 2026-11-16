"use client";

import ui from "../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./dashboard.module.css";
import { ArrowRight, CircleHelp, Link2 } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { PageHeading } from "@/features/dashboard/components/page-heading";
import { DashboardDialogs } from "@/features/dashboard/components/dashboard-dialogs";
import { ViewLoading } from "@/features/dashboard/components/view-loading";
import { LoginForm } from "@/features/auth/components/login-form";
import { accountGroups, useAccounts } from "@/features/accounts/queries";
import { useBankingStatus } from "@/features/banking/queries";
import { useDashboardController } from "./dashboard-context";
import { useLoadError } from "./use-load-error";

/** The persistent dashboard shell; the current view route renders inside it. */
export default function Dashboard({ children }: {
  children: React.ReactNode
}) {
  const dashboard = useDashboardController();

  if (dashboard.locked) {
    return <LoginForm unlock={dashboard.unlock} />;
  }

  return <DashboardShell>{children}</DashboardShell>;
}

// Rendered only while signed in, so no dashboard query runs behind the sign-in form.
function DashboardShell({ children }: {
  children: React.ReactNode
}) {
  const dashboard = useDashboardController();
  const banking = useBankingStatus();
  const accounts = useAccounts();
  const loadError = useLoadError();

  if (!banking.data || !accounts.data) {
    return (
      <main className={styles["content"]}>
        <LoadErrorNotice message={loadError.message} retry={loadError.retry} />
        <ViewLoading failed={banking.isError || accounts.isError} />
      </main>
    );
  }

  const environment = banking.data.environment;
  const {
    bankAccounts,
    expiring
  } = accountGroups(accounts.data, dashboard.currency);

  return (
    <div className={styles["app-shell"]}>
      <AppSidebar
        environment={environment}
        expiring={expiring}
        view={dashboard.view}
        viewHref={dashboard.viewHref}
      />
      <div className={styles["main-shell"]}>
        <AppHeader
          environment={environment}
          lock={dashboard.lock}
          nav={dashboard.nav}
          reportFeedback={dashboard.reportFeedback}
        />
        <main className={styles["content"]}>
          <PageHeading
            bankAccounts={bankAccounts}
            nav={dashboard.nav}
            view={dashboard.view}
          />
          <LoadErrorNotice message={loadError.message} retry={loadError.retry} />
          {environment === "SANDBOX" && (
            <div className={styles["sandbox-note"]}>
              <span className={styles["status-dot"]} />
              Sandbox mode: linked banks provide test data. Real accounts require a separate production application.
            </div>
          )}
          {expiring.length > 0 && (
            <div className={clsx(ui["notice"], ui["warning"])}>
              <Link2 size={17} />
              {expiring.length} bank authorization(s) are expiring or have expired.
              <button className={ui["text-button"]} onClick={() => dashboard.changeView("connections")}>
                Review authorizations <ArrowRight size={14} />
              </button>
            </div>
          )}
          {children}
          <footer className={styles["page-footer"]}>
            <span>
              <BrandIcon size={16} /> Ufer
            </span>
            <span>A clearer view of your money.</span>
          </footer>
        </main>
      </div>
      {dashboard.modal && (
        <DashboardDialogs
          key={dashboard.modal}
          accounts={accounts.data}
          bankCountry={dashboard.bankCountry}
          bankName={dashboard.bankName}
          bankSearch={dashboard.bankSearch}
          banks={dashboard.banks}
          banksError={dashboard.banksError}
          banksLoading={dashboard.banksLoading}
          environment={environment}
          importMode={dashboard.importMode}
          modal={dashboard.modal}
          reportFeedback={dashboard.reportFeedback}
          selectedAccount={dashboard.selectedAccount}
          selectedCategory={dashboard.selectedCategory}
          selectedConnection={dashboard.selectedConnection}
          setBankCountry={dashboard.setBankCountry}
          setBankName={dashboard.setBankName}
          setBankSearch={dashboard.setBankSearch}
          setImportMode={dashboard.setImportMode}
          setModal={dashboard.setModal}
        />
      )}
      <ActionFeedback
        feedback={dashboard.feedback}
        dismissLabel="Dismiss message"
        onDismiss={dashboard.dismissFeedback}
        placement="overlay"
      />
    </div>
  );
}

function LoadErrorNotice({
  message,
  retry
}: {
  message: string;
  retry: () => void;
}) {
  if (!message) {
    return null;
  }

  return (
    <div className={clsx(ui["notice"], ui["error"])} role="alert">
      <CircleHelp size={18} />
      Your data could not be loaded: {message}
      <button className={ui["text-button"]} onClick={retry}>
        Retry
      </button>
    </div>
  );
}
