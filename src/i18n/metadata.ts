import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

type ViewTitle = "transactions" | "import" | "accounts" | "account" | "brokerage" | "rules";

/** The document title of a view in the request's language. */
export async function viewMetadata(view: ViewTitle): Promise<Metadata> {
  const t = await getTranslations("shell");

  return {
    title: t(`metadata.${view}`)
  };
}
