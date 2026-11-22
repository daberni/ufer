"use client";

import { useRouter } from "next/navigation";
import { useCallback, type MouseEvent } from "react";
import { tabRootEntry } from "./tab-navigation";

// Matches --mobile in src/styles/media.css: the widths where the sidebar is the bottom tab bar.
const tabBarQuery = "(width <= 760px), (width <= 900px) and (pointer: coarse)";

function isPlainClick(event: MouseEvent<HTMLAnchorElement>) {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

  return !event.defaultPrevented && event.button === 0 && !modified;
}

/**
 * Tab-bar links navigate like native app tabs: they go back to the root entry of the app's history and replace it, so Back never steps through previously tapped tabs.
 * Browsers cannot delete history; forward entries remain until the next navigation, and without the Navigation API a tab only replaces the current entry.
 * Wider layouts keep ordinary link history.
 */
export function useTabNavigation() {
  const router = useRouter();

  return useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!isPlainClick(event) || !window.matchMedia(tabBarQuery).matches) {
      return;
    }

    event.preventDefault();
    void navigateToTab(href, router.replace);
  }, [router]);
}

async function navigateToTab(href: string, replace: (href: string) => void) {
  const navigation = window.navigation;
  const current = navigation?.currentEntry;

  if (navigation && current) {
    const root = tabRootEntry(navigation.entries(), current.index);

    if (root) {
      await traverseTo(navigation, root.key);
    }
  }

  replace(href);
}

// Chrome fires popstate only after the traversal's finished promise; replacing earlier lets the App Router's restore of the root page win.
function traverseTo(navigation: Navigation, key: string) {
  return new Promise<void>(resolve => {
    window.addEventListener("popstate", () => resolve(), {
      once: true
    });
    // An interrupted traversal still ends on an app page; replacing it keeps the tab switch.
    void navigation.traverseTo(key).finished?.catch(() => resolve());
  });
}
