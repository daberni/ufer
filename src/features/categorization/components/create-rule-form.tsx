"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./rule-form.module.css";
import { useTranslations } from "next-intl";

import { clsx } from "clsx";
import { useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useSaveRule } from "@/features/categorization/mutations";
import { useCategories } from "@/features/categorization/queries";
import { useRulePreviewDraft } from "@/features/categorization/use-rule-preview-draft";
import { activeAccounts, useAccounts } from "@/features/accounts/queries";
import { ruleTransactionTypes, type RuleTransactionType } from "@/lib/transaction-types";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { CategoryPicker } from "./category-picker";
import { CategoryDialog } from "./category-form";
import { Dialog } from "@/components/ui/dialog";
import type { Rule, RulePreviewDraft } from "@/features/categorization/types";
import { DeleteButton, RuleDeleteConfirmation } from "./deletion-forms";
import { ManualAdoptionOption, useManualAdoption, type ManualMatches } from "./manual-adoption-option";
import { RuleMatches, type RuleMatchList } from "./rule-matches";

type RuleFormProps = DialogFormProps & {
  rule?: Rule | null;
};

export function RuleDialog({
  close,
  rule
}: RuleFormProps) {
  const t = useTranslations("categorization.ruleForm");
  const [deleting, setDeleting] = useState(false);
  let title = rule ? t("editTitle") : t("createTitle");

  if (rule && deleting) {
    title = t("deleteTitle");
  }

  return (
    <Dialog eyebrow={t("eyebrow")} title={title} onClose={close}>
      {rule && deleting ? <RuleDeleteConfirmation rule={rule} close={close} cancel={() => setDeleting(false)} /> : <RuleForm close={close} rule={rule} onDelete={() => setDeleting(true)} />}
    </Dialog>
  );
}

type Mode = RulePreviewDraft["mode"];

/** What the drafted rule would decide when rules are applied; nothing changes before that. */
function useRuleImpact(fields: RulePreviewDraft) {
  const t = useTranslations("categorization.ruleForm.impact");
  const {
    draft,
    preview,
    current
  } = useRulePreviewDraft(fields);
  const pending = draft !== null && (!current || preview.isFetching);
  const empty = {
    pending: false,
    previewId: null,
    manual: null,
    matches: null
  };

  if (draft === null) {
    return {
      ...empty,
      text: t("enterPattern")
    };
  }

  if (current && preview.isError) {
    return {
      ...empty,
      text: t("unavailable", {
        message: toFailure(preview.error).message
      })
    };
  }

  if (pending || !preview.data || preview.isPlaceholderData) {
    return {
      ...empty,
      pending: true,
      text: t("finding")
    };
  }

  // The counted ID breaks equal-priority ties, so a new rule is stored with exactly this ID.
  const previewId = preview.data.id;
  const manual: ManualMatches = {
    count: preview.data.manual,
    sameCategory: preview.data.manual_same_category
  };

  if (!preview.data.enabled) {
    return {
      ...empty,
      previewId,
      manual,
      text: t("disabled")
    };
  }

  const total = preview.data.matched + preview.data.manual;

  if (total === 0) {
    return {
      ...empty,
      previewId,
      manual,
      text: t("none")
    };
  }

  const matches: RuleMatchList = {
    total,
    changing: preview.data.matched - preview.data.matched_same_category,
    manualDiffering: preview.data.manual - preview.data.manual_same_category,
    transactions: preview.data.transactions
  };

  return {
    pending: false,
    previewId,
    manual,
    matches,
    text: t("matches", {
      count: total
    })
  };
}

function RuleForm({
  close,
  rule,
  onDelete
}: RuleFormProps & {
  onDelete: () => void;
}) {
  const t = useTranslations("categorization.ruleForm");
  const categories = useCategories();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveRule(rule), close);
  const categoryFieldId = useId();
  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(rule?.category_id ?? null);
  const categoryId = chosenCategoryId ?? categories.data?.[0]?.id ?? null;
  const categorySelected = categoryId !== null && Boolean(categories.data?.some(category => category.id === categoryId));
  const noCategories = categories.data?.length === 0;
  const [addingCategory, setAddingCategory] = useState(false);
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [mode, setMode] = useState<Mode>(rule?.mode === "regex" ? "regex" : "keyword");
  const [type, setType] = useState<RuleTransactionType | "">(rule?.transaction_type ?? "");
  const [accountId, setAccountId] = useState(rule?.account_id ?? "");
  const ruleId = rule?.id ?? null;
  const impact = useRuleImpact({
    pattern,
    mode,
    accountId: accountId || null,
    ruleId,
    categoryId
  });
  const adoption = useManualAdoption(impact.manual);

  return (
    <form
      onSubmit={event => {
        const previewId = impact.previewId;

        if ((!rule && !previewId) || !categorySelected) {
          event.preventDefault();

          return;
        }

        submit(event, data => ({
          ...Object.fromEntries(data),
          adopt_manual: adoption.checked,
          ...(rule ? {} : {
            id: previewId
          })
        }));
      }}
      className={clsx(ui["form"], styles["form"])}
    >
      <label>
        {t("name")}
        <input
          name="name"
          defaultValue={rule?.name}
          required
          placeholder={t("namePlaceholder")}
          maxLength={100}
        />
      </label>
      <fieldset className={styles["section"]}>
        <legend className={styles["section-title"]}>{t("when")}</legend>
        <label>
          {t("matchType")}
          <Select name="mode" value={mode} onChange={event => setMode(event.target.value === "regex" ? "regex" : "keyword")}>
            <option value="keyword">{t("keyword")}</option>
            <option value="regex">{t("regex")}</option>
          </Select>
        </label>
        <PatternField pattern={pattern} mode={mode} onChange={setPattern} />
        <AccountConditionField
          value={accountId}
          onChange={setAccountId}
          storedId={rule?.account_id ?? ""}
          storedName={rule?.account_name ?? null}
        />
      </fieldset>
      <fieldset className={styles["section"]}>
        <legend className={styles["section-title"]}>{t("then")}</legend>
        <div className={styles["field"]}>
          <label htmlFor={categoryFieldId}>{t("category")}</label>
          <CategoryPicker
            id={categoryFieldId}
            name="category_id"
            categories={categories.data ?? []}
            value={categoryId}
            onChange={setChosenCategoryId}
          />
          {noCategories && (
            <p className={ui["form-hint"]}>
              {t("noCategories")}{" "}
              <button className={ui["text-button"]} type="button" onClick={() => setAddingCategory(true)}>{t("addCategory")}</button>
            </p>
          )}
        </div>
        <RuleTypeFields
          type={type}
          onTypeChange={setType}
          accountId={rule?.transfer_account_id ?? ""}
          accountName={rule?.transfer_account_name ?? null}
        />
      </fieldset>
      {addingCategory && <CategoryDialog close={() => setAddingCategory(false)} onSaved={setChosenCategoryId} />}
      <p className={ui["visually-hidden"]} role="status" aria-busy={impact.pending}>{impact.text}</p>
      <div className={styles["impact"]}>
        {impact.matches ? (
          <RuleMatches
            matches={impact.matches}
            categories={categories.data ?? []}
            categoryId={categoryId}
            adoptManual={adoption.checked}
          />
        ) : <p className={styles["impact-text"]}>{impact.text}</p>}
      </div>
      <ManualAdoptionOption adoption={adoption} />
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !categorySelected || (!rule && !impact.previewId)}>
        {rule ? t("save") : t("createTitle")} <Sparkles size={16} />
      </button>
      {rule && <DeleteButton label={t("deleteTitle")} disabled={pending} onClick={onDelete} />}
    </form>
  );
}

/** The full-width pattern, which wraps instead of scrolling so a long regular expression stays readable; patterns are a single line, so Enter submits. */
function PatternField({
  pattern,
  mode,
  onChange
}: {
  pattern: string;
  mode: Mode;
  onChange: (pattern: string) => void;
}) {
  const t = useTranslations("categorization.ruleForm");
  const fieldId = useId();
  const hintId = useId();

  return (
    <div className={styles["field"]}>
      <label htmlFor={fieldId}>{t("pattern")}</label>
      <textarea
        id={fieldId}
        name="pattern"
        className={clsx(styles["pattern"], mode === "regex" && styles["regex"])}
        value={pattern}
        onChange={event => onChange(event.target.value.replace(/[\r\n]+/g, ""))}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        required
        rows={1}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-describedby={hintId}
        placeholder={mode === "regex" ? t("regexPlaceholder") : t("keywordPlaceholder")}
        maxLength={500}
      />
      <span id={hintId} className={styles["hint"]}>{t("patternHint")}</span>
    </div>
  );
}

/** The optional account whose bookings alone the rule matches. A stored account that was archived or deleted stays selectable until it is changed. */
function AccountConditionField({
  value,
  onChange,
  storedId,
  storedName
}: {
  value: string;
  onChange: (accountId: string) => void;
  storedId: string;
  storedName: string | null;
}) {
  const t = useTranslations("categorization.ruleForm");
  const accounts = useAccounts();
  const options = activeAccounts(accounts.data ?? []);
  const storedMissing = storedId !== "" && !options.some(account => account.id === storedId);

  return (
    <label>
      {t("onlyAccount")}
      <Select name="account_id" value={value} onChange={event => onChange(event.target.value)}>
        <option value="">{t("anyAccount")}</option>
        {storedMissing && <option value={storedId}>{storedName ?? t("deletedAccount")}</option>}
        {options.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </Select>
    </label>
  );
}

function isRuleType(value: string): value is RuleTransactionType {
  return (ruleTransactionTypes as readonly string[]).includes(value);
}

/** The optional type a rule sets and, for a transfer, the own account on the other side. */
function RuleTypeFields({
  type,
  onTypeChange,
  accountId,
  accountName
}: {
  type: RuleTransactionType | "";
  onTypeChange: (type: RuleTransactionType | "") => void;
  accountId: string;
  /** The stored account's name from the rule, shown until the account list includes it, so loading never drops the stored choice. */
  accountName: string | null;
}) {
  const t = useTranslations("categorization.ruleForm");
  const tTypes = useTranslations("transactions.types");
  const accounts = useAccounts();
  const [chosenAccountId, setChosenAccountId] = useState(accountId);
  const options = activeAccounts(accounts.data ?? []);
  const storedMissing = accountId !== "" && !options.some(account => account.id === accountId);

  return (
    <>
      <div className={ui["form-grid"]}>
        <label>
          {t("type")}
          <Select name="transaction_type" value={type} onChange={event => onTypeChange(isRuleType(event.target.value) ? event.target.value : "")}>
            <option value="">{t("automatic")}</option>
            {ruleTransactionTypes.map(option => <option key={option} value={option}>{tTypes(option)}</option>)}
          </Select>
        </label>
        {type === "transfer" && (
          <label>
            {t("transferAccount")}
            <Select name="transfer_account_id" value={chosenAccountId} onChange={event => setChosenAccountId(event.target.value)}>
              <option value="">{t("anyOrUntracked")}</option>
              {storedMissing && <option value={accountId}>{accountName ?? t("deletedAccount")}</option>}
              {options.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
            </Select>
          </label>
        )}
      </div>
      {type === "transfer" && <p className={ui["form-hint"]}>{t("transferHint")}</p>}
    </>
  );
}
