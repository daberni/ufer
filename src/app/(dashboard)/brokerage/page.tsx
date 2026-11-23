import { viewMetadata } from "@/i18n/metadata";
import { BrokeragePage } from "@/features/dashboard/components/dashboard-views";

export function generateMetadata() {
  return viewMetadata("brokerage");
}

export default function Page() {
  return <BrokeragePage />;
}
