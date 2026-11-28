"use client";

import ui from "../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./dashboard.module.css";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { bankConnectionsHref } from "@/features/banking/connections-location";
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
import { AccountDetailActions } from "@/features/accounts/components/account-detail-actions";
import { accountGroups, activeAccounts, bookableManualAccounts, useAccounts } from "@/features/accounts/queries";
import { showsSync } from "./sync-visibility";
import { useBankingConfiguration } from "@/features/banking/banking-configuration";
import { SyncButton } from "@/features/banking/components/sync-button";
import { navigation } from "./navigation";
import { onView, useAppStore } from "@/client/app-store";
import { useSessionLock } from "@/client/use-session-lock";
import { useDashboardNavigation } from "./use-dashboard-navigation";
import { useAccountFilter, useCurrency, useHoldingSecurity, useView, useViewHref } from "@/client/use-app-url";
import { useSecurities } from "@/features/securities/queries";
import { sectionOf } from "@/client/app-location";
import { useLoadError } from "./use-load-error";
import { TraceId } from "@/components/ui/trace-id";
import type { Failure } from "@/client/api";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("shell");
  const view = useView();
  const viewHref = useViewHref();
  const router = useRouter();
  const currency = useCurrency();
  const accounts = useAccounts();
  const accountId = useAccountFilter();
  const loadError = useLoadError();
  const section = sectionOf(view);
  const nav = navigation.find(item => item.id === section)!;
  const holdingSecurity = useHoldingSecurity();
  const securities = useSecurities(view === "holding");
  const selectedAccount = view === "account" || view === "holding" ? accounts.data?.find(account => account.id === accountId) : undefined;
  const selectedSecurity = securities.data?.securities.find(security => security.id === holdingSecurity);
  let heading = view === "account" ? selectedAccount?.name ?? t("views.accountDetails") : t(`navigation.${nav.id}.heading`);

  if (view === "import") {
    heading = t("views.importHeading");
  }

  let description = t(`navigation.${nav.id}.description`);

  if (view === "holding") {
    heading = selectedSecurity?.name ?? t("views.holdingDetails");
    description = selectedAccount?.name ?? t("views.holding");
  } else if (view === "account") {
    description = selectedAccount?.kind === "brokerage" ? t("views.brokerageAccount") : t("views.account");
  } else if (view === "import") {
    description = t("views.import");
  } else if (view === "accounts") {
    description = t("views.accounts");
  }

  const showSync = showsSync(view, selectedAccount);

  // Bank accounts only add the sync action and authorization reminders, so until they load the shell shows neither.
  const {
    bankAccounts,
    expiring
  } = accountGroups(accounts.data ?? [], currency);
  const links: SidebarLink[] = navigation.map(item => ({
    id: item.id,
    label: t(`navigation.${item.id}.label`),
    mobileLabel: t(`navigation.${item.id}.mobileLabel`),
    icon: item.icon,
    href: viewHref(item.id),
    current: item.id === section,
    count: item.id === "accounts" ? expiring.length : 0
  }));

  return (
    <div className={styles["app-shell"]}>
      <AppSidebar
        environment={environment}
        homeHref={viewHref("overview")}
        links={links}
      />
      <div className={styles["main-shell"]}>
        <AppHeader environment={environment} title={t(`navigation.${nav.id}.label`)} />
        <main className={styles["content"]}>
          <PageHeading heading={selectedAccount && view === "account" ? selectedAccount.name : heading} description={description}>
            {selectedAccount ? (
              <div className={styles["account-actions"]}>
                <AccountDetailActions
                  key={selectedAccount.id}
                  account={selectedAccount}
                  isin={selectedSecurity?.isin ?? undefined}
                  manualAccounts={bookableManualAccounts(activeAccounts(accounts.data ?? []))}
                />
                {showSync && <SyncButton bankAccounts={bankAccounts} showConnections={() => router.push(bankConnectionsHref)} />}
              </div>
            ) : showSync && <SyncButton bankAccounts={bankAccounts} showConnections={() => router.push(bankConnectionsHref)} />}
          </PageHeading>
          <LoadErrorNotice failure={loadError.failure} retry={loadError.retry} />
          {environment === "SANDBOX" && (
            <div className={styles["sandbox-note"]}>
              <span className={styles["status-dot"]} />
              {t("sandboxNote")}
            </div>
          )}
          {expiring.length > 0 && (
            <div className={clsx(ui["notice"], ui["warning"])}>
              <Link2 size={17} />
              {t("expiringAuthorizations", {
                count: expiring.length
              })}
              <Link className={ui["text-button"]} href={bankConnectionsHref}>
                {t("reviewAuthorizations")} <ArrowRight size={14} />
              </Link>
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
  const t = useTranslations("shell");
  const pathname = usePathname();
  const bound = useAppStore(state => state.feedback);
  const dismiss = useAppStore(state => state.dismissFeedback);
  const feedback = onView(bound, pathname);

  useFeedbackDismissal(feedback, dismiss);

  return (
    <ActionFeedback
      feedback={feedback}
      dismissLabel={t("dismissMessage")}
      onDismiss={dismiss}
      placement="overlay"
    />
  );
}

// Rendered with the shell, so the source offer never depends on a successful query.
function DashboardFooter() {
  const t = useTranslations("shell");

  return (
    <footer className={styles["page-footer"]}>
      <p className={styles["footer-brand"]}>
        <span className={styles["footer-name"]}>
          <BrandIcon size={16} /> Ufer
        </span>
        <span>{t("footerTagline")}</span>
      </p>
      <div className={styles["footer-legal"]}>
        <LegalLinks />
        <SourceCodeNotice />
      </div>
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
  const t = useTranslations();

  if (!failure) {
    return null;
  }

  return (
    <div className={clsx(ui["notice"], ui["error"])} role="alert">
      <CircleHelp size={18} />
      <span>
        {t("shell.loadError", {
          message: failure.message
        })}
        <TraceId id={failure.traceId} />
      </span>
      <button className={ui["text-button"]} onClick={retry}>
        {t("common.retry")}
      </button>
    </div>
  );
}
