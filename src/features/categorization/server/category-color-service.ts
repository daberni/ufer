import { z } from "zod";
import { HttpError, ValidationError } from "@/lib/errors";
import { isPaletteColor } from "@/features/categorization/category-color-suggestions";
import { updateCategoryColors } from "./category-repository";

const categoryColorsInput = z.object({
  colors: z.array(z.object({
    id: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value such as #638777.")
  }).strict()).min(1).max(1000)
}).strict();

/** Applies confirmed color suggestions: only curated palette colors, each category once, all or nothing. */
export async function applyCategoryColors(payload: unknown) {
  const { colors } = categoryColorsInput.parse(payload);
  const ids = new Set(colors.map(entry => entry.id));

  if (ids.size !== colors.length) {
    throw new ValidationError("Each category can only receive one color.");
  }

  if (!colors.every(entry => isPaletteColor(entry.color))) {
    throw new ValidationError("Choose colors from the suggested palette.");
  }

  const updates = colors.map(entry => ({
    id: entry.id,
    color: entry.color.toLowerCase()
  }));

  if (await updateCategoryColors(updates) === "not_found") {
    throw new HttpError(404, "Category not found.");
  }

  return {
    ok: true,
    updated: updates.length
  };
}
