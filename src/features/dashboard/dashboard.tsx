"use client";

import ui from "../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./dashboard.module.css";
import { ArrowRight, CircleHelp, Link2, RefreshCw } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { PageHeading } from "@/features/dashboard/components/page-heading";
import { DashboardDialogs } from "@/features/dashboard/components/dashboard-dialogs";
import { LoginForm } from "@/features/auth/components/login-form";
import { useDashboardController } from "./dashboard-context";

/** The persistent dashboard shell; the current view route renders inside it. */
export default function Dashboard({ children }: {
  children: React.ReactNode
}) {
  const dashboard = useDashboardController();

  if (dashboard.locked) {
    return (
      <LoginForm
        busy={dashboard.busy}
        perform={dashboard.perform}
        setLocked={dashboard.setLocked}
      />
    );
  }

  return (
    <div className={styles["app-shell"]}>
      <AppSidebar
        expiring={dashboard.expiring}
        state={dashboard.state}
        view={dashboard.view}
        viewHref={dashboard.viewHref}
      />
      <div className={styles["main-shell"]}>
        <AppHeader
          nav={dashboard.nav}
          perform={dashboard.perform}
          reportFeedback={dashboard.reportFeedback}
          setLocked={dashboard.setLocked}
          state={dashboard.state}
        />
        <main className={styles["content"]}>
          <PageHeading
            bankAccounts={dashboard.bankAccounts}
            busy={dashboard.busy}
            nav={dashboard.nav}
            perform={dashboard.perform}
            view={dashboard.view}
          />
          {dashboard.loadError && (
            <div className={clsx(ui["notice"], ui["error"])} role="alert">
              <CircleHelp size={18} />
              Your data could not be loaded: {dashboard.loadError}
              <button className={ui["text-button"]} onClick={() => void dashboard.load()}>
                Retry
              </button>
            </div>
          )}
          {dashboard.state?.environment === "SANDBOX" && (
            <div className={styles["sandbox-note"]}>
              <span className={styles["status-dot"]} />
              Sandbox mode: linked banks provide test data. Real accounts require a separate production application.
            </div>
          )}
          {dashboard.expiring.length > 0 && (
            <div className={clsx(ui["notice"], ui["warning"])}>
              <Link2 size={17} />
              {dashboard.expiring.length} bank authorization(s) are expiring or have expired.
              <button className={ui["text-button"]} onClick={() => dashboard.changeView("connections")}>
                Review authorizations <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!dashboard.state ? (
            <div className={styles["loading-state"]}>
              <RefreshCw size={22} className={ui["spinning"]} />{" "}
              Loading dashboard …
            </div>
          ) : (
            children
          )}
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
          bankCountry={dashboard.bankCountry}
          bankName={dashboard.bankName}
          bankSearch={dashboard.bankSearch}
          banks={dashboard.banks}
          banksError={dashboard.banksError}
          banksLoading={dashboard.banksLoading}
          busy={dashboard.busy}
          importMode={dashboard.importMode}
          modal={dashboard.modal}
          perform={dashboard.perform}
          reportFeedback={dashboard.reportFeedback}
          selectedAccount={dashboard.selectedAccount}
          selectedCategory={dashboard.selectedCategory}
          selectedConnection={dashboard.selectedConnection}
          setBankCountry={dashboard.setBankCountry}
          setBankName={dashboard.setBankName}
          setBankSearch={dashboard.setBankSearch}
          setImportMode={dashboard.setImportMode}
          setModal={dashboard.setModal}
          state={dashboard.state}
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
