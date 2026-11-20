import { z } from "zod";
import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits, money } from "@/lib/money";
import { prepareRules, ruleAssignment } from "@/lib/rules";
import { categoryExists } from "@/features/categorization/server/category-repository";
import { removeSplit, replaceSplit, type SplitPartValues, type SplitSubject } from "./split-repository";

/** The most parts one booking can be split into. */
export const maximumSplitParts = 50;

const splitInput = z.object({
  parts: z.array(z.object({
    amount: z.string().max(30),
    category_id: z.string().min(1).nullable(),
    note: z.string().trim().max(200).default("")
  }).strict()).max(maximumSplitParts)
}).strict();

type PartInput = z.infer<typeof splitInput>["parts"][number];

/** Only income and expenses count by category; transfers, opening balances and adjustments are not split. */
function splittable(type: SplitSubject["type"]) {
  return type === "income" || type === "expense";
}

/** Parses the parts in the booking's currency and checks that they add up to its amount exactly. */
function validParts(subject: SplitSubject, parts: PartInput[]): SplitPartValues[] {
  if (!splittable(subject.type)) {
    throw new ValidationError("Only income and expenses can be split.");
  }

  const values = parts.map(part => ({
    amount: minorUnits(part.amount, subject.currency),
    categoryId: part.category_id,
    note: part.note
  }));

  if (values.some(part => part.amount === 0)) {
    throw new ValidationError("Every part needs an amount.");
  }

  const total = values.reduce((sum, part) => sum + part.amount, 0);

  if (total !== subject.amount_minor) {
    throw new ValidationError(`The parts add up to ${money(total, subject.currency)} instead of ${money(subject.amount_minor, subject.currency)}.`);
  }

  return values;
}

/** Splits a booking into at least two category parts that add up exactly to its amount, replacing any earlier split. */
export async function splitTransaction(id: string, payload: unknown) {
  const input = splitInput.parse(payload);

  if (input.parts.length < 2) {
    throw new ValidationError("A split needs at least two parts.");
  }

  const categoryIds = new Set(input.parts.map(part => part.category_id).filter(categoryId => categoryId !== null));

  for (const categoryId of categoryIds) {
    if (!(await categoryExists(categoryId))) {
      throw new ValidationError("Category does not exist.");
    }
  }

  const parts = await replaceSplit(id, subject => validParts(subject, input.parts));

  if (!parts) {
    throw new HttpError(404, "Transaction not found.");
  }

  return {
    ok: true
  };
}

/** Removes a booking's split; the booking returns to the category its rules assign. */
export async function unsplitTransaction(id: string) {
  const result = await removeSplit(id, (storedRules, text) => ruleAssignment(text, prepareRules(storedRules)));

  if (!result) {
    throw new HttpError(404, "Transaction not found.");
  }

  return result;
}
