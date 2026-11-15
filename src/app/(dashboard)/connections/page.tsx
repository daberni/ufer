import type { Metadata } from "next";
import { ConnectionsPage } from "@/features/dashboard/components/dashboard-views";

export const metadata: Metadata = {
  title: "Bank connections"
};

export default function Page() {
  return <ConnectionsPage />;
}
