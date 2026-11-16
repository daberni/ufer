"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./rules-view.module.css";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Empty } from "@/components/ui/empty-state";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import type { Category, Rule } from "@/features/dashboard/types";
import { settle } from "@/client/settle";
import { useDashboardStore } from "@/features/dashboard/dashboard-store";
import { useApplyRules, useToggleRule, useTogglingRules } from "@/features/categorization/mutations";
import { useState } from "react";
import { CategoryChip } from "./category-chip";
import { CategoryDialog } from "./category-form";
import { CreateRuleDialog } from "./create-rule-form";

type Props = {
  categories: Category[];
  rules: Rule[];
};

type OpenDialog = {
  kind: "rule";
} | {
  kind: "category";
  /** The category to edit; null adds one. */
  category: Category | null;
};

export function RulesView({
  categories,
  rules
}: Props) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const reportFeedback = useDashboardStore(state => state.reportFeedback);
  const applyFeedback = useActionFeedback();
  const apply = useApplyRules();
  const toggle = useToggleRule();

  async function applyRules() {
    applyFeedback.dismiss();
    const result = await settle(apply.mutateAsync());

    applyFeedback.report(result.ok ? {
      tone: "success",
      messages: ["Rules applied. Manual assignments have been preserved."]
    } : {
      tone: "problem",
      messages: [`Rules could not be applied: ${result.message}`]
    });
  }

  // A rule row has no room for an anchored message, so a failed toggle uses the page overlay.
  async function toggleRule(rule: Rule) {
    const result = await settle(toggle.mutateAsync(rule));

    if (!result.ok) {
      reportFeedback({
        tone: "problem",
        messages: [`Rule “${rule.name}” could not be ${rule.enabled ? "disabled" : "enabled"}: ${result.message}`]
      });
    }
  }

  const togglingRules = useTogglingRules();

  return (
    <>
      <div className={ui["section-heading"]}>
        <span className={ui["section-kicker"]}>LOWER PRIORITY NUMBERS MATCH FIRST</span>
        <div className={clsx(ui["button-group"], styles["rule-actions"])}>
          <button
            className={ui["button"]}
            disabled={apply.isPending}
            aria-busy={apply.isPending}
            onClick={applyRules}
          >
            <Sparkles size={15} />
            Apply rules
          </button>
          <button
            className={clsx(ui["button"], ui["primary"])}
            onClick={() => setDialog({
              kind: "rule"
            })}
          >
            <Plus size={15} />
            Create rule
          </button>
          <ActionFeedback
            feedback={applyFeedback.feedback}
            dismissLabel="Dismiss rules status"
            onDismiss={applyFeedback.dismiss}
            placement="anchored"
          />
        </div>
      </div>
      <section className={ui["panel"]}>
        {rules.length ? (
          <div>
            {rules.map(rule => (
              <div className={styles["rule-row"]} key={rule.id}>
                <span className={styles["rule-priority"]}>{rule.priority}</span>
                <div>
                  <strong>{rule.name}</strong>
                  <p>
                    <code>{rule.pattern}</code> · {rule.mode === "keyword" ? "Keyword" : "Regex"}
                  </p>
                </div>
                <CategoryChip
                  className={styles["rule-category"]}
                  category={{
                    name: rule.category_name,
                    color: rule.category_color,
                    icon: rule.category_icon
                  }}
                  size="small"
                />
                <button
                  className={clsx(styles["toggle"], rule.enabled ? styles["enabled"] : "")}
                  role="switch"
                  aria-checked={Boolean(rule.enabled)}
                  aria-label={`Enable rule ${rule.name}`}
                  disabled={togglingRules.includes(rule.id)}
                  onClick={() => toggleRule(rule)}
                >
                  <span />
                </button>
              </div>
            ))}
          </div>
        ) : <Empty title="Let your transactions sort themselves.">For example: “MARKET” in the payee or description → Groceries. Manual corrections always take precedence.</Empty>}
      </section>
      <div className={ui["section-heading"]}>
        <h2>Your categories</h2>
        <button
          className={clsx(ui["button"], ui["small"])}
          onClick={() => setDialog({
            kind: "category",
            category: null
          })}
        >
          <Plus size={14} />
          Category
        </button>
      </div>
      <div className={styles["category-chips"]}>
        {categories.map(category => (
          <button
            className={styles["category-chip"]}
            key={category.id}
            aria-label={`Edit category ${category.name}`}
            onClick={() => setDialog({
              kind: "category",
              category
            })}
          >
            <CategoryChip category={category}>
              {category.is_transfer ? <span className={styles["chip-detail"]}>· excluded from cash flow</span> : null}
              <Pencil className={styles["edit-hint"]} aria-hidden="true" strokeWidth={2.2} />
            </CategoryChip>
          </button>
        ))}
      </div>
      {dialog?.kind === "rule" && <CreateRuleDialog close={closeDialog} />}
      {dialog?.kind === "category" && <CategoryDialog category={dialog.category} close={closeDialog} />}
    </>
  );
}
