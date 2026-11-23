import type { useTranslations } from "next-intl";

/** The `imports` messages, handed from components to the parsing and planning modules that word row and field problems. */
export type ImportMessages = ReturnType<typeof useTranslations<"imports">>;
