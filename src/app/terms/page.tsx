import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { TermsOfUse } from "@/features/legal/components/terms-of-use";
import { legalConfiguration } from "@/features/legal/server/legal-configuration";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.terms");

  return {
    title: t("metaTitle"),
    description: t("metaDescription")
  };
}

export default async function TermsPage() {
  // Operator details are runtime configuration, so the page renders per request instead of at build time.
  await connection();

  return <TermsOfUse configuration={legalConfiguration()} />;
}
