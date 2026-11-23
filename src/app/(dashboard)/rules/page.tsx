import { viewMetadata } from "@/i18n/metadata";
import { RulesPage } from "@/features/dashboard/components/dashboard-views";

export function generateMetadata() {
  return viewMetadata("rules");
}

export default function Page() {
  return <RulesPage />;
}
