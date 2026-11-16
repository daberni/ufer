type Rgb = [number, number, number];

const white: Rgb = [255, 255, 255];
const ink: Rgb = [0x24, 0x3a, 0x30];
const fallback: Rgb = [0x8b, 0x9e, 0x79];

// Share of the category color in the icon tile background; the rest is white.
const tileTint = 0.18;

// Share of the category color in the chip background, and of the chip text color in its border.
const chipTint = 0.16;
const chipBorderShare = 0.3;

// WCAG 1.4.11 asks for 3:1 contrast for meaningful graphics such as an icon on its tile.
const minimumIconContrast = 3;

// WCAG 1.4.3 asks for 4.5:1 contrast for the chip's category name; its icon shares that color.
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

// Keeps the category hue and mixes it toward the ink color only as far as a light color needs for contrast.
function readableOn(base: Rgb, background: Rgb, minimumContrast: number) {
  let color = base;

  for (let inkSteps = 1; inkSteps <= 10 && rgbContrast(color, background) < minimumContrast; inkSteps++) {
    color = mix(base, ink, 1 - inkSteps / 10);
  }

  return color;
}

export type CategoryTileColors = {
  swatch: string;
  tile: string;
  icon: string;
};

export function categoryTileColors(color: string): CategoryTileColors {
  const base = parseHex(color);
  const tile = mix(base, white, tileTint);

  return {
    swatch: toHex(base),
    tile: toHex(tile),
    icon: toHex(readableOn(base, tile, minimumIconContrast))
  };
}

export type CategoryChipColors = {
  background: string;
  border: string;
  foreground: string;
};

export function categoryChipColors(color: string): CategoryChipColors {
  const base = parseHex(color);
  const background = mix(base, white, chipTint);
  const foreground = readableOn(base, background, minimumTextContrast);

  return {
    background: toHex(background),
    border: toHex(mix(foreground, background, chipBorderShare)),
    foreground: toHex(foreground)
  };
}
