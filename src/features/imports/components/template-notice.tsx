"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { LayoutTemplate } from "lucide-react";
import styles from "./template-notice.module.css";
import type { ImportDraft } from "./use-import-draft";
import { useTranslations } from "next-intl";

/** Says which template shaped the mapping and switches between it and a manual mapping. */
export function TemplateNotice({
  draft
}: {
  draft: ImportDraft;
}) {
  const t = useTranslations("imports.templateNotice");
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
          <strong>{t(template.builtIn ? "detected" : "using", {
            name: template.name
          })}</strong>
          <span>{remembered ? t("appliedWithChoices") : t("applied")}</span>
        </p>
        <button
          type="button"
          className={clsx(ui["text-button"], styles["action"])}
          disabled={inputsLocked}
          onClick={draft.mapManually}
        >{t("mapManually")}</button>
      </div>
    );
  }

  if (offeredTemplate) {
    return (
      <div className={clsx(ui["notice"], styles["notice"])}>
        <LayoutTemplate size={18} aria-hidden="true" />
        <p>
          <strong>{t(offeredTemplate.builtIn ? "looksLike" : "matches", {
            name: offeredTemplate.name
          })}</strong>
          <span>{t("replaces")}</span>
        </p>
        <button
          type="button"
          className={clsx(ui["text-button"], styles["action"])}
          disabled={inputsLocked}
          onClick={() => draft.applyTemplate(offeredTemplate)}
        >{t("apply")}</button>
      </div>
    );
  }

  return null;
}
