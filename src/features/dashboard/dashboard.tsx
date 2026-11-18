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
import { AppSidebar, type SidebarLink } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { PageHeading } from "@/components/layout/page-heading";
import { LoginForm } from "@/features/auth/components/login-form";
import { LegalLinks } from "@/features/legal/components/legal-links";
import { SourceCodeNotice } from "@/features/legal/components/source-code-notice";
import { EditableAccountName } from "@/features/accounts/components/editable-account-name";
import { AccountDetailActions } from "@/features/accounts/components/account-detail-actions";
import { accountGroups, useAccounts } from "@/features/accounts/queries";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { SyncButton } from "@/features/banking/components/sync-button";
import { navigation } from "./navigation";
import { onView, useAppStore } from "@/client/app-store";
import { useSessionLock } from "@/client/use-session-lock";
import { useDashboardNavigation } from "./use-dashboard-navigation";
import { useAccountFilter, useChangeView, useCurrency, useView, useViewHref } from "@/client/use-app-url";
import { sectionOf } from "@/client/app-location";
import { useLoadError } from "./use-load-error";
import { TraceId } from "@/components/ui/trace-id";
import type { Failure } from "@/client/api";

/** The persistent dashboard shell; the current view route renders inside it. */
export default function Dashboard({ children }: {
  children: React.ReactNode
}) {
  const { locked } = useSessionLock();

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
  const accountId = useAccountFilter();
  const loadError = useLoadError();
  const section = sectionOf(view);
  const nav = navigation.find(item => item.id === section)!;
  const selectedAccount = view === "account" ? accounts.data?.find(account => account.id === accountId) : undefined;
  const heading = view === "account" ? selectedAccount?.name ?? "Account details" : nav.heading;
  let description = nav.description;

  if (view === "account") {
    description = "Balance, transactions and history.";
  } else if (view === "accounts") {
    description = "All your accounts and assets.";
  }

  const showSync = view !== "account" || Boolean(selectedAccount && selectedAccount.provider !== "manual");

  // Bank accounts only add the sync action and authorization reminders, so until they load the shell shows neither.
  const {
    bankAccounts,
    expiring
  } = accountGroups(accounts.data ?? [], currency);
  const links: SidebarLink[] = navigation.map(item => ({
    id: item.id,
    label: item.label,
    mobileLabel: item.mobileLabel,
    icon: item.icon,
    href: viewHref(item.id),
    current: item.id === section,
    count: item.id === "connections" ? expiring.length : 0
  }));

  return (
    <div className={styles["app-shell"]}>
      <AppSidebar
        environment={environment}
        homeHref={viewHref("overview")}
        links={links}
      />
      <div className={styles["main-shell"]}>
        <AppHeader environment={environment} title={nav.label} />
        <main className={styles["content"]}>
          <PageHeading heading={selectedAccount ? <EditableAccountName key={selectedAccount.id} account={selectedAccount} /> : heading} description={description}>
            {selectedAccount?.provider === "manual" && (
              <AccountDetailActions
                key={selectedAccount.id}
                account={selectedAccount}
                manualAccounts={(accounts.data ?? []).filter(account => account.provider === "manual")}
              />
            )}
            {showSync && <SyncButton bankAccounts={bankAccounts} showConnections={() => changeView("connections")} />}
          </PageHeading>
          <LoadErrorNotice failure={loadError.failure} retry={loadError.retry} />
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
  const bound = useAppStore(state => state.feedback);
  const dismiss = useAppStore(state => state.dismissFeedback);
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
  failure,
  retry
}: {
  failure: Failure | null;
  retry: () => void;
}) {
  if (!failure) {
    return null;
  }

  return (
    <div className={clsx(ui["notice"], ui["error"])} role="alert">
      <CircleHelp size={18} />
      <span>
        Your data could not be loaded: {failure.message}
        <TraceId id={failure.traceId} />
      </span>
      <button className={ui["text-button"]} onClick={retry}>
        Retry
      </button>
    </div>
  );
}
