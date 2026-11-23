import { viewMetadata } from "@/i18n/metadata";
import { AccountsPage } from "@/features/dashboard/components/dashboard-views";

export function generateMetadata() {
  return viewMetadata("accounts");
}

export default function Page() {
  return <AccountsPage />;
}
