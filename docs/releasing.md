# Releasing

Ufer uses [Semantic Versioning](https://semver.org/). The version in `package.json` is the release version; [CHANGELOG.md](../CHANGELOG.md) records what each release contains. Production is deployed only from published releases, not from every merge to `main`.

## Deployment model

- Pull requests get Vercel preview deployments against the shared preview database.
- `main` collects merged work; pushes to it build nothing.
- The `release` branch is Vercel's production branch. Only the [release workflow](../.github/workflows/release.yml) moves it, fast-forward only, to the commit of a published release.

## Publishing a release

1. On `main`, set the new version in `package.json` (`npm version <version> --no-git-tag-version`), move the changes into a dated section of `CHANGELOG.md`, and merge that change.
2. Draft a GitHub release with the tag `v<version>`, targeting that commit on `main`, with the changelog section as release notes.
3. Database migrations required by the release are applied to production first, following the [migration workflow](database-migrations.md); a release never migrates on its own.
4. Publish the release. The workflow checks that the tag matches `package.json`, that the commit is on `main` and newer than the deployed release, runs the full checks and moves `release` to the commit. Vercel then deploys it to production.
5. Verify production (sign-in, banking status, a sync) and the next scheduled sync.

Pre-releases do not deploy. To roll back, use Vercel's instant rollback to the previous production deployment, then fix forward with a new release; the workflow refuses to move `release` backwards.
