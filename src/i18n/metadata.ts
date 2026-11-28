import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

type ViewTitle = "insights" | "transactions" | "import" | "accounts" | "account" | "holding" | "brokerage" | "rules";

/** The document title of a view in the request's language. */
export async function viewMetadata(view: ViewTitle): Promise<Metadata> {
  const t = await getTranslations("shell");

  return {
    title: t(`metadata.${view}`)
  };
}
