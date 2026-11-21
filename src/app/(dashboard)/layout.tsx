import Dashboard from "@/features/dashboard/dashboard";
import { AppStoreProvider } from "@/client/app-store";
import { HydrationBoundary } from "@tanstack/react-query";
import { QueryProvider } from "@/client/query-provider";
import { BankingConfigurationProvider } from "@/features/banking/banking-configuration";
import { bankingConfiguration } from "@/features/banking/server/banking-queries";
import { requestWorkspaceAccess } from "@/features/auth/server/request-session";
import { initialServerState } from "./initial-server-state";

export default async function DashboardLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the session renders the dashboard per request: signed-out visitors get the sign-in screen and signed-in users the shell with the first response.
  const access = await requestWorkspaceAccess();
  // Only a confirmed session receives financial data in the HTML.
  const state = access === true ? await initialServerState() : undefined;

  return (
    <QueryProvider>
      <HydrationBoundary state={state}>
        <BankingConfigurationProvider configuration={bankingConfiguration()}>
          <AppStoreProvider locked={access === false}>
            <Dashboard>{children}</Dashboard>
          </AppStoreProvider>
        </BankingConfigurationProvider>
      </HydrationBoundary>
    </QueryProvider>
  );
}
