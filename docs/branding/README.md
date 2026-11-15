# Ufer identity

![Ufer icon](../../src/components/branding/ufer-icon.svg)

The U-shaped riverbanks, winding channel and two ripples connect Ufer's shoreline meaning with banking. The forest-green background and pale-sage mark keep the identity consistent with the application.

## Production assets

| Asset | Purpose |
| --- | --- |
| [Canonical SVG](../../src/components/branding/ufer-icon.svg) | Editable vector master: filled paths and rounded background, no embedded raster |
| [Browser icon](../../src/app/icon.svg) | Same artwork, discovered through Next.js metadata |
| [Apple touch icon](../../src/app/apple-icon.png) | Opaque 180 × 180 PNG rendered from the SVG for platform masking |
| [BrandIcon](../../src/components/branding/brand-icon.tsx) | Shared application rendering; decorative instances use empty alternative text |

Edit the canonical SVG, copy the artwork to the browser icon and regenerate the Apple export when the mark changes. Keep the filled interior opaque; transparency is limited to the outside of the rounded silhouette. The small statically imported SVG uses unoptimized rendering to avoid an image-cache write on read-only deployments.

## Palette and use

| Color | Value | Use |
| --- | --- | --- |
| Forest | `#233e31` | Icon background and dark brand surfaces |
| Sage | `#d9e8a9` | Icon mark and light accents |

These colors reflect the interface and riverbank design intent; no universal psychological effect is claimed. Use actual contrast checks and do not communicate gains, losses or warnings through color alone. Account-type icons express account semantics rather than substituting for the Ufer mark.
