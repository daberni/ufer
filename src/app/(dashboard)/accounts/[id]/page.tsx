import { viewMetadata } from "@/i18n/metadata";
import { AccountPage } from "@/features/dashboard/components/dashboard-views";

export function generateMetadata() {
  return viewMetadata("account");
}

export default function Page() {
  return <AccountPage />;
}
