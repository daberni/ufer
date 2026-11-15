import type { Metadata } from "next";
import { AccountsPage } from "@/features/dashboard/components/dashboard-views";

export const metadata: Metadata = {
  title: "Accounts & assets"
};

export default function Page() {
  return <AccountsPage />;
}
