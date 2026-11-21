import { emptyMapping, type CsvMapping, type CsvSettings } from "./csv-mapping";
import { defaultConventions, defaultTypeValues, type RowConventions, type TypeValues } from "./import-rows";

// Source-specific layouts: built-in formats defined in code and the shape of saved templates.

/** A source-specific layout, recognized by its exact header row and mapped by column name. Saved templates also remember account and category choices by source value. */
export type CsvTemplate = {
  id: string;
  name: string;
  builtIn: boolean;
  /** The header row the template recognizes, compared cell by cell after trimming. */
  header: string[];
  settings: Partial<Pick<CsvSettings, "decimal" | "dateFormat">>;
  /** Column positions in `header`; positions rather than names keep repeated header names apart. */
  columns: Partial<Record<keyof CsvMapping, number>>;
  /** Existing account IDs by source account label. */
  accounts: Record<string, string>;
  /** Existing category IDs by category value. */
  categories: Record<string, string>;
  /** Types by lowercase type column value. Saved before type values were remembered, a template has none and takes those of the built-in template for its header. */
  types?: TypeValues;
  /** Row conventions of a built-in format; saved templates are not stored with them and take them from the built-in template for their header. */
  conventions?: RowConventions;
};

/** Longest header and template name the saved templates accept; the server applies the same limits. */
export const maxTemplateColumns = 200;

export const maxTemplateNameLength = 100;

export const maxColumnNameLength = 200;

/**
 * Buxfer's transaction export. `Tags` holds the categories, possibly several separated by commas; `Type` states expenses, income, refunds (expenses with a positive amount) and transfers, which the automatic rule pairs after the import, and `Status`, `Memo` and `IOU` stay unmapped. Amounts are signed except for `Investment purchase`, which Buxfer exports as a positive amount. Until Ufer tracks holdings, a settlement account stands for its cash plus securities at cost, so purchases and sales import hidden with their exported amount and text; capital gains and losses count as ordinary bookings. Buxfer shortens long descriptions with "...", which duplicate matching tolerates because a shortened text is contained in the full one.
 */
export const buxferTemplate: CsvTemplate = {
  id: "builtin:buxfer",
  name: "Buxfer export",
  builtIn: true,
  header: ["ID", "Date", "Description", "Currency", "Amount", "Type", "Tags", "Account", "Status", "Memo", "IOU"],
  settings: {
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  },
  columns: {
    id: 0,
    date: 1,
    description: 2,
    currency: 3,
    amount: 4,
    type: 5,
    category: 6,
    account: 7
  },
  accounts: {},
  categories: {},
  types: {
    expense: "expense",
    refund: "expense",
    income: "income",
    transfer: "transfer"
  },
  conventions: {
    ...defaultConventions,
    amountTags: true,
    hiddenTypes: ["investment purchase", "investment sale"]
  }
};

export const builtInTemplates: CsvTemplate[] = [buxferTemplate];

/** A comparable form of a header row: trimmed cells, order preserved. */
export function headerKey(header: string[]) {
  return JSON.stringify(header.map(column => column.trim()));
}

/** The row conventions an applied template declares: its own, those of the built-in template for the same header (so a saved Buxfer template keeps Buxfer's), or the defaults. */
export function templateConventions(template: CsvTemplate | null): RowConventions {
  if (template === null) {
    return defaultConventions;
  }

  const builtIn = builtInTemplates.find(candidate => headerKey(candidate.header) === headerKey(template.header));

  return template.conventions ?? builtIn?.conventions ?? defaultConventions;
}

/** The type values an applied template maps: its own, those of the built-in template for the same header, or the defaults. */
export function templateTypeValues(template: CsvTemplate | null): TypeValues {
  if (template === null) {
    return defaultTypeValues;
  }

  const builtIn = builtInTemplates.find(candidate => headerKey(candidate.header) === headerKey(template.header));

  return template.types ?? builtIn?.types ?? defaultTypeValues;
}

/** The first template in `templates` for a header; lists put saved templates before built-in ones, so a person can override a built-in layout. */
export function matchTemplate(header: string[], templates: CsvTemplate[]): CsvTemplate | null {
  const key = headerKey(header);

  return templates.find(template => headerKey(template.header) === key) ?? null;
}

/** The format a template applies: the file's current encoding and delimiter, which the person may have corrected and which decide how the header was read, with the template's date and decimal format over the detected ones. */
export function templateSettings(template: Pick<CsvTemplate, "settings">, detected: CsvSettings, current: CsvSettings | null): CsvSettings {
  return {
    ...detected,
    encoding: current?.encoding ?? detected.encoding,
    delimiter: current?.delimiter ?? detected.delimiter,
    ...template.settings
  };
}

/** A template's name as listed, marking the ones defined in code. */
export function templateLabel(template: Pick<CsvTemplate, "name" | "builtIn">) {
  return template.builtIn ? `${template.name} (built-in)` : template.name;
}

/** A template that recreates a mapping on files with the same header: column positions, the format, and the given account, category and type value choices. */
export function templateFromMapping(name: string, header: string[], mapping: CsvMapping, settings: CsvSettings, accounts: Record<string, string>, categories: Record<string, string>, types: TypeValues): Omit<CsvTemplate, "id" | "builtIn"> {
  const columns: CsvTemplate["columns"] = {};

  for (const field of Object.keys(mapping) as (keyof CsvMapping)[]) {
    const column = mapping[field];

    if (column !== null && header[column] !== undefined) {
      columns[field] = column;
    }
  }

  return {
    name: name.trim(),
    header: header.map(column => column.trim()),
    settings: {
      decimal: settings.decimal,
      dateFormat: settings.dateFormat
    },
    columns,
    accounts,
    categories,
    types
  };
}

/** Applies a template's column positions to a header it matches; positions outside the header stay unmapped. */
export function templateMapping(template: CsvTemplate, header: string[]): CsvMapping {
  const mapping = {
    ...emptyMapping
  };

  for (const [field, column] of Object.entries(template.columns) as [keyof CsvMapping, number][]) {
    mapping[field] = column < header.length ? column : null;
  }

  return mapping;
}
