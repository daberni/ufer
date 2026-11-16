import type { Metadata } from "next";
import { connection } from "next/server";
import { TermsOfUse } from "@/features/legal/components/terms-of-use";
import { legalConfiguration } from "@/features/legal/server/legal-configuration";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "Terms for using this Ufer installation."
};

export default async function TermsPage() {
  // Operator details are runtime configuration, so the page renders per request instead of at build time.
  await connection();

  return <TermsOfUse configuration={legalConfiguration()} />;
}
