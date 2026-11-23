import { viewMetadata } from "@/i18n/metadata";
import { ImportPage } from "@/features/dashboard/components/dashboard-views";

export function generateMetadata() {
  return viewMetadata("import");
}

export default function Page() {
  return <ImportPage />;
}
