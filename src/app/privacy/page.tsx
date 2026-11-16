import type { Metadata } from "next";
import { connection } from "next/server";
import { PrivacyNotice } from "@/features/legal/components/privacy-notice";
import { legalConfiguration } from "@/features/legal/server/legal-configuration";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How this Ufer installation processes personal data."
};

export default async function PrivacyPage() {
  // Operator details are runtime configuration, so the page renders per request instead of at build time.
  await connection();

  return <PrivacyNotice configuration={legalConfiguration()} />;
}
