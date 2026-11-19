"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import styles from "./template-list.module.css";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { maxTemplateNameLength, type CsvTemplate } from "@/features/imports/csv-mapping";
import { useChangeTemplate, useDeleteTemplate } from "@/features/imports/template-queries";

/** The saved templates with their recognized columns; each can be renamed or deleted. */
export function TemplateList({
  templates,
  disabled
}: {
  templates: CsvTemplate[];
  disabled: boolean;
}) {
  if (templates.length === 0) {
    return null;
  }

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-templates">
      <h2 id="import-templates">Saved templates</h2>
      <p className={ui["form-hint"]}>A file whose header row matches a template is mapped with it automatically.</p>
      <ul className={styles["list"]}>
        {templates.map(template => <TemplateItem key={template.id} template={template} disabled={disabled} />)}
      </ul>
    </section>
  );
}

function TemplateItem({
  template,
  disabled
}: {
  template: CsvTemplate;
  disabled: boolean;
}) {
  const inputId = useId();
  const change = useChangeTemplate();
  const remove = useDeleteTemplate();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(template.name);
  const failure = change.error ?? remove.error;
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
          <label htmlFor={inputId} className={ui["visually-hidden"]}>Template name</label>
          <input
            id={inputId}
            value={name}
            maxLength={maxTemplateNameLength}
            required
            autoFocus
            onChange={event => setName(event.target.value)}
          />
          <div className={ui["button-group"]}>
            <button type="submit" className={clsx(ui["button"], ui["small"], ui["primary"])} disabled={change.isPending || !name.trim()}>Save</button>
            <button
              type="button"
              className={clsx(ui["button"], ui["small"])}
              onClick={() => {
                setEditing(false);
                setName(template.name);
                change.reset();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className={styles["details"]}>
          <strong>{template.name}</strong>
          <span className={styles["columns"]} title={template.header.join(", ")}>{template.header.join(", ")}</span>
          {remembered > 0 && <span>{remembered === 1 ? "1 remembered choice" : `${remembered} remembered choices`}</span>}
        </div>
      )}
      {!editing && (
        <div className={clsx(ui["button-group"], styles["actions"])}>
          {confirming ? (
            <>
              <button
                type="button"
                className={clsx(ui["button"], ui["small"], styles["danger"])}
                disabled={remove.isPending}
                onClick={() => remove.mutate(template.id)}
              >Delete “{template.name}”</button>
              <button type="button" className={clsx(ui["button"], ui["small"])} onClick={() => setConfirming(false)}>Keep</button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={clsx(ui["button"], ui["small"])}
                disabled={disabled}
                onClick={() => setEditing(true)}
              >
                <Pencil size={14} aria-hidden="true" />
                Rename
              </button>
              <button
                type="button"
                className={clsx(ui["button"], ui["small"])}
                disabled={disabled}
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete
              </button>
            </>
          )}
        </div>
      )}
      <FormError failure={failure ? toFailure(failure) : null} />
    </li>
  );
}
