import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Renders the web app manifest's raster icons from the canonical vector icon. Run with `npm run icons:generate` after the mark changes.
const root = path.resolve(import.meta.dirname, "..");
const sourceIcon = path.join(root, "src/app/icon.svg");
const outputDirectory = path.join(root, "public/icons");

// The icon's forest background, used to fill the full square of the maskable variant.
const forest = "#233e31";

// Maskable icons keep their content inside a centered circle of 80 % of the size; the mark is scaled into that safe zone.
const maskableSafeZone = 0.8;

async function renderIcon(size: number, fileName: string) {
  await sharp(sourceIcon, {
    density: 72 * size / 512
  }).resize(size, size).png({
    compressionLevel: 9
  }).toFile(path.join(outputDirectory, fileName));
}

async function renderMaskableIcon(size: number, fileName: string) {
  const markSize = Math.round(size * maskableSafeZone);
  const mark = await sharp(sourceIcon, {
    density: 72 * markSize / 512
  }).resize(markSize, markSize).png().toBuffer();
  const offset = Math.round((size - markSize) / 2);

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: forest
    }
  }).composite([{
    input: mark,
    top: offset,
    left: offset
  }]).flatten({
    background: forest
  }).png({
    compressionLevel: 9
  }).toFile(path.join(outputDirectory, fileName));
}

async function generateAppIcons() {
  await mkdir(outputDirectory, {
    recursive: true
  });
  await renderIcon(192, "icon-192.png");
  await renderIcon(512, "icon-512.png");
  await renderMaskableIcon(512, "icon-maskable-512.png");
}

void generateAppIcons();
