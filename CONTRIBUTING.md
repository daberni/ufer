# Contributing to Ufer

Thank you for helping improve Ufer. Contributions are accepted only from contributors who have signed the [contributor license agreement](CLA.md).

## Before you start

- For larger changes or new features, open an [issue](https://github.com/daberni/ufer/issues) first so the approach can be agreed before you write code. Small fixes can go directly to a pull request.
- Read the [project conventions](AGENTS.md), the [code style](docs/code-style.md) and the [architecture](docs/architecture.md). Schema changes follow the [database migration workflow](docs/database-migrations.md).
- Write code, comments, documentation and UI copy in English.
- Never include real financial data, credentials, bank application IDs, personal account details or host-specific paths. Use synthetic examples.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Set up the project as described in [setup](docs/setup.md): Node.js 26 (`nvm use`), then `npm ci`.
3. Add focused behavior tests for non-trivial logic and update the documentation your change affects, including the [feature comparison](docs/feature-comparison.md) when a capability changes.
4. Run all checks; they must pass, as they do in CI:

   ```sh
   npm run lint
   npm run check:styles
   npm run check
   npm test
   npm run build
   ```

5. Open a pull request against `main` that explains what changed, why, and how you verified it. Pull requests are squash-merged.

## Contributor license agreement

Every commit author in a pull request must accept the [contributor license agreement](CLA.md). On your first pull request, a CLA check comments with instructions; reply with the exact sentence it asks for. The check passes once all authors have signed, and your acceptance covers later pull requests too. The check identifies authors by the GitHub account linked to each commit's email address, so commit with an email address that belongs to your GitHub account.

You keep the copyright in your contributions. Ufer is published under [AGPL-3.0-or-later](LICENSE); the agreement additionally allows the maintainer to use contributions in a hosted offering and to license them under other terms, including commercial ones.

## Security issues

Do not report security vulnerabilities in public issues, pull requests or discussions. A private reporting channel has not been set up yet (TODO: OSS-04).
