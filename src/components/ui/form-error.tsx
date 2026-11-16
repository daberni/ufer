import type { Failure } from "@/client/api";
import { TraceId } from "./trace-id";
import ui from "./primitives.module.css";

type Props = {
  failure: Failure | null;
};

// The alert region stays mounted so a failed submit is announced without moving focus.
export function FormError({ failure }: Props) {
  return (
    <div role="alert">
      {failure && <p className={ui["error-text"]}>{failure.message}</p>}
      {failure && <TraceId id={failure.traceId} />}
    </div>
  );
}
