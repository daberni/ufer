"use client";

import ui from "../../../components/ui/primitives.module.css";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { RuleFromAssignmentDialog } from "@/features/categorization/components/rule-from-assignment-form";

type RuleDraft = {
  categoryId: string;
  counterparty: string;
  description: string;
};

type RuleActions = {
  open: (draft: RuleDraft) => void;
  clearAnnouncement: () => void;
};

function createdText(categorized: number) {
  if (categorized === 0) {
    return "Rule created.";
  }

  return `Rule created; ${categorized.toLocaleString("en")} ${categorized === 1 ? "transaction" : "transactions"} categorized.`;
}

const RuleContext = createContext<RuleActions | null>(null);

export function useTransactionRules() {
  const actions = useContext(RuleContext);

  if (!actions) {
    throw new Error("Transaction category actions require their panel's rule provider.");
  }

  return actions;
}

/** Keeps an explicitly opened draft outside rows that a filter or background refresh can remove. */
export function TransactionRuleProvider({
  children,
  fallbackFocus
}: {
  children?: ReactNode;
  fallbackFocus: RefObject<HTMLElement | null>;
}) {
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (draft !== null) {
      return;
    }

    const previous = opener.current;

    opener.current = null;

    // The shared dialog restores its opener when present; a removed row needs a stable destination instead.
    if (previous && !previous.isConnected) {
      fallbackFocus.current?.focus();
    }
  }, [draft, fallbackFocus]);

  function open(next: RuleDraft) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAnnouncement("");
    setDraft({
      ...next
    });
  }

  return (
    <RuleContext
      value={{
        open,
        clearAnnouncement: () => setAnnouncement("")
      }}
    >
      {children}
      <span className={ui["visually-hidden"]} role="status" aria-live="polite">{announcement}</span>
      {draft && (
        <RuleFromAssignmentDialog
          counterparty={draft.counterparty}
          description={draft.description}
          categoryId={draft.categoryId}
          close={() => setDraft(null)}
          onCreated={categorized => setAnnouncement(createdText(categorized))}
        />
      )}
    </RuleContext>
  );
}
