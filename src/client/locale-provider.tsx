"use client";

import { createContext, useContext, useMemo } from "react";
import { defaultFormatLocale } from "@/lib/locale";

type LocaleContextValue = {
  locale: string;
  requestLanguages: readonly string[];
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultFormatLocale,
  requestLanguages: []
});

/** Hands the locale the server resolved for this request to every component, so server rendering and hydration format identically. */
export function LocaleProvider({
  locale,
  requestLanguages,
  children
}: LocaleContextValue & {
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({
    locale,
    requestLanguages
  }), [locale, requestLanguages]);

  return (
    <LocaleContext value={value}>
      {children}
    </LocaleContext>
  );
}

/** The locale for amounts, numbers and dates in this request. */
export function useLocale() {
  return useContext(LocaleContext).locale;
}

/** The languages the browser sent with this request, in its order of preference. */
export function useRequestLanguages() {
  return useContext(LocaleContext).requestLanguages;
}
