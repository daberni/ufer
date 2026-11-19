import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "@/lib/errors";
import { builtInTemplates, dateFormats, emptyMapping, maxCategoryChoicesPerRequest, maxCategoryLength, maxColumnNameLength, maxSourceLength, maxTargetsPerRequest, maxTemplateColumns, maxTemplateNameLength, type CsvMapping } from "../csv-mapping";
import { deleteTemplate, insertTemplate, listTemplates, updateTemplate, type TemplateDefinition } from "./template-repository";

const name = z.string().trim().min(1).max(maxTemplateNameLength);

const column = z.string().trim().max(maxColumnNameLength);

const fields = Object.keys(emptyMapping) as [keyof CsvMapping, ...(keyof CsvMapping)[]];

const definitionFields = {
  header: z.array(column).min(1).max(maxTemplateColumns),
  settings: z.object({
    decimal: z.enum([".", ","]).optional(),
    dateFormat: z.enum(dateFormats).optional()
  }).strict(),
  columns: z.partialRecord(z.enum(fields), z.number().int().min(0).max(maxTemplateColumns - 1)),
  accounts: z.record(z.string().max(maxSourceLength), z.string().min(1).max(100)).refine(accounts => Object.keys(accounts).length <= maxTargetsPerRequest, "Too many account choices."),
  categories: z.record(z.string().max(maxCategoryLength), z.string().min(1).max(100)).refine(categories => Object.keys(categories).length <= maxCategoryChoicesPerRequest, "Too many category choices.")
};

type DefinitionShape = {
  header: string[];
  columns: Partial<Record<keyof CsvMapping, number>>;
};

function columnsFitHeader(value: DefinitionShape) {
  return Object.values(value.columns).every(position => position < value.header.length);
}

function columnsDistinct(value: DefinitionShape) {
  return new Set(Object.values(value.columns)).size === Object.values(value.columns).length;
}

// One strict object per request shape, so no strict part of a combined schema can reject the other part's keys.
function checkedDefinition<T extends z.ZodType<DefinitionShape>>(schema: T) {
  return schema.refine(columnsFitHeader, "Every mapped column must be part of the header.").refine(columnsDistinct, "Each column can have only one role.");
}

const definition = checkedDefinition(z.object(definitionFields).strict());

const templateInput = checkedDefinition(z.object({
  name,
  ...definitionFields
}).strict());

/** Saved templates first, then the built-in ones defined in code; matching uses the same order, so a saved template for a built-in header wins. */
export async function readTemplates() {
  return [...(await listTemplates()), ...builtInTemplates];
}

function requireEditable(id: string) {
  if (builtInTemplates.some(template => template.id === id)) {
    throw new HttpError(409, "Built-in templates cannot be changed. Duplicate it to edit a copy.");
  }
}

/** Saves an editable copy of a template under a new name; the copy takes over files with the same header. */
export async function duplicateTemplate(id: string, payload: unknown) {
  const { name: copyName } = z.object({
    name
  }).strict().parse(payload);
  const source = (await readTemplates()).find(template => template.id === id);

  if (!source) {
    throw new HttpError(404, "Template not found.");
  }

  return createTemplate({
    name: copyName,
    header: source.header,
    settings: source.settings,
    columns: source.columns,
    accounts: source.accounts,
    categories: source.categories
  });
}

export async function createTemplate(payload: unknown) {
  const {
    name: templateName,
    ...rest
  } = templateInput.parse(payload);
  const id = randomUUID();

  await insertTemplate(id, templateName, rest as TemplateDefinition);

  return {
    id
  };
}

/** Renames a template, replaces its mapping, or both. */
export async function changeTemplate(id: string, payload: unknown) {
  requireEditable(id);

  const input = z.object({
    name: name.optional(),
    definition: definition.optional()
  }).strict().parse(payload);

  if (!(await updateTemplate(id, {
    name: input.name,
    definition: input.definition as TemplateDefinition | undefined
  }))) {
    throw new HttpError(404, "Template not found.");
  }

  return {
    ok: true
  };
}

export async function removeTemplate(id: string) {
  requireEditable(id);

  if (!(await deleteTemplate(id))) {
    throw new HttpError(404, "Template not found.");
  }

  return {
    ok: true
  };
}
