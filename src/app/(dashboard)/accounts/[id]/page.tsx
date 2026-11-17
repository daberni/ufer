import type { Metadata } from "next";
import { AccountPage } from "@/features/dashboard/components/dashboard-views";

export const metadata: Metadata = {
  title: "Account"
};

export default function Page() {
  return <AccountPage />;
}
