import { viewMetadata } from "@/i18n/metadata";
import { TransactionsPage } from "@/features/dashboard/components/dashboard-views";

export function generateMetadata() {
  return viewMetadata("transactions");
}

export default function Page() {
  return <TransactionsPage />;
}
