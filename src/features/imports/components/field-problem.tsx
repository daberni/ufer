import styles from "./field-problem.module.css";

/** Marks an input as incomplete for assistive technology and points it at its inline message. */
export function problemProps(problem: {
  message: string;
} | null | undefined, id: string) {
  if (!problem) {
    return {};
  }

  return {
    "aria-invalid": true,
    "aria-describedby": id
  };
}

/** The short message next to an incomplete input; the import scrolls to the first one when it is started. */
export function FieldProblem({
  problem,
  id
}: {
  problem: {
    message: string;
  } | null | undefined;
  id: string;
}) {
  if (!problem) {
    return null;
  }

  return <span id={id} className={styles["problem"]}>{problem.message}</span>;
}
