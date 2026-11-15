import { connection } from "next/server";
import Dashboard from "@/features/dashboard/dashboard";
import { DashboardProvider } from "@/features/dashboard/dashboard-context";

export default async function DashboardLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  // The dashboard reads its view filters from the request URL, so it renders per request instead of being prerendered.
  await connection();

  return (
    <DashboardProvider>
      <Dashboard>{children}</Dashboard>
    </DashboardProvider>
  );
}
