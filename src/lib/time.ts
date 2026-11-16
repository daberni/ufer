import { Temporal } from "temporal-polyfill";

/** Calendar dates such as "today", reporting months and the sync window follow this zone, independent of the server or browser zone. */
export const productTimeZone = "Europe/Vienna";

/** Today's calendar date in the product zone; pass an instant to evaluate a fixed point in time. */
export function today(now = Temporal.Now.instant()) {
  return now.toZonedDateTimeISO(productTimeZone).toPlainDate();
}

/** Persisted timestamp format: UTC with exactly three fractional digits like the database defaults and existing rows, because SQL compares stored timestamps as text. */
export function timestamp(instant = Temporal.Now.instant()) {
  return instant.toString({
    fractionalSecondDigits: 3
  });
}

/** A calendar date in exactly `YYYY-MM-DD` form that exists in the ISO calendar. */
export function validDate(value: string) {
  try {
    // PlainDate.from also accepts compact, time-qualified and annotated forms; the round trip limits it to the stored form.
    return Temporal.PlainDate.from(value).toString() === value;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }

    throw error;
  }
}
