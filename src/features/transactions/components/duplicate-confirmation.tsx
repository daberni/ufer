"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useState } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { CopyCheck } from "lucide-react";
import styles from "./transaction-type.module.css";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { FormError } from "@/components/ui/form-error";
import { describeDate } from "@/lib/date-format";
import { formatCount } from "@/lib/locale";
import { duplicateSearchDays } from "@/features/transactions/duplicate-resolution";
import { useMarkDuplicate } from "@/features/transactions/mutations";
import { useDuplicateCandidates } from "@/features/transactions/queries";
import type { DuplicateCandidate, Transaction } from "@/features/transactions/types";

/** What resolving the duplicate with `candidate` keeps and hides. */
function resolutionEffect(transaction: Transaction, candidate: DuplicateCandidate) {
  const linked = candidate.keeps_candidate ? transaction.counterpart?.account_name : candidate.linked_account;
  const link = linked ? ` Ends its link with ${linked}.` : "";

  if (candidate.keeps_candidate) {
    return `Keeps the chosen booking and hides this one.${link}`;
  }

  return `Keeps this booking and hides the chosen one.${link}`;
}

/**
 * Names this imported booking a duplicate of another booking on its account. Every candidate is offered and none is preselected, so several equal candidates are never merged without the person's choice.
 * Beside a bank copy a CSV-imported copy is hidden; otherwise the better-described copy stays. The other copy is hidden and can be shown again.
 */
export function DuplicateConfirmation({
  transaction,
  close,
  cancel
}: {
  transaction: Transaction;
  close: () => void;
  cancel: () => void;
}) {
  const locale = useLocale();
  const candidates = useDuplicateCandidates(transaction.id);
  const mark = useMarkDuplicate(transaction.id);
  const [chosenId, setChosenId] = useState<string>();
  const options = candidates.data?.candidates ?? [];
  const chosen = options.find(candidate => candidate.id === chosenId);
  const error = mark.error ?? candidates.error;
  const failure = error ? toFailure(error) : null;

  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();

        if (!chosen) {
          return;
        }

        mark.mutate(chosen.id, {
          onSuccess: close
        });
      }}
    >
      {candidates.isPending && <p className={ui["form-hint"]}>Looking for bookings with the same amount…</p>}
      {candidates.isSuccess && options.length === 0 && <p className={ui["form-hint"]}>{`No other booking on this account has the same amount within ${formatCount(duplicateSearchDays, locale)} days.`}</p>}
      {options.length > 0 && (
        <fieldset className={styles["choices"]}>
          <legend>This is a duplicate of</legend>
          {options.map(candidate => (
            <label key={candidate.id} className={styles["choice"]}>
              <input
                type="radio"
                name="duplicate-of"
                value={candidate.id}
                checked={chosenId === candidate.id}
                onChange={() => setChosenId(candidate.id)}
              />
              <span className={styles["choice-body"]}>
                <span className={styles["choice-title"]}>{candidate.counterparty || candidate.description || "No payee"}</span>
                <span className={styles["choice-text"]}>{[describeDate(Temporal.PlainDate.from(candidate.date), locale).label, candidate.description].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {chosen && <p className={ui["form-hint"]}>{resolutionEffect(transaction, chosen)}</p>}
      <FormError failure={failure} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={mark.isPending}
          onClick={cancel}
        >
          Cancel
        </button>
        <button className={clsx(ui["button"], ui["primary"])} disabled={mark.isPending || !chosen}>
          <CopyCheck size={15} />
          Resolve duplicate
        </button>
      </div>
    </form>
  );
}
