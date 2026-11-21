"use client";

import { createContext, useContext, useState } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Feedback } from "@/components/ui/use-action-feedback";
import type { AccountList } from "./app-location";

/** A value that belongs to the view it was created on. */
type ViewBound<T> = {
  value: T;
  pathname: string;
};

export type AppState = {
  /** Page-level feedback for results without a surviving trigger, such as a bank callback. */
  feedback: ViewBound<Feedback> | null;
  /** Whether the sign-in form replaces the dashboard. */
  locked: boolean;
  /** The period and currency last selected on a view that has them; other views link back to it. */
  periodScope: string;
  /** The list visited last among those that open an account's details; its Back link returns there. */
  accountList: AccountList;
  /** Whether the accounts list showed its archived section when last visited; its Back link restores it. */
  archivedAccountsOpen: boolean;
};

export type AppActions = {
  reportFeedback: (feedback: Feedback) => void;
  dismissFeedback: () => void;
  /** Drops the feedback of other views after a navigation, including Back and Forward. */
  enterView: (pathname: string) => void;
  rememberPeriodScope: (scope: string) => void;
  rememberAccountList: (view: AccountList) => void;
  rememberArchivedAccountsOpen: (open: boolean) => void;
  lock: () => void;
  unlock: () => void;
};

export type AppStore = AppState & AppActions;

/** `locked` is the sign-in state the server resolved for the request. `currentPathname` tells actions which view they were triggered on; feedback is reported from that view's event handlers. */
export function createAppStore(locked: boolean, currentPathname = () => window.location.pathname) {
  return createStore<AppStore>()(set => ({
    feedback: null,
    locked,
    periodScope: "",
    accountList: "accounts",
    archivedAccountsOpen: false,
    reportFeedback: feedback => set({
      feedback: {
        value: feedback,
        pathname: currentPathname()
      }
    }),
    dismissFeedback: () => set({
      feedback: null
    }),
    enterView: pathname => set(state => ({
      feedback: state.feedback?.pathname === pathname ? state.feedback : null
    })),
    rememberPeriodScope: scope => set({
      periodScope: scope
    }),
    rememberAccountList: view => set({
      accountList: view
    }),
    rememberArchivedAccountsOpen: open => set({
      archivedAccountsOpen: open
    }),
    lock: () => set({
      locked: true,
      feedback: null
    }),
    unlock: () => set({
      locked: false
    })
  }));
}

/** A view-bound value, hidden as soon as the current view differs and before it is cleared. */
export function onView<T>(bound: ViewBound<T> | null, pathname: string) {
  return bound && bound.pathname === pathname ? bound.value : null;
}

const AppStoreContext = createContext<StoreApi<AppStore> | null>(null);

/** One store per mounted dashboard layout; the layout also renders on the server, where a shared module store would outlive the request. */
export function AppStoreProvider({
  locked,
  children
}: React.PropsWithChildren<{
  locked: boolean;
}>) {
  const [store] = useState(() => createAppStore(locked));

  return <AppStoreContext value={store}>{children}</AppStoreContext>;
}

export function useAppStoreApi() {
  const store = useContext(AppStoreContext);

  if (!store) {
    throw new Error("Components that read the app store must be rendered inside the dashboard layout.");
  }

  return store;
}

/** Subscribes to one slice of the dashboard UI state; the component re-renders only when that slice changes. */
export function useAppStore<T>(selector: (state: AppStore) => T) {
  return useStore(useAppStoreApi(), selector);
}
