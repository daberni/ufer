"use client";

import ui from "./primitives.module.css";

import { clsx } from "clsx";
import { CircleAlert } from "lucide-react";
import { TraceId } from "@/components/ui/trace-id";
import styles from "./area-placeholder.module.css";
import type { LoadFailure, PendingArea } from "@/components/ui/use-area-result";

type Props = {
  area: PendingArea;
  /** What the area shows, as the subject of the failure message, such as "Your accounts". */
  subject: string;
  /** A skeleton in the shape of the area's final content. */
  children: React.ReactNode;
  className?: string;
};

/**
 * Holds an area's place until its first results arrive. The skeleton keeps the final layout and is hidden from assistive technology, which hears the view's single loading announcement instead; a failed load replaces it with a compact reason and a retry.
 */
export function AreaPlaceholder({
  area,
  subject,
  children,
  className
}: Props) {
  const { failure } = area;

  return (
    <div className={clsx(styles["placeholder"], failure && styles["failed"], className)}>
      {failure ? (
        <FailureCover failure={failure} subject={subject} />
      ) : (
        <div aria-hidden="true" inert>
          {children}
        </div>
      )}
    </div>
  );
}

/** Covers an area whose first load failed with the reason and a retry; it takes the background of the positioned area it covers. */
export function FailureCover({
  failure,
  subject
}: {
  failure: LoadFailure;
  subject: string;
}) {
  return (
    <div className={styles["failure"]} role="alert">
      <p>
        <CircleAlert size={16} aria-hidden="true" />
        {`${subject} could not be loaded: ${failure.message}`}
      </p>
      <TraceId id={failure.traceId} />
      <button className={ui["text-button"]} type="button" onClick={failure.retry}>
        Retry
      </button>
    </div>
  );
}

/** A failed first load of a single value, such as a label, reported in its place with a retry. */
export function InlineFailure({
  failure,
  subject,
  className
}: {
  failure: LoadFailure;
  subject: string;
  className?: string;
}) {
  return (
    <span className={clsx(styles["inline-failure"], className)}>
      {`${subject} could not be loaded.`}
      <TraceId id={failure.traceId} />
      <button
        className={ui["text-button"]}
        type="button"
        title={failure.message}
        onClick={failure.retry}
      >
        Retry
      </button>
    </span>
  );
}
