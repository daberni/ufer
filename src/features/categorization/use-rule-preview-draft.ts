"use client";

import { useEffect, useMemo, useState } from "react";
import { useRulePreview } from "@/features/categorization/queries";
import type { RulePreviewDraft } from "@/features/categorization/types";

// Counting waits for typing to pause.
const previewDelay = 300;

function sameDraft(first: RulePreviewDraft | null, second: RulePreviewDraft | null) {
  return first !== null && second !== null && first.pattern === second.pattern && first.mode === second.mode && first.ruleId === second.ruleId && first.categoryId === second.categoryId && first.sourceTransactionId === second.sourceTransactionId;
}

/**
 * The preview of a drafted rule, counted once typing pauses. The draft is null while the pattern is blank; current says whether the preview belongs to the draft as it is
 * now rather than to an earlier one.
 */
export function useRulePreviewDraft({
  pattern,
  mode,
  ruleId,
  categoryId,
  sourceTransactionId
}: RulePreviewDraft) {
  const draft = useMemo<RulePreviewDraft | null>(() => {
    if (!pattern.trim()) {
      return null;
    }

    return {
      pattern,
      mode,
      ruleId,
      categoryId,
      ...(sourceTransactionId === undefined ? {} : {
        sourceTransactionId
      })
    };
  }, [pattern, mode, ruleId, categoryId, sourceTransactionId]);
  const [previewed, setPreviewed] = useState(draft);

  useEffect(() => {
    const timer = setTimeout(() => setPreviewed(draft), previewDelay);

    return () => clearTimeout(timer);
  }, [draft]);

  const preview = useRulePreview(previewed);

  return {
    draft,
    preview,
    current: sameDraft(draft, previewed)
  };
}
