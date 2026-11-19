"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./rules-view.module.css";
import { GripVertical, Pencil, Plus, Sparkles } from "lucide-react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Empty } from "@/components/ui/empty-state";
import { LiveAnnouncements } from "@/components/ui/live-announcements";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import type { Category, Rule } from "@/features/categorization/types";
import { settle } from "@/client/settle";
import { useAppStore } from "@/client/app-store";
import { useApplyRules, useToggleRule, useTogglingRules } from "@/features/categorization/mutations";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import type { Area } from "@/components/ui/use-area-result";
import { neutralChipColor } from "@/features/categorization/category-colors";
import { useId, useRef, useState } from "react";
import { CategoryGlyph, CategoryLabel, categoryNameColor } from "./category-label";
import { CategoryDialog } from "./category-form";
import { RuleDialog } from "./create-rule-form";
import { useRuleReorder } from "./use-rule-reorder";

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
      <section className={styles["category-panel"]} aria-label="Your categories">
        {categories.status === "pending" ? (
          <AreaPlaceholder area={categories} subject="Your categories">
            <CategoryGridSkeleton />
          </AreaPlaceholder>
        ) : (
          <CategoryGrid
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
      <section className={clsx(ui["panel"], styles["rule-panel"])} aria-label="Your rules">
        {rules.status === "pending" ? (
          <AreaPlaceholder area={rules} subject="Your rules">
            <RuleRowsSkeleton />
          </AreaPlaceholder>
        ) : (
          <RuleRows
            rules={rules.data}
            reportFailure={(message, traceId) => reportFeedback({
              tone: "problem",
              messages: [message],
              traceId
            })}
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

function CategoryGrid({
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
    <ul className={styles["category-grid"]}>
      {categories.map(category => (
        <li key={category.id}>
          <button
            className={styles["category-tile"]}
            type="button"
            aria-label={`Edit category ${category.name}`}
            title={category.name}
            style={{
              color: categoryNameColor(category)
            }}
            onClick={() => editCategory(category)}
          >
            <CategoryGlyph category={category} />
            <span className={styles["category-name"]}>{category.name}</span>
            <Pencil className={styles["edit-hint"]} aria-hidden="true" size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function CategoryGridSkeleton() {
  return (
    <ul className={styles["category-grid"]}>
      {skeletonNames.map(name => (
        <li key={name}>
          <div className={styles["category-tile"]}>
            <CategoryGlyph
              category={{
                name,
                color: neutralChipColor,
                icon: null
              }}
            />
            <span className={clsx(styles["category-name"], ui["skeleton"])}>{name}</span>
            <Pencil className={clsx(styles["edit-hint"], ui["skeleton"])} aria-hidden="true" size={16} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RuleRows({
  rules,
  reportFailure,
  togglingRules,
  toggleRule,
  editRule
}: {
  rules: Rule[];
  reportFailure: (message: string, traceId?: string) => void;
  togglingRules: string[];
  toggleRule: (rule: Rule) => void;
  editRule: (rule: Rule) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const reorder = useRuleReorder(rules, listRef, reportFailure);
  const hintId = useId();

  if (!rules.length) {
    return <Empty title="Let your transactions sort themselves.">For example: “MARKET” in the payee or description → Groceries. Manual corrections always take precedence.</Empty>;
  }

  return (
    <>
      <p id={hintId} className={ui["visually-hidden"]}>Rules match in this order. Drag the handle, or focus it and use the arrow keys, Home or End, to move a rule. Existing transactions change only when you apply the rules.</p>
      <ol className={styles["rule-list"]} ref={listRef}>
        {reorder.rules.map((rule, index) => (
          <li className={clsx(styles["rule-row"], reorder.draggingId === rule.id && styles["dragging"])} key={rule.id} data-rule-id={rule.id}>
            <button
              className={styles["handle"]}
              type="button"
              aria-label={`Move rule ${rule.name}, position ${index + 1} of ${reorder.rules.length}`}
              aria-describedby={hintId}
              title="Drag to reorder"
              disabled={reorder.rules.length < 2}
              {...reorder.handleProps(rule)}
            >
              <GripVertical aria-hidden="true" size={18} />
            </button>
            <button
              className={styles["rule-name"]}
              type="button"
              title={`${rule.name}: ${rule.pattern} · Priority ${rule.priority}`}
              aria-label={`Edit rule ${rule.name}`}
              onClick={() => editRule(rule)}
            >
              <strong>{rule.name}</strong>
              <Pencil className={styles["edit-hint"]} aria-hidden="true" size={16} />
            </button>
            <div className={styles["rule-pattern"]}>
              <span className={styles["rule-label"]}>{rule.mode === "keyword" ? "Keyword" : "Regex"}</span>
              <code title={rule.pattern}>{rule.pattern}</code>
            </div>
            <div className={styles["rule-details"]}>
              <span className={styles["rule-category"]}>
                <CategoryLabel
                  category={{
                    name: rule.category_name,
                    color: rule.category_color,
                    icon: rule.category_icon
                  }}
                />
              </span>
              <span className={styles["rule-priority"]} title={`Priority ${rule.priority}`}>
                <span className={ui["visually-hidden"]}>Priority </span>
                {rule.priority}
              </span>
            </div>
            <button
              className={clsx(styles["toggle"], rule.enabled && styles["enabled"])}
              type="button"
              role="switch"
              aria-checked={Boolean(rule.enabled)}
              aria-label={`Enable rule ${rule.name}`}
              disabled={togglingRules.includes(rule.id)}
              onClick={() => toggleRule(rule)}
            >
              <span aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <LiveAnnouncements polite={reorder.announcement} assertive="" />
    </>
  );
}

function RuleRowsSkeleton() {
  return (
    <ol className={styles["rule-list"]}>
      {skeletonNames.slice(0, 4).map((name, index) => (
        <li className={styles["rule-row"]} key={name}>
          <span className={styles["handle"]}>
            <GripVertical className={ui["skeleton"]} aria-hidden="true" size={18} />
          </span>
          <span className={styles["rule-name"]}>
            <strong className={ui["skeleton"]}>{name}</strong>
          </span>
          <div className={styles["rule-pattern"]}>
            <span className={styles["rule-label"]}>Keyword</span>
            <code className={ui["skeleton"]}>MARKET</code>
          </div>
          <div className={styles["rule-details"]}>
            <span className={styles["rule-category"]}>
              <CategoryLabel
                className={ui["skeleton"]}
                category={{
                  name,
                  color: neutralChipColor,
                  icon: null
                }}
              />
            </span>
            <span className={styles["rule-priority"]}>
              <span className={ui["visually-hidden"]}>Priority </span>
              <span className={ui["skeleton"]}>{(index + 1) * 10}</span>
            </span>
          </div>
          <span className={styles["toggle"]}>
            <span className={ui["skeleton"]} />
          </span>
        </li>
      ))}
    </ol>
  );
}
