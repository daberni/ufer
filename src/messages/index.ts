import type { Language } from "@/lib/language";
import { de } from "./de";
import { en } from "./en";

/** English is the reference catalog; every other language provides the same keys. */
export type Messages = typeof en;

const catalogs: Record<Language, Messages> = {
  en,
  de
};

export function messagesFor(language: Language) {
  return catalogs[language];
}
