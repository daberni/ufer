import { useTranslations } from "next-intl";
import ui from "./primitives.module.css";

/** The trace ID of a server failure, as copyable secondary text; the visually hidden label names it for assistive technology. */
export function TraceId({
  id
}: {
  id?: string;
}) {
  const t = useTranslations("common");

  if (!id) {
    return null;
  }

  return (
    <span className={ui["trace-id"]} title={t("traceId")}>
      <span className={ui["visually-hidden"]}>{`${t("traceId")}: `}</span>
      {id}
    </span>
  );
}
