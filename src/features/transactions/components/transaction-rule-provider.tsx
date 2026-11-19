"use client";

import ui from "../../../components/ui/primitives.module.css";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { RuleFromAssignmentDialog } from "@/features/categorization/components/rule-from-assignment-form";
import { RuleDialog } from "@/features/categorization/components/create-rule-form";
import { useRules } from "@/features/categorization/queries";
import type { Rule } from "@/features/categorization/types";

type RuleDraft = {
  transactionId: string;
  categoryId: string;
  counterparty: string;
  description: string;
};

type RuleActions = {
  open: (draft: RuleDraft) => void;
  /** Opens a stored rule's editor, for example the rule that assigned a transaction's category. */
  edit: (rule: Rule) => void;
  /** A stored rule by ID; undefined while the rules load or for a rule deleted since. */
  findRule: (id: string | null) => Rule | undefined;
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
  const [editedRule, setEditedRule] = useState<Rule | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const storedRules = useRules();

  const dialogOpen = draft !== null || editedRule !== null;

  useEffect(() => {
    if (dialogOpen) {
      return;
    }

    const previous = opener.current;

    opener.current = null;

    // The shared dialog restores its opener when present; a removed row needs a stable destination instead.
    if (previous && !previous.isConnected) {
      fallbackFocus.current?.focus();
    }
  }, [dialogOpen, fallbackFocus]);

  function rememberOpener() {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAnnouncement("");
  }

  function open(next: RuleDraft) {
    rememberOpener();
    setDraft({
      ...next
    });
  }

  function edit(rule: Rule) {
    rememberOpener();
    setEditedRule(rule);
  }

  return (
    <RuleContext
      value={{
        open,
        edit,
        findRule: id => storedRules.data?.find(rule => rule.id === id),
        clearAnnouncement: () => setAnnouncement("")
      }}
    >
      {children}
      <span className={ui["visually-hidden"]} role="status" aria-live="polite">{announcement}</span>
      {draft && (
        <RuleFromAssignmentDialog
          transactionId={draft.transactionId}
          counterparty={draft.counterparty}
          description={draft.description}
          categoryId={draft.categoryId}
          close={() => setDraft(null)}
          onCreated={categorized => setAnnouncement(createdText(categorized))}
        />
      )}
      {editedRule && <RuleDialog rule={editedRule} close={() => setEditedRule(null)} />}
    </RuleContext>
  );
}
