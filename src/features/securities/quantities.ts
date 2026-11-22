import { ValidationError } from "@/lib/errors";

const decimal = /^\d{1,9}(\.\d{1,6})?$/;

/** Parses a positive decimal quantity or price with at most six decimals into integer micro-units. */
export function parseMicros(value: string, label: string) {
  const text = value.trim();

  if (!decimal.test(text)) {
    throw new ValidationError(`Enter the ${label} as a positive number with at most six decimals.`);
  }

  const [whole, fraction = ""] = text.split(".");
  const micros = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));

  if (micros <= 0) {
    throw new ValidationError(`The ${label} must be greater than zero.`);
  }

  return micros;
}
