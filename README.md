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
- [Banking and imports](docs/banking-and-imports.md) — connection behavior, data handling and import formats.
- [Architecture](docs/architecture.md) — technical structure and decisions for contributors.

This project is currently private. An open-source license has not been selected. Repository documentation and code are maintained in English.
