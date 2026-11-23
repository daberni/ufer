# Localization

Ufer's interface is available in English and German. Code, comments, documentation, API Problem Details, logs and synthetic examples stay English.

## Choosing the language

The language is a per-browser preference, like the theme and the number format; it is not stored in the database.

- Without a choice, the first `Accept-Language` entry with a catalog decides (`de-AT` selects German); otherwise English applies.
- The account dialog offers *Browser default*, *English* and *Deutsch*. An explicit choice is kept in the `language` cookie for a year; *Browser default* deletes it. Changing it reloads the page so the server renders everything again.
- There are no locale path prefixes. [`src/i18n/request.ts`](../src/i18n/request.ts) resolves the language per request for [next-intl](https://next-intl.dev), and the root layout passes the catalog to client components and sets `<html lang>`.

## Number and date format

Amounts, numbers and dates keep their own [format preference](../src/lib/locale.ts) (`locale` cookie). Its *Browser default* follows `Accept-Language`; once a language is chosen explicitly, it only considers requested locales in that language and otherwise formats in the language itself, so a German interface never shows English dates. Currencies always stay per account.

## Catalogs

- Messages live in [`src/messages/<language>/<namespace>.json`](../src/messages), one namespace per feature or area, composed in each language's `index.ts`. English is the reference: the German catalog must provide every English key, which `npm run check` enforces through the `Messages` type.
- Messages use ICU syntax. Counts are ICU plurals (`{count, plural, one {# rule} other {# rules}}`) rather than concatenated nouns, because languages inflect differently; numbers inside messages use the format locale when it is in the interface language.
- Components read messages with `useTranslations(namespace)`; server code and metadata use `getTranslations`. Formatting helpers in `src/lib` still take the format locale explicitly.
- Shared components that compose sentences around a noun take a fixed noun key instead of free text, so each language writes the whole sentence (see `SearchableSelectNoun`).
- Behavior tests render components through [`tests/fixtures/intl.ts`](../tests/fixtures/intl.ts), which provides the English catalog.

## What stays English

API Problem Details (`title`, `detail`), log messages and job output stay English; the browser shows a server's `detail` unchanged. Stored user data, such as category and account names, is never translated.
