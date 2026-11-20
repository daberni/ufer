"use client";

import ui from "../../../components/ui/primitives.module.css";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { RuleFromAssignmentDialog } from "@/features/categorization/components/rule-from-assignment-form";
import { RuleDialog } from "@/features/categorization/components/create-rule-form";
import { useRules } from "@/features/categorization/queries";
import type { Rule } from "@/features/categorization/types";
import { formatCount } from "@/lib/locale";
import { useLocale } from "@/client/locale-provider";

type RuleDraft = {
  transactionId: string;
  categoryId: string;
  counterparty: string;
  description: string;
};

type RuleActions = {
  /** Opens a draft from a row; focus returns to the element with `fieldId`, the row's category field, when the control that opened it is gone. */
  open: (draft: RuleDraft, fieldId: string) => void;
  /** Opens a stored rule's editor, for example the rule that assigned a transaction's category. */
  edit: (rule: Rule, fieldId: string) => void;
  /** A stored rule by ID; undefined while the rules load or for a rule deleted since. */
  findRule: (id: string | null) => Rule | undefined;
  clearAnnouncement: () => void;
};

function createdText(categorized: number, locale: string) {
  if (categorized === 0) {
    return "Rule created.";
  }

  return `Rule created; ${formatCount(categorized, locale)} ${categorized === 1 ? "transaction" : "transactions"} categorized.`;
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
  const locale = useLocale();
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [editedRule, setEditedRule] = useState<Rule | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const opener = useRef<{
    element: HTMLElement | null;
    fieldId: string;
  } | null>(null);
  const storedRules = useRules();

  const dialogOpen = draft !== null || editedRule !== null;

  // The shared dialog restores focus to the row action that opened it, but a saved rule replaces that action and the refreshed list can arrive
  // after the dialog closed. Until focus has moved on, a lost focus returns to the row's category field, or to the panel when the row is gone,
  // without scrolling the page away from where the person was working.
  useEffect(() => {
    const previous = opener.current;

    if (dialogOpen || !previous) {
      return;
    }

    const active = document.activeElement;
    const focusLost = active === null || active === document.body || active === previous.element;

    if (!focusLost) {
      opener.current = null;

      return;
    }

    if (previous.element?.isConnected) {
      return;
    }

    opener.current = null;
    const destination = document.getElementById(previous.fieldId) ?? fallbackFocus.current;

    destination?.focus({
      preventScroll: true
    });
  });

  function rememberOpener(fieldId: string) {
    opener.current = {
      element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      fieldId
    };
    setAnnouncement("");
  }

  function open(next: RuleDraft, fieldId: string) {
    rememberOpener(fieldId);
    setDraft({
      ...next
    });
  }

  function edit(rule: Rule, fieldId: string) {
    rememberOpener(fieldId);
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
          onCreated={categorized => setAnnouncement(createdText(categorized, locale))}
        />
      )}
      {editedRule && <RuleDialog rule={editedRule} close={() => setEditedRule(null)} />}
    </RuleContext>
  );
}
