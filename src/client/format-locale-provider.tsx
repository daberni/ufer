"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { fallbackLocale, resolveFormatLocale, setFormatLocale, storedFormatLocalePreference } from "@/lib/locale";

// A changed preference reloads the page, so the browser's locale never changes while it is open.
function subscribe() {
  return () => {};
}

let browserLocale: string | undefined;

function browserFormatLocale() {
  browserLocale ??= resolveFormatLocale(storedFormatLocalePreference(), navigator.languages);

  return browserLocale;
}

function serverFormatLocale() {
  return fallbackLocale;
}

/**
 * Switches the shared formatters to the browser's locale once hydration has finished with the server's fallback.
 * The formatters are plain functions, so the application mounts again in the new locale; it is removed first so that no data subscription sees two copies at once.
 * Both steps happen in layout effects before the browser paints, and amounts load only after mount, so nothing visibly changes format.
 */
export function FormatLocaleProvider({ children }: {
  children: React.ReactNode
}) {
  const locale = useSyncExternalStore(subscribe, browserFormatLocale, serverFormatLocale);
  const [renderedLocale, setRenderedLocale] = useState(fallbackLocale);

  useLayoutEffect(() => {
    if (renderedLocale === locale) {
      return;
    }

    setFormatLocale(locale);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the second step must follow the commit that removed the fallback-locale tree.
    setRenderedLocale(locale);
  }, [locale, renderedLocale]);

  if (renderedLocale !== locale) {
    return null;
  }

  return children;
}
