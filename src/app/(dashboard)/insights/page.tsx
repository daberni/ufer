import { viewMetadata } from "@/i18n/metadata";
import { InsightsPage } from "@/features/insights/components/insights-page";

export function generateMetadata() {
  return viewMetadata("insights");
}

export default function Page() {
  return <InsightsPage />;
}
