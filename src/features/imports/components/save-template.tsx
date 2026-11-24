"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId, useState } from "react";
import { Check } from "lucide-react";
import styles from "./save-template.module.css";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { maxTemplateNameLength, templateFromMapping } from "@/features/imports/csv-templates";
import { rememberedChoices } from "@/features/imports/import-plan";
import { useChangeTemplate, useSaveTemplate } from "@/features/imports/template-queries";
import type { ImportDraft } from "./use-import-draft";
import { useTranslations } from "next-intl";

/** After an import, keeps its mapping as a template for later files with the same columns, or updates the saved template it used. */
export function SaveTemplate({
  draft
}: {
  draft: ImportDraft;
}) {
  const t = useTranslations("imports.saveTemplate");
  const nameId = useId();
  const save = useSaveTemplate();
  const change = useChangeTemplate();
  // A saved template for these columns is updated even when it was switched off, since a second one for the same header is rejected.
  const saved = [draft.template, draft.offeredTemplate].find(candidate => candidate && !candidate.builtIn) ?? null;
  const [name, setName] = useState(() => saved?.name ?? defaultName(draft));
  const [remember, setRemember] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const pending = save.isPending || change.isPending;
  const failure = save.error ?? change.error;

  if (!draft.table || !draft.mapping || !draft.settings) {
    return null;
  }

  const choices = remember ? rememberedChoices(draft.targets, draft.categories) : {
    accounts: {},
    categories: {}
  };
  const template = templateFromMapping(name, draft.table.header, draft.mapping, draft.settings, choices.accounts, choices.categories, draft.typeValues);

  if (done) {
    return (
      <p className={styles["saved"]} role="status">
        <Check size={16} aria-hidden="true" />
        {done}
      </p>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    if (saved) {
      change.mutate({
        id: saved.id,
        definition: {
          header: template.header,
          settings: template.settings,
          columns: template.columns,
          accounts: template.accounts,
          categories: template.categories,
          types: template.types
        }
      }, {
        onSuccess: () => setDone(t("updated", {
          name: saved.name
        }))
      });
    } else {
      save.mutate(template, {
        onSuccess: () => setDone(t("saved", {
          name: template.name
        }))
      });
    }
  }

  return (
    <form className={styles["form"]} onSubmit={submit} aria-labelledby={`${nameId}-heading`}>
      <h3 id={`${nameId}-heading`}>{saved ? t("updateHeading", {
        name: saved.name
      }) : t("saveHeading")}</h3>
      <p className={ui["form-hint"]}>{saved ? t("updateHint") : t("saveHint")}</p>
      {!saved && (
        <label htmlFor={nameId} className={styles["name"]}>
          <span>{t("name")}</span>
          <input
            id={nameId}
            value={name}
            maxLength={maxTemplateNameLength}
            required
            onChange={event => setName(event.target.value)}
          />
        </label>
      )}
      <label className={styles["remember"]}>
        <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
        {t("remember")}
      </label>
      <FormError failure={failure ? toFailure(failure) : null} />
      <div className={clsx(ui["button-group"], styles["actions"])}>
        <button type="submit" className={ui["button"]} disabled={pending || !name.trim()}>{saved ? t("update") : t("save")}</button>
      </div>
    </form>
  );
}

function defaultName(draft: ImportDraft) {
  if (draft.template) {
    return draft.template.name;
  }

  return (draft.file?.name ?? "").replace(/\.[^.]+$/, "").slice(0, maxTemplateNameLength);
}
