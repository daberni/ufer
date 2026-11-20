
type Rgb = [number, number, number];

export type ColorScheme = "light" | "dark";

type SchemeColors = {
  surface: Rgb;
  text: Rgb;
  /** Share of the category color in the chip background. */
  chipTint: number;
  /** Untinted backgrounds of a category name in a select: the field, the option list and its highlighted row. */
  selectBackgrounds: Rgb[];
};

// Mirrors --surface, --surface-raised, --soft and --ink in globals.css: tints mix into the surface, and readable colors move toward the text color.
const schemes: Record<ColorScheme, SchemeColors> = {
  light: {
    surface: [0xff, 0xff, 0xff],
    text: [0x24, 0x3a, 0x30],
    chipTint: 0.16,
    selectBackgrounds: [[0xff, 0xff, 0xff], [0xed, 0xf2, 0xe9]]
  },
  dark: {
    surface: [0x19, 0x22, 0x1d],
    text: [0xe3, 0xeb, 0xe5],
    chipTint: 0.22,
    selectBackgrounds: [[0x19, 0x22, 0x1d], [0x1f, 0x2a, 0x24], [0x22, 0x32, 0x2a]]
  }
};

const colorSchemes: ColorScheme[] = ["light", "dark"];

const fallback: Rgb = [0x8b, 0x9e, 0x79];

// Share of the chip text color in its border.
const chipBorderShare = 0.3;

// WCAG 1.4.11 asks for 3:1 contrast for meaningful graphics such as a share bar on its panel.
const minimumGraphicContrast = 3;

// WCAG 1.4.3 asks for 4.5:1 contrast for a category name; its icon shares that color.
const minimumTextContrast = 4.5;

// Neutral chips such as Uncategorized have no category color and use this gray-green.
export const neutralChipColor = "#7c8781";

function parseHex(color: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);

  if (!match) {
    return fallback;
  }

  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function toHex(color: Rgb) {
  return `#${color.map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(color: Rgb, other: Rgb, colorShare: number): Rgb {
  return [0, 1, 2].map(index => color[index] * colorShare + other[index] * (1 - colorShare)) as Rgb;
}

function luminance(color: Rgb) {
  const [red, green, blue] = color.map(channel => {
    const value = Math.round(channel) / 255;

    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function rgbContrast(first: Rgb, second: Rgb) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));

  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatio(first: string, second: string) {
  return rgbContrast(parseHex(first), parseHex(second));
}

// Keeps the category hue and mixes it toward the scheme's text color only as far as the color needs for contrast on every given background.
function readableOn(base: Rgb, backgrounds: Rgb[], minimumContrast: number, text: Rgb) {
  let color = base;
  const lowestContrast = () => Math.min(...backgrounds.map(background => rgbContrast(color, background)));

  for (let textSteps = 1; textSteps <= 10 && lowestContrast() < minimumContrast; textSteps++) {
    color = mix(base, text, 1 - textSteps / 10);
  }

  return color;
}

/**
 * Display color of a category share bar or swatch on a panel. Light panels show the stored color unchanged; dark panels lighten a dark color until the mark stays visible. The stored color itself never changes.
 */
export function categoryBarColor(color: string, scheme: ColorScheme) {
  const base = parseHex(color);

  if (scheme === "light") {
    return toHex(base);
  }

  const palette = schemes[scheme];

  return toHex(readableOn(base, [palette.surface], minimumGraphicContrast, palette.text));
}

export type CategoryChipColors = {
  background: string;
  border: string;
  foreground: string;
};

export function categoryChipColors(color: string, scheme: ColorScheme): CategoryChipColors {
  const base = parseHex(color);
  const palette = schemes[scheme];
  const background = mix(base, palette.surface, palette.chipTint);
  const foreground = readableOn(base, [background], minimumTextContrast, palette.text);

  return {
    background: toHex(background),
    border: toHex(mix(foreground, background, chipBorderShare)),
    foreground: toHex(foreground)
  };
}

/** Display color of a category's icon and name without a chip, as in the field and options of a category select. The stored color itself never changes. */
export function categoryTextColor(color: string, scheme: ColorScheme) {
  const palette = schemes[scheme];

  return toHex(readableOn(parseHex(color), palette.selectBackgrounds, minimumTextContrast, palette.text));
}

function lightDark(light: string, dark: string) {
  return `light-dark(${light}, ${dark})`;
}

/** A CSS color that follows the page's resolved color scheme, combined from its light and dark values. */
export function themedColor(colorFor: (scheme: ColorScheme) => string) {
  const [light, dark] = colorSchemes.map(colorFor);

  return lightDark(light, dark);
}

/** A set of CSS colors that follow the page's resolved color scheme, combined entry by entry from the light and dark sets. */
export function themedColors<Colors extends Record<string, string>>(colorsFor: (scheme: ColorScheme) => Colors): Colors {
  const [light, dark] = colorSchemes.map(colorsFor);
  const entries = Object.keys(light).map(key => [key, lightDark(light[key], dark[key])]);

  return Object.fromEntries(entries) as Colors;
}

export type SuggestedCategoryColor = {
  name: string;
  value: string;
};

// Mid-tone colors: a white icon glyph keeps 3:1 on each, and each keeps 3:1 against the dark surface, so they read well as solid marks in both themes.
export const suggestedCategoryColors: SuggestedCategoryColor[] = [
  {
    name: "Sage",
    value: "#638777"
  },
  {
    name: "Forest",
    value: "#33805A"
  },
  {
    name: "Jade",
    value: "#1D9E75"
  },
  {
    name: "Teal",
    value: "#1D8A80"
  },
  {
    name: "Ocean",
    value: "#2A74B0"
  },
  {
    name: "Indigo",
    value: "#5868C6"
  },
  {
    name: "Violet",
    value: "#7E59C4"
  },
  {
    name: "Plum",
    value: "#A04F95"
  },
  {
    name: "Rose",
    value: "#C2456F"
  },
  {
    name: "Crimson",
    value: "#C2413B"
  },
  {
    name: "Terracotta",
    value: "#B85C38"
  },
  {
    name: "Amber",
    value: "#B07415"
  },
  {
    name: "Ochre",
    value: "#937A2E"
  },
  {
    name: "Olive",
    value: "#6C7F2A"
  },
  {
    name: "Brown",
    value: "#90674D"
  },
  {
    name: "Slate",
    value: "#617385"
  }
];

/** A typed or pasted hex color as uppercase #RRGGBB: the leading # is optional, letter case is ignored and #RGB shorthand is expanded. Anything else is null. */
export function parseHexColor(input: string) {
  const digits = input.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(digits)) {
    return `#${[...digits].map(digit => digit + digit).join("").toUpperCase()}`;
  }

  if (/^[0-9a-f]{6}$/i.test(digits)) {
    return `#${digits.toUpperCase()}`;
  }

  return null;
}

/** The uppercase display form of a stored color. */
export function formatHexColor(color: string) {
  return color.toUpperCase();
}

const white: Rgb = [0xff, 0xff, 0xff];

// The light theme's text color, for a glyph on a category color too light for white.
const darkGlyph: Rgb = [0x24, 0x3a, 0x30];

/** Color of an icon glyph drawn on a solid category mark (see categoryBarColor): white where it keeps 3:1, dark text otherwise. */
export function categoryGlyphColor(color: string, scheme: ColorScheme) {
  const mark = parseHex(categoryBarColor(color, scheme));

  return toHex(rgbContrast(white, mark) >= minimumGraphicContrast ? white : darkGlyph);
}
