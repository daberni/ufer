import type { Metadata } from "next";
import { BrokeragePage } from "@/features/dashboard/components/dashboard-views";

export const metadata: Metadata = {
  title: "Brokerage"
};

export default function Page() {
  return <BrokeragePage />;
}
