---
title: "Keep in-house UI components on native browser primitives"
adr:
  id: "011"
  status: accepted
  date: 2026-11-22
  authors:
    - Ufer maintainers
---

# Keep in-house UI components on native browser primitives

## Context

Ufer builds its dialogs, popovers, comboboxes, pickers and tooltips itself with CSS Modules. [#244](https://github.com/daberni/ufer/issues/244) asked whether mature headless libraries (Radix, Base UI, React Aria, Ariakit, Downshift, Floating UI) should replace them. A code review found that the components already use native browser primitives: `<dialog>.showModal()` for modal focus handling, the Popover API for the top layer and the ARIA combobox pattern with `aria-activedescendant`. The gaps were inconsistencies between components rather than missing architecture.

## Decision

| Concern | Decision |
| --- | --- |
| Library | Keep the in-house components; adopt no component library for now |
| Foundation | Dialogs use native `<dialog>`, popups the Popover API through the shared anchored popover, comboboxes one shared keyboard hook (`useComboboxOptions`) |
| Tooltips | One shared, non-interactive tooltip with keyboard and touch access replaces important `title` attributes |
| Reconsideration | Re-evaluate Base UI or Downshift only if the shared combobox hook outgrows its maintenance value; switch all comboboxes together and record a new decision |

## Consequences

- No dependency or styling migration; components keep CSS Modules and native top-layer behavior.
- Ufer owns accessibility and edge cases of its components; the hardening in [#268](https://github.com/daberni/ufer/pull/268) closed the gaps found in the review, and further cases are fixed in the shared primitives.

## Compliance

New popups, comboboxes and tooltips use the shared primitives in `src/components/ui` instead of local copies.

## Notes

Decided after the review in #244; implemented in #268 (merged 2026-11-21).
