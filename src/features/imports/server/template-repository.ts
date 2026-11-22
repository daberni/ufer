import { asc, count, eq } from "drizzle-orm";
import { categoryNameKey } from "@/lib/category-name";
import { HttpError } from "@/lib/errors";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { importTemplates } from "@/server/database/schema";
import { headerKey, type CsvTemplate } from "../csv-templates";

export type TemplateDefinition = Omit<CsvTemplate, "id" | "name" | "builtIn">;

export async function listTemplates(): Promise<CsvTemplate[]> {
  const db = await database();
  const rows = await db.select().from(importTemplates).orderBy(asc(importTemplates.name_key), asc(importTemplates.id));

  return rows.map(row => ({
    ...(JSON.parse(row.definition) as TemplateDefinition),
    id: row.id,
    name: row.name,
    builtIn: false
  }));
}

/** The number of saved templates. */
export async function countTemplates(tx: DatabaseTransaction) {
  const stored = await tx.select({
    total: count()
  }).from(importTemplates).get();

  return stored?.total ?? 0;
}

export async function findTemplate(tx: DatabaseTransaction, id: string) {
  return tx.select().from(importTemplates).where(eq(importTemplates.id, id)).get();
}

/** The saved templates with an equivalent name and with the same header, which a new or changed template would conflict with. */
export async function findTemplateConflicts(tx: DatabaseTransaction, name: string, header: string[]) {
  const sameName = await tx.select({
    id: importTemplates.id,
    name: importTemplates.name
  }).from(importTemplates).where(eq(importTemplates.name_key, categoryNameKey(name))).get();
  const sameHeader = await tx.select({
    id: importTemplates.id,
    name: importTemplates.name
  }).from(importTemplates).where(eq(importTemplates.header_key, headerKey(header))).get();

  return {
    sameName,
    sameHeader
  };
}

export async function insertTemplate(tx: DatabaseTransaction, id: string, name: string, definition: TemplateDefinition) {
  const now = new Date().toISOString();

  await uniqueWrite(tx.insert(importTemplates).values({
    id,
    name,
    name_key: categoryNameKey(name),
    header_key: headerKey(definition.header),
    definition: JSON.stringify(definition),
    created_at: now,
    updated_at: now
  }));
}

export async function updateTemplate(tx: DatabaseTransaction, id: string, name: string, definition: TemplateDefinition) {
  await uniqueWrite(tx.update(importTemplates).set({
    name,
    name_key: categoryNameKey(name),
    header_key: headerKey(definition.header),
    definition: JSON.stringify(definition),
    updated_at: new Date().toISOString()
  }).where(eq(importTemplates.id, id)));
}

export async function deleteTemplate(id: string) {
  const db = await database();
  const deleted = await db.delete(importTemplates).where(eq(importTemplates.id, id)).returning({
    id: importTemplates.id
  });

  return deleted.length > 0;
}

/** A concurrent write can pass the check above and still hit a unique index; it gets the same conflict instead of a server error. */
export async function uniqueWrite<T>(write: PromiseLike<T>) {
  try {
    return await write;
  } catch (error) {
    const message = constraintMessage(error);

    if (message.includes("import_templates.name_key")) {
      throw new HttpError(409, "A template with this name already exists.");
    }

    if (message.includes("import_templates.header_key")) {
      throw new HttpError(409, "Another template already covers files with these columns. Update or delete it instead.");
    }

    throw error;
  }
}

function constraintMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "";
  }

  return `${error.message} ${constraintMessage(error.cause)}`;
}
