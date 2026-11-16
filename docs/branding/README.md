# Ufer identity

![Ufer icon](../../src/components/branding/ufer-icon.svg)

The U-shaped riverbanks, winding channel and two ripples connect Ufer's shoreline meaning with banking. The forest-green background and pale-sage mark keep the identity consistent with the application.

## Third-party artwork

List any artwork from third parties here with its source and license.

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

## Illustrations

[Illustrations](../../src/components/branding/illustrations.tsx) extend the icon's shoreline into small scenes: two rounded banks, a U-shaped body of water, rounded ripples and an optional pale sun. They make first-run and empty views feel calmer; they never carry information.

| Illustration | Where | Purpose |
| --- | --- | --- |
| `ShoreIllustration` | Default for `Empty` states | A quiet cove marks a view that will fill once data exists |
| `BridgeIllustration` | First bank connection | A footbridge between two banks reflects connecting a bank |
| `ShorelineBackdrop` | Login page background | A low shoreline grounds the page without moving the form |

- Use them only for empty, first-run and sign-in surfaces, and at most one per screen. Pass `illustration={null}` to `Empty` when another illustration is already visible.
- Hand-author inline SVG with filled paths and rounded strokes only: no embedded raster, text, external assets, gradients or filters. Keep each scene to a few paths and under roughly 1 KB of markup.
- Take colors from the CSS module tokens (`--illustration-land`, `--illustration-water`, `--illustration-sun` and related); lines use `currentColor`. The tokens derive from the brand sage and the global `--surface`, `--green` and `--gold`, so a future theme only redefines those values.
- Mark every illustration decorative (`aria-hidden`, not focusable); the adjacent heading and text carry the meaning.
- Keep empty-state scenes small (128 px wide, 112 px on narrow screens) so primary actions stay above the fold on mobile. Full-page backdrops stay out of the layout flow and behind opaque content.
