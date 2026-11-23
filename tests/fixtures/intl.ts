import { render as renderElement, type RenderOptions } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { messagesFor } from "../../src/messages";
import type { Language } from "../../src/lib/language";

/** Provides the interface language and its catalog, as the root layout does for every page. */
export function withIntl(children: ReactNode, language: Language = "en") {
  return createElement(NextIntlClientProvider, {
    locale: language,
    messages: messagesFor(language),
    // Messages never format dates themselves; a fixed zone keeps next-intl from warning about an environment fallback.
    timeZone: "UTC",
    children
  });
}

/** Testing Library's render inside the English catalog, around any wrapper the test adds; rerender keeps both. */
export function render(ui: Parameters<typeof renderElement>[0], options?: RenderOptions) {
  const Inner = options?.wrapper;

  return renderElement(ui, {
    ...options,
    wrapper: ({ children }) => withIntl(Inner ? createElement(Inner, null, children) : children)
  });
}
