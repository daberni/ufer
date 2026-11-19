import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "@/lib/errors";
import { dateFormats, emptyMapping, maxCategoryChoicesPerRequest, maxCategoryLength, maxColumnNameLength, maxSourceLength, maxTargetsPerRequest, maxTemplateColumns, maxTemplateNameLength, type CsvMapping } from "../csv-mapping";
import { deleteTemplate, insertTemplate, listTemplates, updateTemplate, type TemplateDefinition } from "./template-repository";

const name = z.string().trim().min(1).max(maxTemplateNameLength);

const column = z.string().trim().max(maxColumnNameLength);

const fields = Object.keys(emptyMapping) as [keyof CsvMapping, ...(keyof CsvMapping)[]];

const definition = z.object({
  header: z.array(column).min(1).max(maxTemplateColumns),
  settings: z.object({
    decimal: z.enum([".", ","]).optional(),
    dateFormat: z.enum(dateFormats).optional()
  }).strict(),
  columns: z.partialRecord(z.enum(fields), z.number().int().min(0).max(maxTemplateColumns - 1)),
  accounts: z.record(z.string().max(maxSourceLength), z.string().min(1).max(100)).refine(accounts => Object.keys(accounts).length <= maxTargetsPerRequest, "Too many account choices."),
  categories: z.record(z.string().max(maxCategoryLength), z.string().min(1).max(100)).refine(categories => Object.keys(categories).length <= maxCategoryChoicesPerRequest, "Too many category choices.")
}).strict().refine(value => Object.values(value.columns).every(position => position < value.header.length), "Every mapped column must be part of the header.").refine(value => new Set(Object.values(value.columns)).size === Object.values(value.columns).length, "Each column can have only one role.");

const templateInput = definition.and(z.object({
  name
}));

export function readTemplates() {
  return listTemplates();
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
  if (!(await deleteTemplate(id))) {
    throw new HttpError(404, "Template not found.");
  }

  return {
    ok: true
  };
}
