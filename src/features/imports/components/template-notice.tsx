"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { LayoutTemplate } from "lucide-react";
import styles from "./template-notice.module.css";
import type { ImportDraft } from "./use-import-draft";

/** Says which template shaped the mapping and switches between it and a manual mapping. */
export function TemplateNotice({
  draft
}: {
  draft: ImportDraft;
}) {
  const {
    template,
    offeredTemplate,
    inputsLocked
  } = draft;

  // A saved template that matches takes precedence over an applied built-in, which can apply first while saved templates still load.
  const savedOverridesBuiltIn = Boolean(template?.builtIn && offeredTemplate && !offeredTemplate.builtIn);

  if (template && !savedOverridesBuiltIn) {
    const remembered = Object.keys(template.accounts).length + Object.keys(template.categories).length > 0;

    return (
      <div className={clsx(ui["notice"], styles["notice"])} role="status">
        <LayoutTemplate size={18} aria-hidden="true" />
        <p>
          <strong>{template.builtIn ? `Detected as ${template.name}` : `Using your template “${template.name}”`}</strong>
          <span>{remembered ? "Format, column roles and remembered account and category choices are applied." : "Format and column roles are applied."}</span>
        </p>
        <button
          type="button"
          className={clsx(ui["text-button"], styles["action"])}
          disabled={inputsLocked}
          onClick={draft.mapManually}
        >Map manually</button>
      </div>
    );
  }

  if (offeredTemplate) {
    return (
      <div className={clsx(ui["notice"], styles["notice"])}>
        <LayoutTemplate size={18} aria-hidden="true" />
        <p>
          <strong>{offeredTemplate.builtIn ? `Looks like a ${offeredTemplate.name}` : `Matches your template “${offeredTemplate.name}”`}</strong>
          <span>Applying it replaces the current format and column roles.</span>
        </p>
        <button
          type="button"
          className={clsx(ui["text-button"], styles["action"])}
          disabled={inputsLocked}
          onClick={() => draft.applyTemplate(offeredTemplate)}
        >Apply template</button>
      </div>
    );
  }

  return null;
}
