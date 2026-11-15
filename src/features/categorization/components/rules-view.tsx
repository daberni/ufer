"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./rules-view.module.css";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { api } from "@/client/api";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Empty } from "@/components/ui/empty-state";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import type { Rule } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { CategoryMarker } from "./category-marker";

type Props = Pick<DashboardController, "busy" | "perform" | "reportFeedback" | "setModal" | "setSelectedCategory" | "state">;

export function RulesView({
  busy,
  perform,
  reportFeedback,
  setModal,
  setSelectedCategory,
  state
}: Props) {
  const applyFeedback = useActionFeedback();

  if (!state) {
    return null;
  }

  async function applyRules() {
    applyFeedback.dismiss();
    const result = await perform(() => api("rules/apply", {}));

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
    const result = await perform(() => api(`rules/${rule.id}`, {
      enabled: !rule.enabled
    }, "PATCH"));

    if (!result.ok) {
      reportFeedback({
        tone: "problem",
        messages: [`Rule “${rule.name}” could not be ${rule.enabled ? "disabled" : "enabled"}: ${result.message}`]
      });
    }
  }

  return (
    <>
      <div className={ui["section-heading"]}>
        <span className={ui["section-kicker"]}>LOWER PRIORITY NUMBERS MATCH FIRST</span>
        <div className={clsx(ui["button-group"], styles["rule-actions"])}>
          <button
            className={ui["button"]}
            disabled={busy}
            onClick={applyRules}
          >
            <Sparkles size={15} />
            Apply rules
          </button>
          <button className={clsx(ui["button"], ui["primary"])} onClick={() => setModal("rule")}>
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
        {state.rules.length ? (
          <div className={styles["rules-list"]}>
            {state.rules.map(rule => (
              <div className={styles["rule-row"]} key={rule.id}>
                <span className={styles["rule-priority"]}>{rule.priority}</span>
                <div>
                  <strong>{rule.name}</strong>
                  <p>
                    <code>{rule.pattern}</code> · {rule.mode === "keyword" ? "Keyword" : "Regex"}
                  </p>
                </div>
                <span
                  className={styles["pill"]}
                  style={{
                    color: rule.category_color
                  }}
                >
                  <CategoryMarker icon={rule.category_icon} color={rule.category_color} size="small" />
                  {rule.category_name}
                </span>
                <button
                  className={clsx(styles["toggle"], rule.enabled ? styles["enabled"] : "")}
                  role="switch"
                  aria-checked={Boolean(rule.enabled)}
                  aria-label={`Enable rule ${rule.name}`}
                  disabled={busy}
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
        <button className={clsx(ui["button"], ui["small"])} onClick={() => setModal("category")}>
          <Plus size={14} />
          Category
        </button>
      </div>
      <div className={styles["category-chips"]}>
        {state.categories.map(category => (
          <button
            className={styles["category-chip"]}
            key={category.id}
            aria-label={`Edit category ${category.name}`}
            onClick={() => {
              setSelectedCategory(category);
              setModal("editCategory");
            }}
          >
            <CategoryMarker icon={category.icon} color={category.color} />
            {category.name}
            {category.is_transfer ? " · excluded from cash flow" : ""}
            <Pencil className={styles["edit-hint"]} aria-hidden="true" size={11} />
          </button>
        ))}
      </div>
    </>
  );
}
