import type { Metadata } from "next";
import { ImportPage } from "@/features/dashboard/components/dashboard-views";

export const metadata: Metadata = {
  title: "Import transactions"
};

export default function Page() {
  return <ImportPage />;
}
