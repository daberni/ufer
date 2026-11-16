import type { Metadata } from "next";
import { RulesPage } from "@/features/dashboard/components/dashboard-views";

export const metadata: Metadata = {
  title: "Categories & rules"
};

export default function Page() {
  return <RulesPage />;
}
