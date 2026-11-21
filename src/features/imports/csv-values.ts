import { Temporal } from "temporal-polyfill";

// Parses dates, amounts and currencies from CSV cells and does exact decimal arithmetic on parsed amounts.

export type DecimalSeparator = "." | ",";

export const dateFormats = ["YYYY-MM-DD", "DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "YYYY/MM/DD", "DD.MM.YY"] as const;

export type DateFormat = (typeof dateFormats)[number];

/** Longest amount text and digit counts accepted; anything longer is a row error rather than a rejected request. */
const maxAmountLength = 40;
const maxIntegerDigits = 15;
const maxFractionDigits = 6;

// Two-digit years belong to the most recent century that does not put them in the future.
function twoDigitYear(value: number) {
  const currentYear = new Date().getUTCFullYear();

  return 2000 + value > currentYear ? 1900 + value : 2000 + value;
}

/** Reads a date in the given format; null when it is not a real calendar date. */
export function parseDate(value: string, format: DateFormat): string | null {
  const pattern = {
    "YYYY-MM-DD": /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})$/,
    "DD.MM.YYYY": /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{4})$/,
    "DD/MM/YYYY": /^(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{4})$/,
    "MM/DD/YYYY": /^(?<month>\d{1,2})\/(?<day>\d{1,2})\/(?<year>\d{4})$/,
    "DD-MM-YYYY": /^(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{4})$/,
    "YYYY/MM/DD": /^(?<year>\d{4})\/(?<month>\d{1,2})\/(?<day>\d{1,2})$/,
    "DD.MM.YY": /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{2})$/
  }[format];
  // Bank exports often append a time to the booking date.
  const groups = pattern.exec(value.trim().split(/[ T]/)[0])?.groups;

  if (!groups) {
    return null;
  }

  const year = groups.year.length === 2 ? twoDigitYear(Number(groups.year)) : Number(groups.year);

  try {
    return Temporal.PlainDate.from({
      year,
      month: Number(groups.month),
      day: Number(groups.day)
    }, {
      overflow: "reject"
    }).toString();
  } catch {
    return null;
  }
}

const currencySymbols: Record<string, string> = {
  "€": "EUR",
  "£": "GBP",
  // Shared by several currencies: the row keeps the symbol, and only an account in one of its currencies accepts it.
  "$": "$",
  "¥": "¥"
};

export const ambiguousSymbols = new Set(["$", "¥"]);
const ambiguousSymbolCurrencies = new Map<string, string[]>();

/** The currencies an ambiguous symbol can denote: every currency the runtime writes with that narrow symbol. */
function symbolCurrencies(symbol: string) {
  let currencies = ambiguousSymbolCurrencies.get(symbol);

  if (!currencies) {
    currencies = Intl.supportedValuesOf("currency").filter(code => narrowSymbol(code) === symbol);
    ambiguousSymbolCurrencies.set(symbol, currencies);
  }

  return currencies;
}

function narrowSymbol(code: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol"
  }).formatToParts(0).find(part => part.type === "currency")?.value;
}

/** Whether a row's stated currency, an ISO code or an ambiguous symbol, allows the account currency; rows without a currency allow any. */
export function currencyAllows(stated: string | null, accountCurrency: string) {
  if (!stated) {
    return true;
  }

  const accepted = ambiguousSymbols.has(stated) ? symbolCurrencies(stated) : [stated];

  return accepted.includes(accountCurrency);
}

let isoCurrencies: Set<string> | undefined;

const leadingAffix = /^([-+(]?)\s*(€|£|\$|¥|[A-Za-z]{3}(?![A-Za-z]))\s*/;
const trailingAffix = /\s*(€|£|\$|¥|(?<![A-Za-z])[A-Za-z]{3})\s*([-)]?)$/;

/** Splits at most one currency symbol or ISO 4217 code off the start or end of an amount. Anything else, such as a symbol between digits or a second affix, stays in the text and makes the amount invalid. */
export function splitCurrency(value: string): {
  text: string;
  currency: string | null;
} {
  const text = value.trim();
  const leading = leadingAffix.exec(text);
  const trailing = trailingAffix.exec(text);
  const leadingCurrency = leading ? affixCurrency(leading[2]) : undefined;
  const trailingCurrency = trailing ? affixCurrency(trailing[1]) : undefined;

  if (leading && leadingCurrency !== undefined && !(trailing && trailingCurrency !== undefined)) {
    return {
      text: `${leading[1]}${text.slice(leading[0].length)}`,
      currency: leadingCurrency
    };
  }

  if (trailing && trailingCurrency !== undefined && !(leading && leadingCurrency !== undefined)) {
    return {
      text: `${text.slice(0, trailing.index)}${trailing[2]}`,
      currency: trailingCurrency
    };
  }

  return {
    text,
    currency: null
  };
}

/** The currency an affix names: the symbol itself when it is ambiguous, undefined when it is no currency. */
export function affixCurrency(affix: string) {
  if (Object.hasOwn(currencySymbols, affix)) {
    return currencySymbols[affix];
  }

  isoCurrencies ??= new Set(Intl.supportedValuesOf("currency"));

  return isoCurrencies.has(affix.toUpperCase()) ? affix.toUpperCase() : undefined;
}

/** Reads a money amount with the given decimal separator into an exact signed decimal string with a point. It tolerates one currency symbol or code, spaces and apostrophes as grouping, consistent thousands separators, and exactly one sign marker: a leading or trailing minus, a leading plus, or accounting parentheses. Anything else, including more than 15 integer or 6 fraction digits, is invalid. */
export function parseAmount(value: string, decimal: DecimalSeparator): string | null {
  if (value.length > maxAmountLength) {
    return null;
  }

  // Whitespace between digits and apostrophes stay until they are validated as groups of three of one kind (spaces or apostrophes); other whitespace is dropped.
  let text = splitCurrency(value).text.replace(/\s+(?!\d)|(?<!\d)\s+/gu, "");
  const separated = /^(\D*)(\d{1,3}(?:(?:[ \u00A0\u202F]\d{3})+|(?:['’]\d{3})+))(?!\d)/u.exec(text);

  if (separated) {
    text = separated[1] + separated[2].replace(/[ \u00A0\u202F'’]/gu, "") + text.slice(separated[0].length);
  }

  const parenthesized = /^\(.*\)$/.test(text);
  const markers = [parenthesized, text.startsWith("-"), text.endsWith("-") && text.length > 1, text.startsWith("+")].filter(Boolean).length;

  if (markers > 1) {
    return null;
  }

  const negative = markers === 1 && !text.startsWith("+");

  // Parentheses count only as a matching pair around the whole value; a lone one stays and makes the amount invalid.
  text = parenthesized ? text.slice(1, -1) : text.replace(/^[+-]|-$/g, "");

  const grouping = decimal === "," ? "." : ",";
  const grouped = new RegExp(`^\\d{1,3}(\\${grouping}\\d{3})+(\\${decimal}\\d+)?$`);
  const plain = new RegExp(`^\\d+(\\${decimal}\\d+)?$`);

  if (grouped.test(text)) {
    text = text.split(grouping).join("");
  } else if (!plain.test(text)) {
    return null;
  }

  const [integer, fraction = ""] = text.split(decimal);
  const whole = integer.replace(/^0+(?=\d)/, "");

  if (whole.length > maxIntegerDigits || fraction.length > maxFractionDigits) {
    return null;
  }

  const normalized = fraction ? `${whole}.${fraction}` : whole;

  return negative && /[1-9]/.test(normalized) ? `-${normalized}` : normalized;
}

/** The date format that reads the most samples, preferring the earlier format on ties; a few broken rows do not change the detected format. */
export function detectDateFormat(samples: string[]): DateFormat {
  const filled = samples.filter(sample => sample.trim() !== "");
  const scores = dateFormats.map(format => filled.filter(sample => parseDate(sample, format) !== null).length);
  const best = scores.indexOf(Math.max(...scores));

  return scores[best] > 0 ? dateFormats[best] : "YYYY-MM-DD";
}

/** A comma decimal when samples only read as amounts with a comma, or end in a comma followed by one or two digits. */
export function detectDecimal(samples: string[]): DecimalSeparator {
  const filled = samples.filter(sample => sample.trim() !== "");
  const comma = filled.filter(sample => parseAmount(sample, ",") !== null).length;
  const point = filled.filter(sample => parseAmount(sample, ".") !== null).length;

  if (comma !== point) {
    return comma > point ? "," : ".";
  }

  return filled.some(sample => /,\d{1,2}\)?-?$/.test(sample.trim())) ? "," : ".";
}

/** Lowercase Unicode letters and digits separated by single spaces; punctuation, symbols and diacritics are dropped. */
export function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Equal values in minor units have equal canonical forms: "2.5" and "2.50" both become "2.5".
export function canonicalAmount(amount: string) {
  return amount.includes(".") ? amount.replace(/0+$/, "").replace(/\.$/, "") : amount;
}

export function negate(amount: string) {
  return amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
}

export function signedScaled(amount: string, scale: number) {
  const value = absoluteScaled(amount, scale);

  return amount.startsWith("-") ? -value : value;
}

export function absoluteScaled(amount: string, scale: number) {
  const [integer, fraction = ""] = amount.replace("-", "").split(".");

  return BigInt(integer + fraction.padEnd(scale, "0"));
}

export function formatScaled(value: bigint, scale: number) {
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";

  return `${value < 0n ? "-" : ""}${integer}${fraction}`;
}

export function fractionDigits(value: string) {
  return value.split(".")[1]?.length ?? 0;
}
