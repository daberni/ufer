import type { Metadata } from "next";
import { TransactionsPage } from "@/features/dashboard/components/dashboard-views";

export const metadata: Metadata = {
  title: "Transactions"
};

export default function Page() {
  return <TransactionsPage />;
}
