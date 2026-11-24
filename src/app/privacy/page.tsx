import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { PrivacyNotice } from "@/features/legal/components/privacy-notice";
import { legalConfiguration } from "@/features/legal/server/legal-configuration";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy");

  return {
    title: t("metaTitle"),
    description: t("metaDescription")
  };
}

export default async function PrivacyPage() {
  // Operator details are runtime configuration, so the page renders per request instead of at build time.
  await connection();

  return <PrivacyNotice configuration={legalConfiguration()} />;
}
