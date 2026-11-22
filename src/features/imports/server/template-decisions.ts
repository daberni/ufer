import { HttpError } from "@/lib/errors";

/** Saved templates are few hand-made layouts; the bound keeps the list a page section. */
export const maximumTemplates = 100;

/** Refuses a template beyond the limit; the service words the refusal for the request after the transaction has rolled back. */
export class TemplateLimitReached extends Error {
  constructor(readonly maximum: number) {
    super("The template limit is reached.");
  }
}

/** Throws when another template is already stored; the total counts every saved template. */
export function requireTemplateCapacity(total: number) {
  if (total >= maximumTemplates) {
    throw new TemplateLimitReached(maximumTemplates);
  }
}

type StoredTemplate = {
  id: string;
  name: string;
};

/**
 * Refuses a template whose name or header another template already has; `ownId` is the template being changed, which may keep its own name and header.
 * The unique indexes enforce the same; checking first gives the person a message instead of a constraint error.
 */
export function requireUniqueTemplate(name: string, sameName: StoredTemplate | undefined, sameHeader: StoredTemplate | undefined, ownId: string | null) {
  if (sameName && sameName.id !== ownId) {
    throw new HttpError(409, `A template named “${name}” already exists.`);
  }

  if (sameHeader && sameHeader.id !== ownId) {
    throw new HttpError(409, `The template “${sameHeader.name}” already covers files with these columns. Update or delete it instead.`);
  }
}
