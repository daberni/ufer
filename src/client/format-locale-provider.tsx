"use client";

import { createContext, useContext, useMemo } from "react";
import { defaultFormatLocale } from "@/lib/locale";

type FormatLocaleContextValue = {
  locale: string;
  requestLanguages: readonly string[];
};

const FormatLocaleContext = createContext<FormatLocaleContextValue>({
  locale: defaultFormatLocale,
  requestLanguages: []
});

/** Hands the locale the server resolved for this request to every component, so server rendering and hydration format identically. */
export function FormatLocaleProvider({
  locale,
  requestLanguages,
  children
}: FormatLocaleContextValue & {
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({
    locale,
    requestLanguages
  }), [locale, requestLanguages]);

  return (
    <FormatLocaleContext value={value}>
      {children}
    </FormatLocaleContext>
  );
}

/** The locale for amounts, numbers and dates in this request. */
export function useFormatLocale() {
  return useContext(FormatLocaleContext).locale;
}

/** The languages the browser sent with this request, in its order of preference. */
export function useRequestLanguages() {
  return useContext(FormatLocaleContext).requestLanguages;
}
