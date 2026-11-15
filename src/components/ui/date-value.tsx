import { describeDate } from "@/lib/date-format";

export function DateValue({
  value,
  fallback = "—"
}: {
  value: string | null;
  fallback?: string
}) {
  if (!value) {
    return <>{fallback}</>;
  }

  const display = describeDate(value);

  return <time dateTime={display.dateTime} title={display.title}>{display.label}</time>;
}
