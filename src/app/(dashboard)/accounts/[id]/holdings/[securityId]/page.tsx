import { viewMetadata } from "@/i18n/metadata";
import { HoldingPage } from "@/features/dashboard/components/dashboard-views";

export function generateMetadata() {
  return viewMetadata("holding");
}

export default function Page() {
  return <HoldingPage />;
}
