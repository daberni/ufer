"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId, useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import styles from "./template-list.module.css";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { maxTemplateNameLength, type CsvTemplate } from "@/features/imports/csv-templates";
import { useChangeTemplate, useDeleteTemplate, useDuplicateTemplate } from "@/features/imports/template-queries";
import { useTranslations } from "next-intl";

/** Built-in and saved templates with their recognized columns. Saved ones can be renamed or deleted; built-in ones can be duplicated into an editable saved copy. */
export function TemplateList({
  templates,
  disabled,
  onDeleted
}: {
  templates: CsvTemplate[];
  disabled: boolean;
  /** Called after a template was deleted, so a draft using it can let it go. */
  onDeleted?: (id: string) => void;
}) {
  const t = useTranslations("imports.templates");

  if (templates.length === 0) {
    return null;
  }

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-templates">
      <h2 id="import-templates">{t("heading")}</h2>
      <p className={ui["form-hint"]}>{t("hint")}</p>
      <ul className={styles["list"]}>
        {templates.map(template => (
          <TemplateItem
            key={template.id}
            template={template}
            disabled={disabled}
            onDeleted={onDeleted}
          />
        ))}
      </ul>
    </section>
  );
}

function TemplateItem({
  template,
  disabled,
  onDeleted
}: {
  template: CsvTemplate;
  disabled: boolean;
  onDeleted?: (id: string) => void;
}) {
  const inputId = useId();
  const change = useChangeTemplate();
  const remove = useDeleteTemplate();
  const duplicate = useDuplicateTemplate();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(template.name);
  const failure = change.error ?? remove.error ?? duplicate.error;
  const t = useTranslations("imports.templates");
  const remembered = Object.keys(template.accounts).length + Object.keys(template.categories).length;

  function rename(event: React.FormEvent) {
    event.preventDefault();
    change.mutate({
      id: template.id,
      name: name.trim()
    }, {
      onSuccess: () => setEditing(false)
    });
  }

  return (
    <li className={styles["item"]}>
      {editing ? (
        <form className={styles["rename"]} onSubmit={rename}>
          <label htmlFor={inputId} className={ui["visually-hidden"]}>{t("name")}</label>
          <input
            id={inputId}
            value={name}
            maxLength={maxTemplateNameLength}
            required
            autoFocus
            onChange={event => setName(event.target.value)}
          />
          <div className={ui["button-group"]}>
            <button type="submit" className={clsx(ui["button"], ui["small"], ui["primary"])} disabled={change.isPending || !name.trim()}>{t("save")}</button>
            <button
              type="button"
              className={clsx(ui["button"], ui["small"])}
              onClick={() => {
                setEditing(false);
                setName(template.name);
                change.reset();
              }}
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles["details"]}>
          <strong>{template.builtIn ? t("builtIn", {
            name: template.name
          }) : template.name}</strong>
          <span className={ui["truncate"]} title={template.header.join(", ")}>{template.header.join(", ")}</span>
          {remembered > 0 && (
            <span>{t("remembered", {
              count: remembered
            })}</span>
          )}
        </div>
      )}
      {template.builtIn && (
        <div className={clsx(ui["button-group"], styles["actions"])}>
          <button
            type="button"
            className={clsx(ui["button"], ui["small"])}
            disabled={disabled || duplicate.isPending}
            onClick={() => duplicate.mutate({
              id: template.id,
              name: t("copyName", {
                name: template.name
              })
            })}
          >
            <Copy size={14} aria-hidden="true" />
            {t("duplicate")}
          </button>
        </div>
      )}
      {!editing && !template.builtIn && (
        <div className={clsx(ui["button-group"], styles["actions"])}>
          {confirming ? (
            <>
              <button
                type="button"
                className={clsx(ui["button"], ui["small"], styles["danger"])}
                disabled={remove.isPending}
                onClick={() => remove.mutate(template.id, {
                  onSuccess: () => onDeleted?.(template.id)
                })}
              >
                {t("confirmDelete", {
                  name: template.name
                })}
              </button>
              <button type="button" className={clsx(ui["button"], ui["small"])} onClick={() => setConfirming(false)}>{t("keep")}</button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={clsx(ui["button"], ui["small"])}
                disabled={disabled}
                onClick={() => {
                  // The stored name may have changed since the last edit, for example after a rename.
                  setName(template.name);
                  setEditing(true);
                }}
              >
                <Pencil size={14} aria-hidden="true" />
                {t("rename")}
              </button>
              <button
                type="button"
                className={clsx(ui["button"], ui["small"])}
                disabled={disabled}
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t("delete")}
              </button>
            </>
          )}
        </div>
      )}
      <FormError failure={failure ? toFailure(failure) : null} />
    </li>
  );
}
