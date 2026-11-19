import { asc, count, eq, sql } from "drizzle-orm";
import { HttpError } from "@/lib/errors";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { importTemplates } from "@/server/database/schema";
import { headerKey, type CsvTemplate } from "../csv-mapping";

/** Saved templates are few hand-made layouts; the bound keeps the list a page section. */
export const maximumTemplates = 100;

export type TemplateDefinition = Omit<CsvTemplate, "id" | "name" | "builtIn">;

export async function listTemplates(): Promise<CsvTemplate[]> {
  const db = await database();
  const rows = await db.select().from(importTemplates).orderBy(asc(sql`lower(${importTemplates.name})`), asc(importTemplates.id));

  return rows.map(row => ({
    ...(JSON.parse(row.definition) as TemplateDefinition),
    id: row.id,
    name: row.name,
    builtIn: false
  }));
}

/** Stores a new template; another template for the same header or with the same name is a conflict. */
export async function insertTemplate(id: string, name: string, definition: TemplateDefinition) {
  const db = await database();
  const now = new Date().toISOString();

  await db.transaction(async tx => {
    const stored = await tx.select({
      total: count()
    }).from(importTemplates).get();

    if ((stored?.total ?? 0) >= maximumTemplates) {
      throw new HttpError(409, `Ufer keeps at most ${maximumTemplates} templates. Delete one before saving another.`);
    }

    await requireUnique(tx, name, definition.header, null);
    await tx.insert(importTemplates).values({
      id,
      name,
      header_key: headerKey(definition.header),
      definition: JSON.stringify(definition),
      created_at: now,
      updated_at: now
    });
  });
}

/** Renames a template or replaces its definition; false when it does not exist. */
export async function updateTemplate(id: string, change: {
  name?: string;
  definition?: TemplateDefinition;
}) {
  const db = await database();

  return db.transaction(async tx => {
    const current = await tx.select().from(importTemplates).where(eq(importTemplates.id, id)).get();

    if (!current) {
      return false;
    }

    const name = change.name ?? current.name;
    const definition = change.definition ?? JSON.parse(current.definition) as TemplateDefinition;

    await requireUnique(tx, name, definition.header, id);
    await tx.update(importTemplates).set({
      name,
      header_key: headerKey(definition.header),
      definition: JSON.stringify(definition),
      updated_at: new Date().toISOString()
    }).where(eq(importTemplates.id, id));

    return true;
  });
}

export async function deleteTemplate(id: string) {
  const db = await database();
  const deleted = await db.delete(importTemplates).where(eq(importTemplates.id, id)).returning({
    id: importTemplates.id
  });

  return deleted.length > 0;
}

// The unique indexes enforce the same; checking first gives the person a message instead of a constraint error.
async function requireUnique(tx: DatabaseTransaction, name: string, header: string[], ownId: string | null) {
  const sameName = await tx.select({
    id: importTemplates.id
  }).from(importTemplates).where(eq(sql`lower(${importTemplates.name})`, name.toLowerCase())).get();

  if (sameName && sameName.id !== ownId) {
    throw new HttpError(409, `A template named “${name}” already exists.`);
  }

  const sameHeader = await tx.select({
    name: importTemplates.name,
    id: importTemplates.id
  }).from(importTemplates).where(eq(importTemplates.header_key, headerKey(header))).get();

  if (sameHeader && sameHeader.id !== ownId) {
    throw new HttpError(409, `The template “${sameHeader.name}” already covers files with these columns. Update or delete it instead.`);
  }
}
