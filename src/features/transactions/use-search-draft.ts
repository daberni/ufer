"use client";

import { useEffect, useState } from "react";

/** How long typing must pause before the draft is committed. */
export const commitDelay = 250;

/**
 * Keeps the search field responsive while the URL holds the committed search. URL updates arrive asynchronously, so the field edits a local draft and commits it after typing pauses.
 */
export function useSearchDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState({
    text: value,
    // The URL value the draft last saw and the value it last committed.
    seen: value,
    sent: value
  });

  // A URL value other than the field's own commit comes from Back/Forward or a link and replaces an unsent draft.
  if (value !== draft.seen) {
    const ownCommit = value === draft.sent;

    setDraft({
      text: ownCommit ? draft.text : value,
      seen: value,
      sent: ownCommit ? draft.sent : value
    });
  }

  useEffect(() => {
    if (draft.text === draft.sent) {
      return;
    }

    const text = draft.text;
    const timer = setTimeout(() => {
      setDraft(current => ({
        ...current,
        sent: text
      }));
      commit(text);
    }, commitDelay);

    return () => clearTimeout(timer);
  }, [draft.text, draft.sent, commit]);

  function edit(next: string) {
    setDraft(current => ({
      ...current,
      text: next
    }));
  }

  return [draft.text, edit] as const;
}
