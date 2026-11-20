import { suggestedCategoryColors } from "./category-colors";
import { categoryIcons, isCategoryIcon } from "./category-icons";

/** A category as the color suggestion reads it. */
export type ColoredCategory = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
};

const prefixSeparator = " / ";

/** The text before " / ", compared without case; a name without a prefix is its own prefix, so "Car" groups with "Car / Fuel". */
export function categoryPrefix(name: string) {
  const separator = name.indexOf(prefixSeparator);
  const prefix = separator === -1 ? name : name.slice(0, separator);

  return prefix.trim().toLowerCase();
}

function iconGroup(icon: string | null) {
  return isCategoryIcon(icon) ? categoryIcons[icon].group : null;
}

function mostCommonColor(colors: string[]) {
  if (colors.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();

  for (const color of colors) {
    const key = color.toUpperCase();


    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Ties go to the alphabetically first color, so the suggestion does not depend on list order.
  const ranked = [...counts].sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]));

  return ranked[0][0];
}

function prefixSiblings(name: string, others: ColoredCategory[]) {
  const prefix = categoryPrefix(name);

  if (prefix === "") {
    return [];
  }

  // Two plain names never match each other; one side must carry the " / " prefix.
  const hasPrefix = name.includes(prefixSeparator);

  return others.filter(other => categoryPrefix(other.name) === prefix && (hasPrefix || other.name.includes(prefixSeparator)));
}

/**
 * The color similar categories use: the most common color of categories sharing the name's prefix, otherwise of categories whose icon is in the same area.
 * Palette and custom colors count alike, as uppercase #RRGGBB. Null when no other category is similar. `others` must not contain the category being edited.
 */
export function suggestCategoryColor(name: string, icon: string | null, others: ColoredCategory[]) {
  const siblings = prefixSiblings(name.trim(), others);
  const siblingColor = mostCommonColor(siblings.map(other => other.color));

  if (siblingColor) {
    return siblingColor;
  }

  const group = iconGroup(icon);
  const sameArea = group ? others.filter(other => iconGroup(other.icon) === group) : [];

  return mostCommonColor(sameArea.map(other => other.color));
}

/** A random palette color among those the fewest categories use, so new categories do not all share one color. */
export function randomCategoryColor(usedColors: string[], random: () => number = Math.random) {
  const counts = new Map(suggestedCategoryColors.map(color => [color.value, 0]));

  for (const used of usedColors) {
    const key = used.toUpperCase();
    const count = counts.get(key);

    if (count !== undefined) {
      counts.set(key, count + 1);
    }
  }

  const fewest = Math.min(...counts.values());
  const candidates = [...counts].filter(([, count]) => count === fewest).map(([value]) => value);

  return candidates[Math.floor(random() * candidates.length)];
}

/** The color of a new category: what similar categories use, otherwise a random least used palette color. */
export function newCategoryColor(name: string, icon: string | null, existing: ColoredCategory[], random: () => number = Math.random) {
  return suggestCategoryColor(name, icon, existing) ?? randomCategoryColor(existing.map(category => category.color), random);
}
