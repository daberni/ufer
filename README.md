# Ufer

**All your finances. One clear view.**

Ufer brings your accounts, spending and assets into one clear overview. See where your money is, understand your monthly cash flow and keep track of finances across banks.

Designed for everyday use on desktop and smartphone, Ufer aims to make managing money feel simple and approachable.

## A clearer picture of your money

- **See the whole picture.** View account balances and net worth, with cash and investments shown separately.
- **Understand each month.** See income, expenses and spending by category for your selected month.
- **Find any transaction.** Search and filter transactions across your accounts in one place.
- **Keep spending organized.** Categorize transactions with your own rules and correct categories when needed.
- **Include more than bank accounts.** Track other assets with manual valuations and import history into manual accounts using CSV files.

## Connect your banks

Bank connections are central to Ufer: authorize access, bring balances and transactions together, and keep them updated through scheduled synchronization. Ufer currently integrates with Enable Banking and uses read-only account access; it does not initiate payments.

**Ufer is in early development.** The connection and synchronization flow has been tested with sandbox accounts. Live-bank compatibility still needs verification and depends on the bank and provider access available to your installation.

## Run it yourself

Ufer can be self-hosted on your own server or NAS using Docker, including a daily synchronization scheduler. You operate the application and choose where its financial data is stored. Bank synchronization still requires a compatible provider account and configuration.

The current version supports individual users within one shared financial workspace. A managed service for independent customers is planned; it is not available yet.

See [setup and self-hosting](docs/setup.md) for installation instructions, or the [Vercel deployment guide](docs/vercel-deployment.md) for that hosting option.

## Explore the project

- [Feature comparison](docs/feature-comparison.md) — current capabilities and development priorities.
- [Product direction](docs/product-direction.md) — the experience Ufer is working toward.
- [Backlog](https://github.com/daberni/ufer/issues) — reported problems and requested improvements.
- [Banking](docs/banking.md) — connection behavior and data handling.
- [CSV import](docs/csv-import.md) — importing transaction history and balances.
- [Architecture](docs/architecture.md) — technical structure and decisions for contributors.
- [Changelog](CHANGELOG.md) — released and upcoming changes.
- [Branding](docs/branding/README.md) — name, icon and visual identity.
- [Contributing](CONTRIBUTING.md) — how to propose changes and the checks to run.

Repository documentation and code are maintained in English.

## License

Ufer is free software under the [GNU Affero General Public License, version 3 or later](LICENSE) (`AGPL-3.0-or-later`). Anyone may run, modify and host it; if you run a modified version for other users over a network, you must offer those users its source code. The sign-in screen and dashboard footer link to the source through `sourceCodeUrl` in [`source-code-notice.tsx`](src/features/legal/components/source-code-notice.tsx); a modified deployment must change that constant to point at its own source (AGPL-3.0 section 13).

Contributions are accepted only from contributors who have signed the [contributor license agreement](CLA.md); see [contributing](CONTRIBUTING.md).

The license grants no rights to the name "Ufer" or the Ufer icon as trademarks.
