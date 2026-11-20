import { defaultCategoryColor, suggestedCategoryColors } from "./category-colors";
import { categoryIcons, isCategoryIcon, type CategoryIconGroup, type CategoryIconKey } from "./category-icons";

type PaletteName = "Sage" | "Forest" | "Jade" | "Teal" | "Ocean" | "Indigo" | "Violet" | "Plum" | "Rose" | "Crimson" | "Terracotta" | "Amber" | "Ochre" | "Olive" | "Brown" | "Slate";

/** A category as the suggestions read it. */
export type ColoredCategory = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
};

export type CategoryColorSuggestion = {
  category: ColoredCategory;
  /** The suggested palette color as uppercase #RRGGBB. */
  suggested: string;
  /** False when the stored color already is the suggestion. */
  changed: boolean;
};

// Related areas share a family; the first color is preferred and the next ones keep separate prefix groups of one area distinct.
const groupFamilies: Record<CategoryIconGroup, PaletteName[]> = {
  home: ["Terracotta", "Brown"],
  transport: ["Ocean", "Indigo"],
  travel: ["Teal", "Jade"],
  food: ["Amber", "Ochre"],
  shopping: ["Ochre", "Amber"],
  work: ["Olive", "Ochre"],
  health: ["Rose", "Plum"],
  leisure: ["Plum", "Rose"],
  family: ["Violet", "Indigo"],
  money: ["Slate", "Sage"],
  other: ["Sage", "Slate"]
};

// Icons whose meaning differs from their group: income in the income green, fines as a warning, subscriptions with giving.
const iconFamilies: Partial<Record<CategoryIconKey, PaletteName[]>> = {
  income: ["Forest", "Jade"],
  salary: ["Forest", "Jade"],
  interest: ["Forest", "Jade"],
  pension: ["Forest", "Jade"],
  refunds: ["Forest", "Jade"],
  savings: ["Jade", "Forest"],
  investments: ["Jade", "Forest"],
  stocks: ["Jade", "Forest"],
  crypto: ["Jade", "Forest"],
  insurance: ["Sage", "Slate"],
  subscriptions: ["Indigo", "Violet"],
  memberships: ["Indigo", "Violet"],
  fines: ["Crimson"]
};

const paletteValues = new Map(suggestedCategoryColors.map(color => [color.name, color.value]));

const prefixSeparator = " / ";

function paletteValue(name: PaletteName) {
  return paletteValues.get(name) ?? defaultCategoryColor.toUpperCase();
}

function iconFamily(icon: string | null): PaletteName[] | null {
  if (!isCategoryIcon(icon)) {
    return null;
  }

  return iconFamilies[icon] ?? groupFamilies[categoryIcons[icon].group];
}

/** The text before " / ", compared without case; a name without a prefix is its own prefix, so "Car" groups with "Car / Fuel". */
export function categoryPrefix(name: string) {
  const separator = name.indexOf(prefixSeparator);
  const prefix = separator === -1 ? name : name.slice(0, separator);

  return prefix.trim().toLowerCase();
}

/** Whether a color is one of the curated palette colors, ignoring case. */
export function isPaletteColor(color: string) {
  return suggestedCategoryColors.some(suggestion => suggestion.value.toLowerCase() === color.toLowerCase());
}

function mostCommonColor(colors: string[]) {
  const counts = new Map<string, number>();

  for (const color of colors) {
    const key = color.toUpperCase();

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Ties go to the alphabetically first color, so the suggestion does not depend on list order.
  const ranked = [...counts].sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]));

  return ranked[0][0];
}

/**
 * The color preselected for a new category: the color its prefix siblings share, otherwise the first color of its icon's family, otherwise the default color.
 */
export function suggestNewCategoryColor(name: string, icon: string | null, existing: ColoredCategory[]) {
  const hasPrefix = name.includes(prefixSeparator);
  const prefix = categoryPrefix(name);
  const siblings = prefix === "" ? [] : existing.filter(category => categoryPrefix(category.name) === prefix && (hasPrefix || category.name.includes(prefixSeparator)));

  if (siblings.length > 0) {
    return mostCommonColor(siblings.map(category => category.color));
  }

  const family = iconFamily(icon);

  if (family) {
    return paletteValue(family[0]);
  }

  return defaultCategoryColor.toUpperCase();
}

function groupFamily(members: ColoredCategory[], prefix: string): PaletteName[] {
  // The category named like the prefix ("Car") decides first, then the most common family among the members' icons.
  const head = members.find(category => category.name.trim().toLowerCase() === prefix);
  const headFamily = head ? iconFamily(head.icon) : null;

  if (headFamily) {
    return headFamily;
  }

  const counts = new Map<string, {
    family: PaletteName[];
    count: number;
  }>();

  for (const member of members) {
    const family = iconFamily(member.icon);

    if (!family || family.length === 1) {
      continue;
    }

    const key = family.join();
    const entry = counts.get(key) ?? {
      family,
      count: 0
    };

    entry.count += 1;
    counts.set(key, entry);
  }

  const ranked = [...counts.values()].sort((first, second) => second.count - first.count || first.family.join().localeCompare(second.family.join()));

  return ranked[0]?.family ?? groupFamilies.other;
}

/**
 * Suggests a palette color for every category. Categories sharing a prefix get one color, chosen from the family of their icons and distinct from other prefix
 * groups while the family has colors left; other categories get their icon's family color, and those without an icon keep their color. Fines keep their warning color inside a group. The result follows the
 * given order and does not depend on it.
 */
export function suggestCategoryColors(categories: ColoredCategory[]): CategoryColorSuggestion[] {
  const groups = new Map<string, ColoredCategory[]>();

  for (const category of categories) {
    const prefix = categoryPrefix(category.name);

    groups.set(prefix, [...(groups.get(prefix) ?? []), category]);
  }

  const groupColors = new Map<string, string>();
  // Distinctness is tracked per family, so a group of another area sharing a color cannot push two groups of one area onto the same color.
  const usedByFamily = new Map<string, Set<PaletteName>>();
  const prefixGroups = [...groups].filter(([, members]) => members.length > 1).sort(([first], [second]) => first.localeCompare(second));

  for (const [prefix, members] of prefixGroups) {
    const family = groupFamily(members, prefix);
    const used = usedByFamily.get(family.join()) ?? new Set<PaletteName>();
    const available = family.find(name => !used.has(name)) ?? family[0];

    used.add(available);
    usedByFamily.set(family.join(), used);
    groupColors.set(prefix, paletteValue(available));
  }

  return categories.map(category => {
    const ownFamily = iconFamily(category.icon);
    const keepsOwnColor = ownFamily?.length === 1;
    const groupColor = groupColors.get(categoryPrefix(category.name));
    // Without a prefix group or an icon there is nothing to suggest from, so the category keeps its color.
    let suggested = category.color.toUpperCase();

    if (groupColor && !keepsOwnColor) {
      suggested = groupColor;
    } else if (ownFamily) {
      suggested = paletteValue(ownFamily[0]);
    }

    return {
      category,
      suggested,
      changed: suggested.toLowerCase() !== category.color.toLowerCase()
    };
  });
}
