"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./rules-view.module.css";
import { Pencil, Plus, Sparkles } from "lucide-react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Empty } from "@/components/ui/empty-state";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import type { Category, Rule } from "@/features/categorization/types";
import { settle } from "@/client/settle";
import { useAppStore } from "@/client/app-store";
import { useApplyRules, useToggleRule, useTogglingRules } from "@/features/categorization/mutations";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import type { Area } from "@/components/ui/use-area-result";
import { neutralChipColor } from "@/features/categorization/category-colors";
import { useState } from "react";
import { CategoryLabel } from "./category-label";
import { CategoryDialog } from "./category-form";
import { RuleDialog } from "./create-rule-form";

type Props = {
  categories: Area<Category[]>;
  rules: Area<Rule[]>;
};

type OpenDialog = {
  kind: "rule";
  rule: Rule | null;
} | {
  kind: "category";
  /** The category to edit; null adds one. */
  category: Category | null;
};

// Names of different lengths give the skeleton rules and categories a natural outline.
const skeletonNames = ["Groceries", "Rent", "Public transport", "Salary", "Restaurants", "Insurance"];

export function RulesView({
  categories,
  rules
}: Props) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const reportFeedback = useAppStore(state => state.reportFeedback);
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
      messages: [`Rules could not be applied: ${result.failure.message}`],
      traceId: result.failure.traceId
    });
  }

  // A rule row has no room for an anchored message, so a failed toggle uses the page overlay.
  async function toggleRule(rule: Rule) {
    const result = await settle(toggle.mutateAsync(rule));

    if (!result.ok) {
      reportFeedback({
        tone: "problem",
        messages: [`Rule “${rule.name}” could not be ${rule.enabled ? "disabled" : "enabled"}: ${result.failure.message}`],
        traceId: result.failure.traceId
      });
    }
  }

  const togglingRules = useTogglingRules();

  return (
    <>
      <div className={ui["section-heading"]}>
        <h2>Your categories</h2>
        <button
          className={clsx(ui["button"], ui["primary"])}
          onClick={() => setDialog({
            kind: "category",
            category: null
          })}
        >
          <Plus size={16} />
          Add category
        </button>
      </div>
      <section className={ui["panel"]} aria-label="Your categories">
        {categories.status === "pending" ? (
          <AreaPlaceholder area={categories} subject="Your categories">
            <CategoryRowsSkeleton />
          </AreaPlaceholder>
        ) : (
          <CategoryRows
            categories={categories.data}
            editCategory={category => setDialog({
              kind: "category",
              category
            })}
          />
        )}
      </section>
      <div className={ui["section-heading"]}>
        <h2>Your rules</h2>
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
            className={ui["button"]}
            onClick={() => setDialog({
              kind: "rule",
              rule: null
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
      <section className={ui["panel"]} aria-label="Your rules">
        {rules.status === "pending" ? (
          <AreaPlaceholder area={rules} subject="Your rules">
            <RuleRowsSkeleton />
          </AreaPlaceholder>
        ) : (
          <RuleRows
            rules={rules.data}
            togglingRules={togglingRules}
            toggleRule={toggleRule}
            editRule={rule => setDialog({
              kind: "rule",
              rule
            })}
          />
        )}
      </section>
      {dialog?.kind === "rule" && <RuleDialog rule={dialog.rule} close={closeDialog} />}
      {dialog?.kind === "category" && <CategoryDialog category={dialog.category} close={closeDialog} />}
    </>
  );
}

function CategoryRows({
  categories,
  editCategory
}: {
  categories: Category[];
  editCategory: (category: Category) => void;
}) {
  if (!categories.length) {
    return <Empty title="Make your spending yours.">Add a category to organize your transactions.</Empty>;
  }

  return (
    <ul className={styles["category-list"]}>
      {categories.map(category => (
        <li key={category.id}>
          <button
            className={styles["category-row"]}
            type="button"
            aria-label={`Edit category ${category.name}`}
            onClick={() => editCategory(category)}
          >
            <CategoryLabel category={category} />
            <Pencil className={styles["edit-hint"]} aria-hidden="true" size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function CategoryRowsSkeleton() {
  return (
    <ul className={styles["category-list"]}>
      {skeletonNames.map(name => (
        <li className={styles["category-row"]} key={name}>
          <CategoryLabel
            className={ui["skeleton"]}
            category={{
              name,
              color: neutralChipColor,
              icon: null
            }}
          />
        </li>
      ))}
    </ul>
  );
}

function RuleRows({
  rules,
  togglingRules,
  toggleRule,
  editRule
}: {
  rules: Rule[];
  togglingRules: string[];
  toggleRule: (rule: Rule) => void;
  editRule: (rule: Rule) => void;
}) {
  if (!rules.length) {
    return <Empty title="Let your transactions sort themselves.">For example: “MARKET” in the payee or description → Groceries. Manual corrections always take precedence.</Empty>;
  }

  return (
    <div>
      {rules.map(rule => (
        <div className={styles["rule-row"]} key={rule.id}>
          <span className={styles["rule-priority"]}>{rule.priority}</span>
          <div>
            <button
              className={clsx(ui["text-button"], styles["rule-name"])}
              type="button"
              aria-label={`Edit rule ${rule.name}`}
              onClick={() => editRule(rule)}
            >
              <strong>{rule.name}</strong>
              <Pencil className={styles["edit-hint"]} aria-hidden="true" size={16} />
            </button>
            <p>
              <code>{rule.pattern}</code> · {rule.mode === "keyword" ? "Keyword" : "Regex"}
            </p>
          </div>
          <CategoryLabel
            className={styles["rule-category"]}
            category={{
              name: rule.category_name,
              color: rule.category_color,
              icon: rule.category_icon
            }}
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
  );
}

function RuleRowsSkeleton() {
  return (
    <div>
      {skeletonNames.slice(0, 4).map((name, index) => (
        <div className={styles["rule-row"]} key={name}>
          <span className={styles["rule-priority"]}>
            <span className={ui["skeleton"]}>{(index + 1) * 10}</span>
          </span>
          <div>
            <span className={styles["rule-name"]}><strong className={ui["skeleton"]}>{name}</strong></span>
            <p>
              <span className={ui["skeleton"]}>MARKET · Keyword</span>
            </p>
          </div>
          <CategoryLabel
            className={clsx(styles["rule-category"], ui["skeleton"])}
            category={{
              name,
              color: neutralChipColor,
              icon: null
            }}
          />
          <span className={clsx(styles["toggle"], ui["skeleton"])} />
        </div>
      ))}
    </div>
  );
}
