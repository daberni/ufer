import { connection } from "next/server";
import Dashboard from "@/features/dashboard/dashboard";
import { DashboardProvider } from "@/features/dashboard/dashboard-context";
import { QueryProvider } from "@/client/query-provider";
import { BankingConfigurationProvider } from "@/features/banking/banking-configuration";
import { bankingConfiguration } from "@/features/banking/server/banking-queries";

export default async function DashboardLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  // The dashboard reads its view filters from the request URL, so it renders per request instead of being prerendered.
  await connection();

  return (
    <QueryProvider>
      <BankingConfigurationProvider configuration={bankingConfiguration()}>
        <DashboardProvider>
          <Dashboard>{children}</Dashboard>
        </DashboardProvider>
      </BankingConfigurationProvider>
    </QueryProvider>
  );
}
