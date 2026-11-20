"use client";

import { createContext, useContext } from "react";
import { defaultFormatLocale } from "@/lib/locale";

const FormatLocaleContext = createContext(defaultFormatLocale);

/** Hands the locale the server resolved for this request to every component, so server rendering and hydration format identically. */
export function FormatLocaleProvider({
  locale,
  children
}: {
  locale: string;
  children: React.ReactNode;
}) {
  return <FormatLocaleContext value={locale}>{children}</FormatLocaleContext>;
}

/** The locale for amounts, numbers and dates in this request. */
export function useFormatLocale() {
  return useContext(FormatLocaleContext);
}
