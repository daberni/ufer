<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project conventions

- Maintain documentation, code, comments, and synthetic examples in English. User-facing UI copy lives in the English and German message catalogs under `src/messages`; see [localization](docs/localization.md).
- Keep personal account inventories, real financial data, credentials, application IDs, and host-specific paths out of repository content and history.
- Update the feature comparison when capabilities or their verification status change. Keep implemented behavior distinct from planned requirements.
- Preserve existing data, database paths, volume names, and persistence identifiers during branding and copy changes. Schema upgrades require explicit migrations and authorization.
- The current database driver supports SQLite/libSQL. Do not claim PostgreSQL or multi-tenant SaaS support without implementing and verifying it.

## Code and architecture conventions

- Develop against the current application state. Internal APIs, component props and module structure may change together; update all callers in the same change instead of retaining old signatures, aliases, compatibility facades or fallback branches for hypothetical earlier versions. Add compatibility only for an explicitly supported external contract.
- Persisted data is the compatibility boundary: evolve schemas and stored formats through explicit, versioned migrations that preserve existing data. Migration requirements do not justify keeping obsolete application code or supporting mixed application versions by default.
- Follow [docs/code-style.md](docs/code-style.md): braces, one statement per line, meaningful whitespace, explicit objects and responsibility boundaries. Run lint, type checks, behavior tests, stylesheet checks and the production build for relevant changes.
- Keep Next.js API route handlers thin and follow idiomatic Next.js filesystem routing. Organize business logic by feature; do not enforce one file per operation or consolidate routes solely to reduce file count. The current catch-all route is only a JSON-404 fallback.
- API errors use RFC 9457 Problem Details with a trace ID; see [HTTP errors](docs/http-errors.md). Use the shared ValidationError for user-correctable domain input and keep unexpected exceptions private. Update clients with the current contract instead of retaining obsolete response fields.
- HttpError may also express explicit API outcomes in services, repositories and infrastructure; a separate transport-independent exception hierarchy is not required. Keep user-input validation (422) distinct from rejected provider data (502), and translate shared validation at the provider boundary.
- Use the shared Drizzle schema and inferred models for typed persistence. Reuse the initialized Drizzle instance and its underlying libSQL client; do not create a second application connection for raw SQL. Keep schema definitions and reviewed SQL changesets aligned.
- Services coordinate validation and use cases; repositories own database reads/writes and transaction boundaries. Keep provider normalization and categorization separate from persistence. Do not generate SQL statement arrays in general utilities or execute database queries from services. Raw SQL belongs in a focused repository/read projection or migration infrastructure when it serves a concrete purpose.
- Repositories persist and query; domain decisions live in pure feature functions called from services inside the repository-provided transaction. Set-based SQL predicates belong in named rule modules, not inline in repositories.
- Keep business features together under `src/features/<feature>/`, with server-only services/repositories in that feature's `server/` directory. Reserve `src/server/` for shared database, HTTP, job and security infrastructure. Browser modules must never import a feature's `server/` modules.
- Use maintained libraries for security protocols: Better Auth owns individual credentials, browser sessions and authentication rate limits and jose owns provider JWT signing. Do not implement custom session seals, expiry handling or JWT serialization. Persisted bank-secret formats may only change through an explicit data migration.
- The canonical application icon is a real SVG made of vector paths; derive required raster platform exports from it instead of embedding raster images inside SVG.
- Use feature components and focused hooks with colocated CSS Modules for styles they own. Import shared primitive styles directly when no local override is needed; use composition for actual local variants. Keep account/transaction styles in their features and avoid empty modifiers or forwarding-only stylesheets. Use clsx directly for conditional classes.
- Use checked-in SQL changesets and the documented [migration workflow](docs/database-migrations.md). Never edit applied changesets or automatically upgrade an existing database at web startup. Existing-schema/data migrations need explicit authorization.
- [Architecture](docs/architecture.md) and [YAML-frontmatter decisions](docs/adr/README.md) distinguish implemented behavior from proposed workspace/identity/SSO models. The application remains single-workspace until scoped authentication, persistence, jobs and cross-workspace checks are implemented.

## Coding standards

These rules add to [docs/code-style.md](docs/code-style.md) and [HTTP errors](docs/http-errors.md).

- Every API route runs through `respond()` with an explicit access mode; a route outside it (such as a redirecting callback) calls `requireAuth` itself and documents why. Exceptions: the Better Auth handler (`/api/auth`), which must accept unauthenticated sign-in, and the JSON-404 fallback.
- Money is integer minor units parsed through the shared money helpers; no floating-point arithmetic on amounts and no sums across currencies.
- Calendar dates are validated `YYYY-MM-DD` strings; "today" comes from `src/lib/time.ts`, periods from `src/lib/period.ts` and SQL date boundaries from `src/features/transactions/server/period-condition.ts`, never `new Date()` in server logic.
- A write that depends on read state (split sums, writable account, link eligibility) performs that read inside the same transaction.
- Each database serves exactly one banking environment (`ENABLE_BANKING_ENVIRONMENT`); financial rows carry no per-row environment, and switching the environment requires a separate database.
- Provider data is upserted by account and provider reference; user intent (manual category or type, overrides, hidden state, splits, links) lives in separate fields a sync never overwrites.
- Jobs that mutate shared financial state hold the named job lease; conflicting user operations acquire the same lease.
- Every cash-flow figure derives from the single counted-lines definition; extend it instead of writing a parallel query.
- Provider secrets and bank sessions are stored only through the secret box and one-time values only as hashes; secrets never appear in API projections, logs or Problem Details.
- New browser features or external origins update the CSP and Permissions-Policy in `next.config.ts` in the same change.
- Prefer Drizzle `sql` fragments; string-built SQL may interpolate only compile-time constants.
- Risky domain logic (money parsing, split and transfer invariants, sync idempotency, authentication and callback binding) has behavior tests against a real SQLite database.
- Keep modules focused: split large components into sections and hooks and large modules by responsibility instead of growing single files.

## Task intake and backlog

- GitHub Issues are the product backlog; use issues and pull requests without adding a GitHub Project unless the user requests one.
- Capture new feature requests in a matching existing issue or create a focused issue after checking for duplicates. Do not start implementing every new idea immediately. Implement directly when it belongs to the current issue or the user explicitly prioritizes it as current work.
- Issue descriptions contain the problem, desired behavior, useful context and acceptance criteria. Keep analysis brief; do not prescribe technical solutions unless requested. Maintain English repository content and exclude private financial details.
- Treat feedback about the current implementation as steering for that work. Keep unrelated requests in the backlog and preserve the original task when answering a question or status request.
- Keep implementation, local verification, publication and deployment distinct. Track deferred behavior as deferred rather than implying it is implemented.

## Agent coordination

- Implement each independently scoped issue in its own fresh linked session (not a subagent) with its own worktree, so the coordinating session stays focused. Give it a clear scope, owned files, dependencies, expected checks and the authorization limits; send related follow-up feedback to that session and expect its reports back in the coordinating session. Short read-only analyses and reviews may still use subagents.
- The coordinating agent owns architecture, shared contracts, integration and the final user-facing status. An issue session finishing does not by itself mean the change is committed, published or ready for review.
- Continue active issue and PR work through implementation, verification, publication and stack follow-up. Track delegated work through handoff and act on its result. Proactively select the next actionable task from the existing Ufer backlog and PR stack based on priority, dependencies and user feedback. Start it within the authorized scope and delegate concrete issue work to its issue session. When a task is blocked, pick independent work instead of waiting for a new assignment. If user input is required, say exactly what is blocked and what decision or action is needed, and continue independent work.
- Run as many independently scoped issue agents as the host allows and the work justifies. Match model and reasoning effort to task complexity where supported. Check for concurrent work by other sessions before assigning a ticket or reusing a branch.
- Have each issue agent drive its task through verification and opening or updating its reviewable PR within its authorization. The coordinator checks the published result and keeps independent tickets moving while PRs wait for review. Stack only changes with a real dependency.
- When conflicting priorities materially change what should ship next, identify the tradeoff and ask for that decision while unrelated work continues.
- Reuse suitable worktrees and keep feature implementation out of the main checkout. Create new worktrees outside the project through the host's managed worktree tool when one is available.
- After a PR is merged, clean up locally: stop its demo servers, remove its worktree and local branch once they hold no unpublished work, and delete its throwaway demo databases and credential files. Keep production backups and anything still used by open PRs.
- Do not have agents edit the same files concurrently. Sharing a worktree requires explicit file ownership and coordination before changing a shared contract or staging another agent's work.
- Parallelize independent work, but bound test concurrency and serialize expensive checks when the host is under load. Keep recoverable logs and persistent sessions; do not start duplicate runs or change a checkout's sources while its verification is running.

## Git workflow and authorization

- Keep commits and PRs focused on coherent issue-sized packages. Describe the concrete package before committing and reference its GitHub issue when one exists; use closing keywords only when the whole issue is resolved.
- Squash merges set their message explicitly (`gh pr merge --squash --subject … --body …`): the subject is the PR title with its number; the body states what the commit changes in two to five short lines (behavior, migrations, closed issues), without branch history, review rounds or check results, and ends with one deduplicated block of `Co-Authored-By` trailers.
- Routine commits, explicit feature-branch pushes and PR updates within the approved scope have standing authorization. Do not repeatedly ask for approval for those actions. This does not authorize unrelated features, remote changes to the default branch, production deployment, new cloud resources, destructive actions or execution of database migrations. The staging workflow deploys every merge to main and migrates the staging (shared preview) database without another approval round.
- Direct local commits on main require an explicit user instruction. Documentation-only changes (no code, configuration or migrations) are the standing exception: commit them locally on main without a PR, and Bernhard pushes main himself. Never infer permission to publish main or merge into it from approval of a PR update or a local main commit. For Ufer, Bernhard’s `approved` label authorizes a squash merge into remote main and its normal deployment. This narrow exception overrides the general ban on remote default-branch changes only for that merge. It does not authorize direct pushes or production database migrations.
- Never merge a PR while a Codex review of its current head is running or has not yet reported, even with the `approved` label; merge only after Codex has completed on the exact head SHA and every thread is resolved. Re-check this immediately before each merge attempt.
- Use the chat heartbeat as a short wake-up between active turns. Check delegated handoffs and PR changes, continue actionable work, and stay quiet when nothing changed. Send brief progress updates during active work, focused on results and blockers.
- On every turn, PR event and heartbeat, first read the labels of all open PRs (`gh pr list -R daberni/ufer --label approved`) before other PR work; an `approved` label must never wait for the user to mention it.
- The PR watcher checks `approved` labels, current head and base, required CI, unresolved threads and rollout prerequisites. Merge approved stacks from the bottom up. After each merge, retarget and reverify the next PR before merging. Report blockers and read back successful merges. Preserve published history while integrating stacks; do not force-push or rewrite published commits without separate explicit permission.
- Preserve pre-existing staged and unstaged work. Never stash, reset, discard or commit another task's changes as a shortcut. Stage only the intended package and verify the staged diff, including conflict resolutions, before committing.
- Every push names both source and destination: `git push origin <branch>:refs/heads/<branch>`. Prefer an atomic push for a coordinated stack update. Verify each resulting remote SHA and the PR's base, head and remaining feature diff after publication. Only local main may track origin/main.
- Before remote writes, confirm the authenticated account and exact repository. Use this project's GitHub workflow rather than unrelated organization-specific issue, branch or commit conventions.

## PR feedback and review readiness

- Read the current PR description and its task checkboxes, base/head, checks, general comments, review summaries and inline threads before working on feedback or declaring a PR ready. Include feedback from automated reviewers, not just comments by the user.
- Attach every PR created or actively reviewed, updated or continued to the owning session. Verify the attachment at handoff. Leave PRs used only as references or dependencies unattached.
- During active PR work, monitor new comments, reviews, head/base changes and checks. Re-read the latest state before publication and review handoff; do not rely on an earlier green check or an old preview URL.
- The user's clear feedback is an instruction within its scope. Validate other review findings against the code before changing it. Clear correctness fixes within the authorized scope do not need another approval round; uncertain code or design choices need a focused question or an explicit open checkbox in the PR.
- Reproduce consequential defects and add behavior-focused regression coverage. Demonstrate failure on the original defect and success with the fix when adding regression tests. Do not add tests for styling alone, trivial rendering, delegation or logging.
- For this Ufer repository, replies to PR review comments are authorized without another wording-approval round and without an AI marker or signature. Add factual context where it explains a decision, the owning PR, verification or a deliberate limitation; avoid redundant acknowledgments. This project-specific permission overrides the general conversational-message approval rule for Ufer PR feedback only.
- Resolve a review thread once its requested change is implemented, verified and published, or its question has been answered. Read the current code and thread before resolving; an outdated diff alone does not prove a finding is fixed. Leave unaddressed bugs and undecided behavior open. Read back reply contents and resolved state after publication.
- A PR is ready for user review only when its current head has no unresolved review threads, required checks pass and any needed local verification is done. Keep active unfinished work in draft rather than using obsolete open threads as a progress marker. Do not imply that resolved threads alone replace verification.
- Keep automation commands exactly as requested. Reply authorization does not grant permission for unrelated messages, destructive changes, migrations, production operations or remote changes to the default branch.
- Describe the final implementation for reviewers, including relevant checks, material limitations and remaining decisions as checkboxes. Keep issue links, titles and descriptions aligned when scope changes.
- Declare review readiness only for the current published head. Distinguish CI from automated code review, pending checks from failures, and environmental failures from code defects. Verify UI changes at desktop and phone widths, with pointer, keyboard and touch behavior where relevant, before offering the preview for visual review.
- A working local demo supports UI review before merge; staging shows main after each merge. Identify which version a demo shows and use isolated synthetic data. Do not describe an older immutable deployment as showing newer code.

## Migrations, environments and deployment

- PR approval and routine PR-update authorization do not authorize applying a migration to an existing database. Preparation, review, backup and execution are separate steps; execution needs explicit authorization for that database and effect.
- For production, approving the `production-migration` gate of a release run is the explicit authorization for exactly the changesets listed in that run's summary; it does not cover other databases, re-runs with a different pending list or manual migrations. The staging database holds synthetic data and is migrated automatically by the staging workflow.
- Never edit an applied changeset, including its comments or recorded migration identity. Unapplied changesets may be revised or reordered only after checking their application status and keeping the journal, metadata and dependent branches consistent.
- Preserve user customizations and provenance when retiring seeded data. A fixed seed ID alone is not proof that a category, rule or assignment is still disposable system data.
- Pull requests get no hosted previews. Verify UI changes locally with synthetic data before merge; after merge, staging (the staging alias on the shared preview database) shows main. Verify the staging run, its commit and the alias after merges that need hosted verification.
- Verify application behavior locally with representative synthetic data, including desktop and mobile checks when relevant. Routine staging verification checks build readiness and provenance without fetching login credentials from the password manager. Changes that depend on the hosted environment, such as its secrets, database or migrations, also need an authenticated smoke test on staging after merge, and on production after the release.
- For a production migration that makes the previous app incompatible, prepare the exact compatible production build before touching the database. Verify a restorable backup and rehearse on its copy, coordinate the cutover, then verify the live domain with an authenticated smoke test. The [release workflow](docs/releasing.md) performs these steps for tagged releases; the authenticated smoke test remains a manual check. Recovery must account for both the application and database versions.
- Staging uses the shared preview database and applies changesets from main automatically. Stack schema-dependent PRs on the schema-owning branch and propagate changes through their children; never bypass migration verification to make staging load.
- A merged changeset reaches the staging database automatically and production only through the release gate. Existing immutable deployment URLs retain their old code and environment. Do not create replacement cloud resources or alter production as an implicit workaround.
- Keep local, preview and production data and credentials separate. Use synthetic fixtures and demos for verification; real bank authorizations, financial syncs, hosted data changes and production operations require matching authorization.
- Retrieve production secrets through the approved password manager. Never print or commit secrets or store them in project files. Keep any necessary temporary secret file outside the repository with restricted permissions and remove it promptly.
