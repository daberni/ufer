"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./rules-view.module.css";
import { GripVertical, Landmark, Pencil, Plus, Sparkles } from "lucide-react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { Empty } from "@/components/ui/empty-state";
import { ActionMenu, MenuItem } from "@/components/ui/action-menu";
import { FormError } from "@/components/ui/form-error";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import type { Category, Rule } from "@/features/categorization/types";
import { settle } from "@/client/settle";
import { useAppStore } from "@/client/app-store";
import { useApplyRules, useSavingRuleOrder, useToggleRule, useTogglingRules } from "@/features/categorization/mutations";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { mapArea, type Area } from "@/components/ui/use-area-result";
import { SectionHeading } from "@/components/ui/section-heading";
import { neutralChipColor } from "@/features/categorization/category-colors";
import { useState } from "react";
import { CategoryGlyph, CategoryLabel, categoryNameColor } from "./category-label";
import { TransactionTypeIcon } from "@/features/transactions/components/transaction-type";
import { CategoryDialog } from "./category-form";
import { RuleDialog } from "./create-rule-form";
import { closestCenter, DndContext, DragOverlay } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRuleReorder, verticalOnly } from "./use-rule-reorder";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/ui/tooltip";

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
const skeletonNames = ["Groceries", "Rent", "Public transport", "Salary", "Restaurants", "Insurance", "Leisure", "Health", "Utilities"];

export function RulesView({
  categories,
  rules
}: Props) {
  const t = useTranslations("categorization.rules");
  const tCategories = useTranslations("categorization.categories");
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const reportFeedback = useAppStore(state => state.reportFeedback);
  const applyFeedback = useActionFeedback();
  const apply = useApplyRules();
  const savingOrder = useSavingRuleOrder();
  const toggle = useToggleRule();

  async function applyRules() {
    applyFeedback.dismiss();
    const result = await settle(apply.mutateAsync());

    applyFeedback.report(result.ok ? {
      tone: "success",
      messages: [t("applied")]
    } : {
      tone: "problem",
      messages: [t("applyFailed", {
        message: result.failure.message
      })],
      traceId: result.failure.traceId
    });
  }

  // A rule row has no room for an anchored message, so a failed toggle uses the page overlay.
  async function toggleRule(rule: Rule) {
    const result = await settle(toggle.mutateAsync(rule));

    if (!result.ok) {
      reportFeedback({
        tone: "problem",
        messages: [t(rule.enabled ? "disableFailed" : "enableFailed", {
          rule: rule.name,
          message: result.failure.message
        })],
        traceId: result.failure.traceId
      });
    }
  }

  const togglingRules = useTogglingRules();
  const applyLabel = savingOrder ? t("savingOrder") : t("apply");
  const createRule = () => setDialog({
    kind: "rule",
    rule: null
  });

  return (
    <>
      <SectionHeading title={tCategories("title")} count={mapArea(categories, data => data.length)}>
        <button
          className={clsx(ui["button"], ui["primary"])}
          onClick={() => setDialog({
            kind: "category",
            category: null
          })}
        >
          <Plus size={16} />
          {tCategories("add")}
        </button>
      </SectionHeading>
      <section className={styles["category-panel"]} aria-label={tCategories("yours")}>
        {categories.status === "pending" ? (
          <AreaPlaceholder area={categories} failureTitle={tCategories("loadFailed")}>
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
      <SectionHeading title={t("title")} count={mapArea(rules, data => data.length)}>
        <button
          className={clsx(ui["button"], ui["phone-hidden"])}
          disabled={apply.isPending || savingOrder}
          aria-busy={apply.isPending || savingOrder}
          onClick={applyRules}
        >
          <Sparkles size={15} />
          {applyLabel}
        </button>
        <button className={clsx(ui["button"], ui["phone-hidden"])} onClick={createRule}>
          <Plus size={15} />
          {t("create")}
        </button>
        <ActionMenu label={t("actions")} appearance="button" phoneOnly>
          <MenuItem icon={<Sparkles size={15} aria-hidden="true" />} disabled={apply.isPending || savingOrder} onSelect={applyRules}>
            {applyLabel}
          </MenuItem>
          <MenuItem icon={<Plus size={15} aria-hidden="true" />} onSelect={createRule}>
            {t("create")}
          </MenuItem>
        </ActionMenu>
        <ActionFeedback
          feedback={applyFeedback.feedback}
          dismissLabel={t("dismissStatus")}
          onDismiss={applyFeedback.dismiss}
          placement="anchored"
        />
      </SectionHeading>
      <section className={clsx(ui["panel"], styles["rule-panel"])} aria-label={t("yours")}>
        {rules.status === "pending" ? (
          <AreaPlaceholder area={rules} failureTitle={t("loadFailed")}>
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

function CategoryGrid({
  categories,
  editCategory
}: {
  categories: Category[];
  editCategory: (category: Category) => void;
}) {
  const t = useTranslations("categorization.categories");

  if (!categories.length) {
    return <Empty title={t("emptyTitle")}>{t("empty")}</Empty>;
  }

  return (
    <ul className={styles["category-grid"]}>
      {categories.map(category => (
        <li key={category.id}>
          <Tooltip text={category.name} describes={false} onlyWhenTruncated>
            {trigger => (
              <button
                {...trigger}
                className={styles["category-tile"]}
                type="button"
                aria-label={t("edit", {
                  category: category.name
                })}
                style={{
                  color: categoryNameColor(category)
                }}
                onClick={() => editCategory(category)}
              >
                <CategoryGlyph category={category} />
                <span className={styles["category-name"]}>{category.name}</span>
                <Pencil className={styles["edit-hint"]} aria-hidden="true" size={16} />
              </button>
            )}
          </Tooltip>
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
            <span className={styles["category-name"]}>
              <span className={ui["skeleton"]}>{name}</span>
            </span>
            <span className={styles["edit-hint-placeholder"]} />
          </div>
        </li>
      ))}
    </ul>
  );
}

type RuleRowProps = {
  rule: Rule;
  position: number;
  count: number;
  toggling: boolean;
  toggleRule: (rule: Rule) => void;
  editRule: (rule: Rule) => void;
};

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
  const t = useTranslations("categorization.rules");
  const reorder = useRuleReorder(rules);

  if (!rules.length) {
    return <Empty title={t("emptyTitle")}>{t("empty")}</Empty>;
  }

  return (
    <>
      {reorder.failure && (
        <div className={styles["order-failure"]}>
          <FormError
            failure={{
              ...reorder.failure,
              message: t("orderFailed", {
                message: reorder.failure.message
              })
            }}
          />
          <button className={ui["text-button"]} type="button" onClick={reorder.dismissFailure}>{t("dismiss")}</button>
        </div>
      )}
      <DndContext
        sensors={reorder.sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        accessibility={{
          announcements: reorder.announcements,
          screenReaderInstructions: reorder.instructions
        }}
        onDragStart={reorder.onDragStart}
        onDragCancel={reorder.onDragCancel}
        onDragEnd={reorder.onDragEnd}
      >
        <SortableContext items={reorder.rules.map(rule => rule.id)} strategy={verticalListSortingStrategy}>
          <ol className={styles["rule-list"]}>
            {reorder.rules.map((rule, index) => (
              <SortableRuleRow
                key={rule.id}
                rule={rule}
                position={index + 1}
                count={reorder.rules.length}
                toggling={togglingRules.includes(rule.id)}
                toggleRule={toggleRule}
                editRule={editRule}
              />
            ))}
          </ol>
        </SortableContext>
        <DragOverlay modifiers={[verticalOnly]}>
          {reorder.dragged && <DraggedRuleRow rule={reorder.dragged} />}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function SortableRuleRow({
  rule,
  position,
  count,
  toggling,
  toggleRule,
  editRule
}: RuleRowProps) {
  const t = useTranslations("categorization.rules");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: rule.id,
    disabled: count < 2
  });

  return (
    <li
      ref={setNodeRef}
      className={clsx(styles["rule-row"], isDragging && styles["drop-position"])}
      style={{
        transform: CSS.Translate.toString(transform),
        transition
      }}
    >
      <button
        ref={setActivatorNodeRef}
        className={styles["handle"]}
        type="button"
        title={t("dragToReorder")}
        disabled={count < 2}
        {...attributes}
        {...listeners}
        aria-label={t("move", {
          rule: rule.name,
          position,
          total: count
        })}
      >
        <GripVertical aria-hidden="true" size={18} />
      </button>
      <RuleRowContent
        rule={rule}
        toggling={toggling}
        toggleRule={toggleRule}
        editRule={editRule}
      />
    </li>
  );
}

/** The dragged rule as it follows the pointer; its place in the list stays empty to show where it will drop. */
/** The type a rule sets, with a transfer's account, for example: Transfer · Savings. Nothing for a rule that leaves the type automatic. */
function RuleTypeLabel({
  rule
}: {
  rule: Rule;
}) {
  const t = useTranslations("categorization.rules");
  const tTypes = useTranslations("transactions.types");
  const type = rule.transaction_type;

  if (!type) {
    return null;
  }

  const label = tTypes(type);
  // A target without a name belongs to a deleted account.
  const accountName = rule.transfer_account_id ? rule.transfer_account_name ?? t("deletedAccount") : null;
  const text = accountName ? t("typeWithAccount", {
    type: label,
    account: accountName
  }) : label;

  return (
    <Tooltip
      text={t("setsType", {
        type: text
      })}
    >
      {trigger => (
        <span {...trigger} className={styles["rule-tag"]}>
          <TransactionTypeIcon type={type} />
          <span>{text}</span>
        </span>
      )}
    </Tooltip>
  );
}

/** The account a rule is limited to, for example: Only Savings. Nothing for a rule that matches every account. */
function RuleAccountLabel({
  rule
}: {
  rule: Rule;
}) {
  const t = useTranslations("categorization.rules");

  if (!rule.account_id) {
    return null;
  }

  // A condition without a name belongs to a deleted account.
  const accountName = rule.account_name ?? t("deletedAccount");

  return (
    <Tooltip
      text={t("onlyAccountHint", {
        account: accountName
      })}
    >
      {trigger => (
        <span {...trigger} className={styles["rule-tag"]}>
          <Landmark size={17} aria-hidden="true" />
          <span>{t("onlyAccount", {
            account: accountName
          })}</span>
        </span>
      )}
    </Tooltip>
  );
}

function DraggedRuleRow({
  rule
}: {
  rule: Rule;
}) {
  const t = useTranslations("categorization.rules");

  return (
    <div className={clsx(styles["rule-row"], styles["dragged"])} aria-hidden="true">
      <span className={styles["handle"]}>
        <GripVertical size={18} />
      </span>
      <span className={styles["rule-name"]}>
        <strong>{rule.name}</strong>
      </span>
      <div className={styles["rule-pattern"]}>
        <span className={styles["rule-label"]}>{rule.mode === "keyword" ? t("modes.keyword") : t("modes.regex")}</span>
        <code>{rule.pattern}</code>
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
        <RuleTypeLabel rule={rule} />
        <RuleAccountLabel rule={rule} />
      </div>
      <span className={clsx(styles["toggle"], rule.enabled && styles["enabled"])}>
        <span />
      </span>
    </div>
  );
}

function RuleRowContent({
  rule,
  toggling,
  toggleRule,
  editRule
}: Pick<RuleRowProps, "rule" | "toggling" | "toggleRule" | "editRule">) {
  const t = useTranslations("categorization.rules");

  return (
    <>
      <Tooltip text={`${rule.name}: ${rule.pattern}`}>
        {trigger => (
          <button
            {...trigger}
            className={styles["rule-name"]}
            type="button"
            aria-label={t("edit", {
              rule: rule.name
            })}
            onClick={() => editRule(rule)}
          >
            <strong>{rule.name}</strong>
            <Pencil className={styles["edit-hint"]} aria-hidden="true" size={16} />
          </button>
        )}
      </Tooltip>
      <div className={styles["rule-pattern"]}>
        <span className={styles["rule-label"]}>{rule.mode === "keyword" ? t("modes.keyword") : t("modes.regex")}</span>
        <Tooltip text={rule.pattern} describes={false} onlyWhenTruncated>
          {trigger => <code {...trigger}>{rule.pattern}</code>}
        </Tooltip>
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
        <RuleTypeLabel rule={rule} />
        <RuleAccountLabel rule={rule} />
      </div>
      <button
        className={clsx(styles["toggle"], rule.enabled && styles["enabled"])}
        type="button"
        role="switch"
        aria-checked={Boolean(rule.enabled)}
        aria-label={t("toggle", {
          rule: rule.name
        })}
        disabled={toggling}
        onClick={() => toggleRule(rule)}
      >
        <span aria-hidden="true" />
      </button>
    </>
  );
}

function RuleRowsSkeleton() {
  return (
    <ol className={styles["rule-list"]}>
      {skeletonNames.slice(0, 4).map(name => (
        <li className={styles["rule-row"]} key={name}>
          <span className={styles["handle"]}>
            <span className={clsx(styles["icon-placeholder"], ui["skeleton"])} />
          </span>
          <span className={styles["rule-name"]}>
            <strong className={ui["skeleton"]}>{name}</strong>
          </span>
          <div className={styles["rule-pattern"]}>
            <span className={clsx(styles["rule-label"], ui["skeleton"])}>Keyword</span>
            <code>
              <span className={ui["skeleton"]}>MARKET</span>
            </code>
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
          </div>
          <div className={styles["toggle"]}>
            <div className={clsx(styles["toggle-placeholder"], ui["skeleton"])} />
          </div>
        </li>
      ))}
    </ol>
  );
}
