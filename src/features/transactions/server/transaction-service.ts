import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { categoryExists } from "@/features/categorization/server/category-repository";
import { setTransactionCategory } from "./transaction-repository";

export async function updateTransactionCategory(id: string, payload: unknown) {
  const {
    category_id: categoryId
  } = z.object({
    category_id: z.string().min(1).nullable()
  }).parse(payload);

  if (categoryId && !(await categoryExists(categoryId))) {
    throw new ValidationError("Category does not exist.");
  }

  if (!(await setTransactionCategory(id, categoryId))) {
    throw new HttpError(404, "Transaction not found.");
  }

  return {
    ok: true
  };
}
