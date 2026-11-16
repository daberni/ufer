"use client";

import { createContext, useContext, useState } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Feedback } from "@/components/ui/use-action-feedback";
import type { ImportMode } from "@/features/imports/mutations";
import type { Account, Category, Connection } from "./types";

/** A dialog with the data it needs; it cannot be opened without that data. */
export type DashboardDialog = {
  kind: "account";
} | {
  kind: "bank";
  /** The connection to reauthorize; null connects a new bank. */
  connection: Connection | null;
} | {
  kind: "removeConnection";
  connection: Connection;
} | {
  kind: "rule";
} | {
  kind: "import";
  mode: ImportMode;
} | {
  kind: "balance";
  account: Account;
} | {
  kind: "category";
} | {
  kind: "editCategory";
  category: Category;
};

export type DialogKind = DashboardDialog["kind"];

/** A value that belongs to the view it was created on. */
type ViewBound<T> = {
  value: T;
  pathname: string;
};

export type DashboardState = {
  dialog: ViewBound<DashboardDialog> | null;
  /** Page-level feedback for results without a surviving trigger, such as a bank callback. */
  feedback: ViewBound<Feedback> | null;
  /** Whether the sign-in form replaces the dashboard. */
  locked: boolean;
  /** The period and currency last selected on a view that has them; other views link back to it. */
  periodScope: string;
};

export type DashboardActions = {
  openDialog: (dialog: DashboardDialog) => void;
  closeDialog: () => void;
  reportFeedback: (feedback: Feedback) => void;
  dismissFeedback: () => void;
  /** Drops the dialog and feedback of other views after a navigation, including Back and Forward. */
  enterView: (pathname: string) => void;
  rememberPeriodScope: (scope: string) => void;
  lock: () => void;
  unlock: () => void;
};

export type DashboardStore = DashboardState & DashboardActions;

const initialState: DashboardState = {
  dialog: null,
  feedback: null,
  locked: false,
  periodScope: ""
};

/** `currentPathname` tells actions which view they were triggered on; dialogs and feedback are opened from that view's event handlers. */
export function createDashboardStore(currentPathname = () => window.location.pathname) {
  return createStore<DashboardStore>()(set => ({
    ...initialState,
    openDialog: dialog => set({
      dialog: {
        value: dialog,
        pathname: currentPathname()
      }
    }),
    closeDialog: () => set({
      dialog: null
    }),
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
      dialog: state.dialog?.pathname === pathname ? state.dialog : null,
      feedback: state.feedback?.pathname === pathname ? state.feedback : null
    })),
    rememberPeriodScope: scope => set({
      periodScope: scope
    }),
    lock: () => set({
      locked: true,
      dialog: null,
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

const DashboardStoreContext = createContext<StoreApi<DashboardStore> | null>(null);

/** One store per mounted dashboard layout; the layout also renders on the server, where a shared module store would outlive the request. */
export function DashboardStoreProvider({ children }: {
  children: React.ReactNode
}) {
  const [store] = useState(() => createDashboardStore());

  return <DashboardStoreContext value={store}>{children}</DashboardStoreContext>;
}

export function useDashboardStoreApi() {
  const store = useContext(DashboardStoreContext);

  if (!store) {
    throw new Error("Dashboard components must be rendered inside the dashboard layout.");
  }

  return store;
}

/** Subscribes to one slice of the dashboard UI state; the component re-renders only when that slice changes. */
export function useDashboardStore<T>(selector: (state: DashboardStore) => T) {
  return useStore(useDashboardStoreApi(), selector);
}
