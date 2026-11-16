# Code style and responsibility boundaries

Ufer maintains code, comments, UI copy and examples in English. Readability and explicit ownership take precedence over minimizing lines. These rules apply to new code and code changed as part of a task; preserve unrelated work.

## Structure

| Area | Responsibility |
| --- | --- |
| `src/app` | Next.js pages/layouts and thin HTTP route handlers |
| `src/features/<feature>` | A business feature's types, views, forms, presentation, hooks and server slice |
| `src/features/dashboard` | The dashboard shell, navigation and view routes composed from feature components; nothing outside its routes imports it |
| `src/features/<feature>/server` | Server-only validation/use cases, provider integration, repositories and read projections |
| `src/components` | Shared layout with explicit props and reusable UI, including area placeholders and dialog form submission; no financial persistence |
| `src/client` | Browser HTTP transport, query client and the dashboard's URL state, UI store and session lock |
| `src/server` | Shared infrastructure: database lifecycle, HTTP guards, job coordination and cryptographic primitives |
| `src/lib` | Shared money/date/period/pagination/rule/import utilities; no database queries, authentication protocol or feature workflow collection |

Organize around a reason to change. A component renders one coherent section or form; a hook owns one interaction or data lifecycle; a repository owns persistence; a service coordinates a use case and its domain rules. A page composes these pieces. SOLID does not require an interface, generic base class, factory or dependency-injection container for every function.

Browser components must not import database clients, server modules, provider secrets or authentication internals. Route handlers must not contain SQL or dispatch unrelated paths with an endpoint-name switch. Repositories do not construct HTTP responses. Keep transport validation and data-access authorization explicit. The current shared-password application remains a legacy single-workspace mode, not a tenant-aware implementation.

Feature ownership is independent of execution environment: accounts, banking and categorization have both UI and server code under their feature directory. `src/server` does not contain a second competing feature hierarchy. Import another feature's server API explicitly rather than reaching through a relative path that assumes adjacent feature directories. The browser import restrictions exclude server slices from browser-only rules and protect client code from all `server/` imports. The dashboard is a composition root: its shell and routes import features, while features, shared components, `src/client`, `src/lib` and server modules never import the dashboard; ESLint enforces this. Types belong to the feature whose API returns them, for example `Account` to accounts and `CashFlow` to reports.

Follow Next.js filesystem routing where it serves the framework: a `route.ts` can export several HTTP methods for the same resource. Feature slices own business responsibilities; there is no rule requiring one file per operation. Keep the current endpoint files when they fit Next.js rather than introducing a custom routing framework or consolidating files for its own sake.

The shared Drizzle [schema](../src/server/database/schema.ts) defines typed persistence models; infer select/insert types instead of maintaining parallel handwritten database row interfaces. Services keep input validation and financial rules separate from persistence. API projections remain explicit contracts and must not expose entire database rows or credential fields merely because they are available on a model. Use the initialized [connection](../src/server/database/connection.ts) for typed queries and its `$client` for existing raw SQL; both paths use the same underlying connection.

Repositories own database reads/writes, atomic batches, conflict handling and transaction boundaries. Services coordinate repositories and provider calls without executing queries or constructing SQL statement arrays. Pure normalization and categorization produce data for persistence, not SQL. A shared transaction may be passed through a repository operation so related writes commit or roll back together. Raw SQL is permitted inside focused repositories/read projections and migration infrastructure where it serves a concrete purpose; it is not a parallel persistence architecture in `lib`.

Delegate security protocols to maintained libraries: Better Auth handles credentials, persisted sessions, revocation and rate limiting; jose handles bank application JWT serialization/signing. Small application guards still enforce origin, authorization and rate-limit policies. Node's standard cryptographic primitives remain appropriate for constant-time secret comparison and the existing persisted bank-secret format. See [security boundaries](security.md).

## Compatibility policy

Develop against the current application state. Change internal APIs, component props, types and module structure directly, updating every caller in the same change. Remove obsolete paths when replacing them. Do not retain old signatures, re-export facades, aliases, version switches or fallback behavior solely to accommodate hypothetical earlier application versions. Compatibility with an external consumer requires an explicitly supported contract, not a speculative abstraction.

Persisted data is the compatibility boundary. Schema and stored-format changes require explicit, versioned migrations that preserve existing financial records and identities. A deployment may require a coordinated application update and maintenance step; mixed application versions and zero-downtime upgrades are not assumed requirements. Keep applied changesets immutable without preserving the application code they replaced. See the [migration workflow](database-migrations.md).

## Statements and whitespace

1. Use two-space indentation, double quotes, semicolons and braces for every conditional/loop body. Keep one executable statement per line.
2. Separate validation, loading, decisions, persistence and returned results with blank lines. Keep related declarations together; do not add a blank line after every variable mechanically.
3. Write objects, maps and public data shapes with one complete entry per line. Keep ordinary imports compact and group external, internal and type imports coherently.
4. Keep straightforward calls on one line even when long. Extract complex nested decisions into named values; do not introduce locals solely to satisfy a line-width limit. Multiline declarations start parameters on the next line with consistent indentation.
5. Prefer guard clauses and named predicates to nested conditions or chains of ternaries. Preserve short-circuiting and null handling when extracting conditions.

```ts
const input = valuationInput.parse(payload);
const account = await findManualAccount(accountId);

if (!account) {
  throw new HttpError(404, "Manual account not found.");
}

const amount = minorUnits(input.balance, String(account.currency));

await saveManualValuation(account.id, amount, input.date);

return {
  ok: true,
};
```

Use descriptive names and explicit types at module boundaries. Keep unsafe casts at a justified boundary; never use a cast to claim that a request or tenant identifier was authorized. Comments explain important intent or constraints, not the mechanics of the next line.

## React and styles

Use explicit, typed feature props and small composition roots. Keep network/data lifecycle in hooks and form actions separate from large rendered sections. Do not bury another component declaration inside a render function.

Every modal dialog uses the shared `Dialog` primitive (`components/ui/dialog.tsx`). It is open while mounted: it calls `showModal`, renders the title and close button, closes on Escape and on a press that starts and ends on the backdrop (a text selection dragged out of a field onto the backdrop keeps it open), and returns focus to the previously focused element when it unmounts. It renders into the document body and keeps submit events inside, so a dialog opened from a form or another dialog, such as creating a category from the rule form, neither nests forms nor submits its opener. The feature that owns a dialog exports it, and the component that opens it keeps the open state and passes the dialog's data as props; there is no central dialog registry or dialog state in a store. A dialog closes on navigation and on the session lock because its opener unmounts; an opener that outlives navigation closes it when the pathname changes.

Non-modal popovers, details cards and transient feedback use one dismissal rule: Escape and a press outside dismiss them, an Escape that a control inside already handled (`preventDefault`) or that belongs to an open modal dialog does not, and focus returns to the trigger when it was inside. Use the native `popover` attribute where the content must escape clipping or sit above a dialog, as the searchable select's list does, and the shared `useDismiss` hook otherwise. Popover placement follows the visual viewport (`components/ui/popover-placement.ts`), so an on-screen keyboard does not cover a list.

Own component-specific styles in a colocated `*.module.css`. Genuinely shared button, panel, form and text bases live in `components/ui/primitives.module.css`; import that module directly when no local override is needed. Use `composes` only where local selectors/variants need their own class identity. Do not create empty modifier classes, forwarding-only stylesheets or a separate stylesheet solely because a React component exists. Account presentation (`features/accounts/account-presentation.ts`) belongs to the accounts feature; category controls and transaction-card layout belong to transactions. Global CSS is limited to tokens, resets, typography and genuinely global accessibility behavior. Avoid global feature selectors, bundler-specific CSS aliases, or inline constants that belong in a module. Dynamic chart values, category colors and measured sizes may use inline styles.

Component styles use the semantic color tokens in `src/app/globals.css` instead of literal colors. Each token defines its light and dark value with `light-dark()`, so a component never needs theme-specific selectors; translucent variants derive from a token with `color-mix()`. Category colors stored in data are adjusted for display per theme in `category-colors.ts`, never in the stored value.

Use clsx directly for conditional class lists instead of a local wrapper. Use the canonical Ufer SVG for branding; account-type icons communicate their own meaning and must not reuse an obsolete logo.

Keep expected domain failures distinct from unexpected errors. The shared ValidationError identifies user-correctable input failures without depending on HTTP; use it for submitted amounts, CSV content, valuations and category selection. The HTTP adapter maps it to 422. HttpError is also allowed in application services, repositories and infrastructure when an explicit API outcome is useful, including missing resources, state conflicts, configuration failures and size limits; a strict transport-independent domain layer is not required. Treat rejected provider data as 502, not user validation: translate expected amount-validation errors at the bank-data boundary without including provider values. Keep generic catch messages for unexpected failures; do not expose every Error.message. API failures use [Problem Details](http-errors.md) with a trace ID and sanitized diagnostics, never raw SQL/error payloads. Update all callers when an internal response contract changes; do not retain obsolete error fields.

Dialog actions sit at the bottom of the dialog form. A form with one action ends with a single full-width primary submit button (`button primary full-width`); the dialog's close button and Escape dismiss it, so it needs no Cancel. A confirmation, especially a destructive one, uses the shared `form-actions` row: equal-width buttons spanning the full width, the secondary Cancel first and the primary or destructive action last (right). On narrow screens the row stacks to full-width buttons in the same order, so the primary or destructive action is at the bottom. Do not use the left-aligned `button-group` for dialog actions.

Keep responsive rules with their component. Test meaningful breakpoints and touch-sized forms after moving styles. A visually unchanged refactor must preserve navigation, focus, dialogs and narrow-screen readability.

### CSS toolchain and breakpoints

Stylesheets are plain CSS: CSS Modules plus `src/app/globals.css` for tokens, the reset and global typography. There is no CSS framework. Next.js first runs every stylesheet through the PostCSS plugins in `postcss.config.mjs` and then through Lightning CSS, which handles nesting, `light-dark()`, vendor prefixes and minification. The reset in `globals.css` lives in `@layer reset`, so any unlayered rule overrides it.

Viewport breakpoints are defined once as standard `@custom-media` rules in `src/styles/media.css`. Lightning CSS does not expand `@custom-media` and browsers do not support it yet, so `@csstools/postcss-global-data` makes that file available to every stylesheet and `postcss-custom-media` replaces each name with its query; the build fails on an unknown name. `media.css` is never imported. Write `@media (--mobile)` instead of a literal width, and add a name to `media.css` rather than a one-off value:

| Name | Query | Layout |
| --- | --- | --- |
| `--mobile` | `(width <= 760px), (width <= 900px) and (pointer: coarse)` | Phone layout with bottom navigation, full-width dialogs and touch-sized controls |
| `--tablet` | `width <= 900px` | Icon-only sidebar |
| `--laptop` | `width <= 1250px` | Narrower sidebar and stacked overview columns |
| `--desktop` | `width > 1250px` | Everything wider than `--laptop` |
| `--wide` | `width >= 1600px` | Larger header, charts and dashboard columns |

Max-width names include every narrower viewport, so `--tablet` also matches phones; declare broader rules first and `--mobile` last. Capability queries such as `prefers-reduced-motion` or `hover: none` stay literal. Use a container query (`container-type: inline-size` with `@container`) when a component's layout depends on the space its parent gives it rather than on the viewport, as the account type options in the create-account dialog do.

## Commit and merge workflow

Squash-merge pull requests by default; use another merge method only when explicitly requested. Direct commits, including commits on main, are allowed for small, cohesive packages with explicit approval. Present the concrete scope before committing and keep unrelated work separate. Implementation approval is not commit approval; approval of one commit does not authorize later commits. Remote publication needs its own authorization unless it was explicitly included in the same package approval.

## Checks

| Command | Purpose |
| --- | --- |
| `npm run lint` | Enforces braces, statement separation, indentation, object layout, JSX formatting and key import boundaries |
| `npm run lint:fix` | Applies safe automatic style fixes; review the result |
| `npm run check:styles` / `npm run format:styles` | Checks/formats CSS without rewrapping TypeScript calls |
| `npm run check` | Type checking |
| `npm test` / `npm run build` | Consequential behavior checks and production compilation |

The linter is not proof of architecture or authorization. Review responsibilities and dependency direction as well as automated output. Add tests for consequential edge cases and regressions, not trivial rendering or delegation. Keep test fixtures synthetic. Preserve failed-run logs when investigating a regression.

## Next.js generated instructions

Next.js writes the managed “This is NOT the Next.js you know” block in `AGENTS.md`. It instructs coding agents to consult documentation bundled with the installed framework version instead of relying on stale model knowledge. It is not a requirement to use a catch-all API, a particular data model or unusual application architecture. Preserve the managed block; keep Ufer's own rules below it.

## Typography

Font sizes use the rem-based scale in `src/app/globals.css` (`--text-xs` 12px, `--text-sm` 14px, `--text-md` 16px, `--text-lg` 18px, `--text-xl` 20px, `--text-2xl` 24px, `--text-3xl` 32px, `--text-4xl` 44px at the default browser size). Components use these tokens instead of pixel values so browser text-size settings and zoom apply everywhere. Use `--text-md` for primary content and touch-sized controls, `--text-sm` for desktop controls, labels, table cells and headers, and secondary text, and `--text-xs` only for badges, eyebrows, chart ticks and the bottom-navigation labels. Do not set text below `--text-xs`.

## Design tokens

`src/app/globals.css` defines every scale next to the color and type tokens. Components use the tokens instead of literal values; a new value belongs in the scale, not in a module.

| Scale | Tokens | Use |
| --- | --- | --- |
| Spacing | `--space-1` 4px, `-2` 8px, `-3` 12px, `-4` 16px, `-6` 24px, `-8` 32px | Every padding, margin and gap |
| Radius | `--radius-sm` 4px, `-md` 8px, `-lg` 12px, `-full` | Chips, badges, markers, bars and options inside a list; buttons, inputs, selects and popovers; panels, cards and dialogs; pill-shaped tracks and counters |
| Shadow | `--shadow-sm`, `--shadow-lg` | Resting and hovered surfaces such as panels, cards and primary buttons; floating layers such as popovers, toasts and dialogs |
| Layer | `--layer-base` 0, `-raised` 1, `-sticky` 10, `-navigation` 20, `-popover` 30, `-dialog` 40, `-toast` 50 | `z-index` |
| Motion | `--duration` 150ms | Every transition |
| Focus | `--focus-ring` (3px solid outline in the focus color) | Every visible focus outline, applied with `outline-offset: 2px` |
| Layout | `--bottom-nav-height` 72px | The phone bottom navigation and everything that must clear it |

- **Spacing** uses only these six steps. A value between two steps takes the one that keeps the layout closest; page gutters and other spacing above 32px use `--space-8`. Controls keep their height through `min-height` instead of uneven padding. Values below `--space-1` (1–3px) stay literal only as optical adjustments inside small components, such as badge padding, hairline gaps between segments and the toggle track. Element sizes, layout widths and positioning offsets are not spacing.
- **Shadows** describe elevation. A `box-shadow` that draws a ring or hairline, such as an inset selection border or a badge outline, keeps its literal value, as does the bottom navigation's upward shadow.
- **Layers** apply within the stacking context that contains them. Modal `<dialog>` elements and `popover` elements use the browser's top layer and need no `z-index`; `--layer-dialog` is for non-modal overlays that must cover popovers. A decoration behind its component's content uses `--layer-base` and lifts the content with `--layer-raised` instead of a negative `z-index`.
- **Motion:** `--duration` covers transitions. Looping animation periods such as the spinner belong to their keyframes. `prefers-reduced-motion` disables both globally.
- **Focus** uses the global `:focus-visible` outline for buttons, links and form controls; a component that hides its native control draws the same outline on its visible container with `:has(:focus-visible)`.
- **Bottom navigation** offsets are calculated where they are used from the height, the bottom safe-area inset and a spacing step, for example `calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + var(--space-6))`.
- The global `input` rule styles text-like fields only; checkboxes, radios, color and file inputs keep their native box without local resets.
- Fix specificity instead of using `!important`; the reduced-motion rule is the only exception.
