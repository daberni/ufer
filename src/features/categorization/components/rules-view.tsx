"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./rules-view.module.css";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { api } from "@/client/api";
import { Empty } from "@/components/ui/empty-state";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "busy" | "perform" | "setModal" | "setSelectedCategory" | "state">;

export function RulesView({
  busy,
  perform,
  setModal,
  setSelectedCategory,
  state
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <>
      <div className={ui["section-heading"]}>
        <span className={ui["section-kicker"]}>LOWER PRIORITY NUMBERS MATCH FIRST</span>
        <div className={ui["button-group"]}>
          <button
            className={ui["button"]}
            disabled={busy}
            onClick={() => perform(() => api("rules/apply", {}), "Rules applied. Manual assignments have been preserved.")}
          >
            <Sparkles size={15} />
            Apply rules
          </button>
          <button className={clsx(ui["button"], ui["primary"])} onClick={() => setModal("rule")}>
            <Plus size={15} />
            Create rule
          </button>
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
                  {rule.category_name}
                </span>
                <button
                  className={clsx(styles["toggle"], rule.enabled ? styles["enabled"] : "")}
                  role="switch"
                  aria-checked={Boolean(rule.enabled)}
                  aria-label={`Enable rule ${rule.name}`}
                  disabled={busy}
                  onClick={() => perform(() => api(`rules/${rule.id}`, {
                    enabled: !rule.enabled
                  }, "PATCH"))}
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
            <i
              className={ui["legend-dot"]}
              style={{
                background: category.color
              }}
            />
            {category.name}
            {category.is_transfer ? " · excluded from cash flow" : ""}
            <Pencil size={13} />
          </button>
        ))}
      </div>
    </>
  );
}
