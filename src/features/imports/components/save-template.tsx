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

/** After an import, keeps its mapping as a template for later files with the same columns, or updates the saved template it used. */
export function SaveTemplate({
  draft
}: {
  draft: ImportDraft;
}) {
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
  const template = templateFromMapping(name, draft.table.header, draft.mapping, draft.settings, choices.accounts, choices.categories);

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
          categories: template.categories
        }
      }, {
        onSuccess: () => setDone(`Template “${saved.name}” updated.`)
      });
    } else {
      save.mutate(template, {
        onSuccess: () => setDone(`Saved as template “${template.name}”. Files with the same columns use it automatically.`)
      });
    }
  }

  return (
    <form className={styles["form"]} onSubmit={submit} aria-labelledby={`${nameId}-heading`}>
      <h3 id={`${nameId}-heading`}>{saved ? `Update “${saved.name}”?` : "Save this mapping as a template?"}</h3>
      <p className={ui["form-hint"]}>{saved ? "Later files with these columns use the format, column roles and choices of this import." : "Later files with the same columns are recognized and mapped the same way."}</p>
      {!saved && (
        <label htmlFor={nameId} className={styles["name"]}>
          <span>Template name</span>
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
        Remember the chosen existing accounts and categories
      </label>
      <FormError failure={failure ? toFailure(failure) : null} />
      <div className={clsx(ui["button-group"], styles["actions"])}>
        <button type="submit" className={ui["button"]} disabled={pending || !name.trim()}>{saved ? "Update template" : "Save template"}</button>
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
