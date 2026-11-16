# Releasing

Ufer uses [Semantic Versioning](https://semver.org/). The version in `package.json` is the release version, and release tags carry the plain version without a prefix (for example `0.1.0`). [CHANGELOG.md](../CHANGELOG.md) records what each release contains.

## Deployment model

| Trigger | Deployment | Environment and database |
| --- | --- | --- |
| Pull request | Vercel Git integration, per-PR preview URL | Preview |
| Push to `main` | [Staging workflow](../.github/workflows/staging.yml): Vercel CLI preview build, aliased to `ufer-staging.vercel.app` | Preview |
| Version tag on a `main` commit | [Release workflow](../.github/workflows/release.yml): Vercel CLI production build | Production |

Vercel's Git integration does not deploy `main` (`git.deploymentEnabled` in `vercel.json`), and the ignore command skips pushes to other branches without a pull request. Production and staging deployments therefore come only from the workflows. They authenticate with the repository secret `VERCEL_TOKEN` and the repository variables `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.

Staging and pull-request previews share the preview database with its synthetic demo data and sandbox bank connection. The staging deployment sets `APP_URL` to its alias, so sign-in and writes work through `ufer-staging.vercel.app`.

## Publishing a release

1. On `main`, set the new version in `package.json` (`npm version <version> --no-git-tag-version`), move the changes into a dated section of `CHANGELOG.md`, and merge that change. Check it on staging.
2. Apply database migrations required by the release to production first, following the [migration workflow](database-migrations.md); a release never migrates on its own.
3. Create the tag on that `main` commit, either by publishing a GitHub release with tag `<version>` and the changelog section as notes, or with `git tag <version> <commit>` and `git push origin refs/tags/<version>`.
4. The release workflow checks that the tag equals the `package.json` version and points to a commit on `main`, runs the full checks and deploys that commit to production.
5. Verify production (sign-in, banking status, a sync) and the next scheduled sync.

To roll back, use Vercel's instant rollback to the previous production deployment, then fix forward with a new release.
