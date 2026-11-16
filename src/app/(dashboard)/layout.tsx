import Dashboard from "@/features/dashboard/dashboard";
import { DashboardStoreProvider } from "@/features/dashboard/dashboard-store";
import { QueryProvider } from "@/client/query-provider";
import { BankingConfigurationProvider } from "@/features/banking/banking-configuration";
import { bankingConfiguration } from "@/features/banking/server/banking-queries";
import { requestSignedOut } from "@/features/auth/server/request-session";

export default async function DashboardLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the session renders the dashboard per request: signed-out visitors get the sign-in screen and signed-in users the shell with the first response.
  const signedOut = await requestSignedOut();

  return (
    <QueryProvider>
      <BankingConfigurationProvider configuration={bankingConfiguration()}>
        <DashboardStoreProvider locked={signedOut}>
          <Dashboard>{children}</Dashboard>
        </DashboardStoreProvider>
      </BankingConfigurationProvider>
    </QueryProvider>
  );
}
