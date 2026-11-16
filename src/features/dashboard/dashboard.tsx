"use client";

import ui from "../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./dashboard.module.css";
import { usePathname } from "next/navigation";
import { ArrowRight, CircleHelp, Link2 } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { LiveAnnouncements } from "@/components/ui/live-announcements";
import { useFeedbackDismissal } from "@/components/ui/use-action-feedback";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { PageHeading } from "@/features/dashboard/components/page-heading";
import { LoginForm } from "@/features/auth/components/login-form";
import { LegalLinks } from "@/features/legal/components/legal-links";
import { SourceCodeNotice } from "@/features/legal/components/source-code-notice";
import { accountGroups, useAccounts } from "@/features/accounts/queries";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { navigation } from "./presentation";
import { onView, useDashboardStore } from "./dashboard-store";
import { useDashboardLock } from "./use-dashboard-lock";
import { useDashboardNavigation } from "./use-dashboard-navigation";
import { useChangeView, useCurrency, useView, useViewHref } from "./use-dashboard-url";
import { useLoadError } from "./use-load-error";

/** The persistent dashboard shell; the current view route renders inside it. */
export default function Dashboard({ children }: {
  children: React.ReactNode
}) {
  const { locked } = useDashboardLock();

  return (
    <>
      <DashboardNavigation />
      {locked ? <LoginForm /> : <DashboardShell>{children}</DashboardShell>}
    </>
  );
}

// A separate component, so following the URL does not re-render the shell.
function DashboardNavigation() {
  useDashboardNavigation();

  return null;
}

// Rendered only while signed in, so no dashboard query runs behind the sign-in form. The frame renders at once; parts that depend on data fill in as their queries resolve, like the areas of each view.
function DashboardShell({ children }: {
  children: React.ReactNode
}) {
  const { environment } = useBankingConfiguration();
  const view = useView();
  const viewHref = useViewHref();
  const changeView = useChangeView();
  const currency = useCurrency();
  const accounts = useAccounts();
  const loadError = useLoadError();
  const nav = navigation.find(item => item.id === view)!;

  // Bank accounts only add the sync action and authorization reminders, so until they load the shell shows neither.
  const {
    bankAccounts,
    expiring
  } = accountGroups(accounts.data ?? [], currency);

  return (
    <div className={styles["app-shell"]}>
      <AppSidebar
        environment={environment}
        expiring={expiring}
        view={view}
        viewHref={viewHref}
      />
      <div className={styles["main-shell"]}>
        <AppHeader environment={environment} title={nav.label} />
        <main className={styles["content"]}>
          <PageHeading bankAccounts={bankAccounts} view={view} />
          <LoadErrorNotice message={loadError.message} retry={loadError.retry} />
          {environment === "SANDBOX" && (
            <div className={styles["sandbox-note"]}>
              <span className={styles["status-dot"]} />
              Sandbox mode: linked banks provide synthetic test data.
            </div>
          )}
          {expiring.length > 0 && (
            <div className={clsx(ui["notice"], ui["warning"])}>
              <Link2 size={17} />
              {expiring.length} bank authorization(s) are expiring or have expired.
              <button className={ui["text-button"]} onClick={() => changeView("connections")}>
                Review authorizations <ArrowRight size={14} />
              </button>
            </div>
          )}
          {children}
          <DashboardFooter />
        </main>
      </div>
      <LiveAnnouncements polite={loadError.announcement} assertive="" />
      <PageFeedback />
    </div>
  );
}

// Page-level messages without a surviving trigger, such as a bank callback result; they belong to the view they were reported on.
function PageFeedback() {
  const pathname = usePathname();
  const bound = useDashboardStore(state => state.feedback);
  const dismiss = useDashboardStore(state => state.dismissFeedback);
  const feedback = onView(bound, pathname);

  useFeedbackDismissal(feedback, dismiss);

  return (
    <ActionFeedback
      feedback={feedback}
      dismissLabel="Dismiss message"
      onDismiss={dismiss}
      placement="overlay"
    />
  );
}

// Rendered with the shell, so the source offer never depends on a successful query.
function DashboardFooter() {
  return (
    <footer className={styles["page-footer"]}>
      <span>
        <BrandIcon size={16} /> Ufer
      </span>
      <span>A clearer view of your money.</span>
      <LegalLinks />
      <SourceCodeNotice />
    </footer>
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
