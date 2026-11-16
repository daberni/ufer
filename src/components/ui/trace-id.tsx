import ui from "./primitives.module.css";

/** The trace ID of a server failure, as copyable secondary text; the visually hidden label names it for assistive technology. */
export function TraceId({
  id
}: {
  id?: string;
}) {
  if (!id) {
    return null;
  }

  return (
    <span className={ui["trace-id"]} title="Trace ID">
      <span className={ui["visually-hidden"]}>Trace ID: </span>
      {id}
    </span>
  );
}
