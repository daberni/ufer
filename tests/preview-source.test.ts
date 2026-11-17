import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(".github/scripts/prepare-preview-source.sh");

function repository(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ufer-preview-source-"));
  const output = join(directory, "actions-output");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Preview test",
    GIT_AUTHOR_EMAIL: "preview@example.invalid",
    GIT_COMMITTER_NAME: "Preview test",
    GIT_COMMITTER_EMAIL: "preview@example.invalid"
  };

  context.after(() => rmSync(directory, {
    recursive: true,
    force: true
  }));

  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: directory,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const write = (path: string, text: string) => writeFileSync(join(directory, path), text);

  function commit(message: string) {
    git("add", ".");
    git("commit", "-qm", message);

    return git("rev-parse", "HEAD");
  }

  function prepare(head: string, base: string) {
    const result = spawnSync("bash", [script], {
      cwd: directory,
      env: {
        ...env,
        HEAD_SHA: head,
        BASE_SHA: base,
        GITHUB_OUTPUT: output
      },
      encoding: "utf8"
    });
    const recorded = existsSync(output) ? readFileSync(output, "utf8") : "";
    const values = Object.fromEntries(recorded.trim().split("\n").filter(Boolean).map(line => line.split("=")));

    return {
      ...result,
      recorded,
      values
    };
  }

  git("init", "-q", "--initial-branch=main");
  write("schema.sql", "CREATE TABLE examples (id TEXT PRIMARY KEY);\n");
  const initial = commit("Initial schema");

  return {
    directory,
    git,
    write,
    commit,
    prepare,
    initial
  };
}

test("preview preparation keeps the exact head when its base is included, even after the former foundation ref was deleted", context => {
  const repo = repository(context);

  repo.git("update-ref", "refs/remotes/origin/issue-138-manual-transactions", repo.initial);
  repo.git("update-ref", "-d", "refs/remotes/origin/issue-138-manual-transactions");
  repo.git("switch", "-qc", "feature");
  repo.write("feature.txt", "A reviewed feature\n");
  const head = repo.commit("Add feature");
  const result = repo.prepare(head, repo.initial);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(repo.git("rev-parse", "HEAD"), head);
  assert.equal(result.values.build, head);
});

test("an integration preview includes its recorded base and preserves the feature with distinct build provenance", context => {
  const repo = repository(context);

  repo.git("switch", "-qc", "feature");
  repo.write("feature.txt", "A reviewed feature\n");
  const head = repo.commit("Add feature");

  repo.git("switch", "-q", "main");
  repo.write("new-schema.sql", "ALTER TABLE examples ADD COLUMN label TEXT;\n");
  const base = repo.commit("Evolve the base schema");

  repo.git("switch", "-q", "feature");
  const result = repo.prepare(head, base);

  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.values.build, head);
  assert.notEqual(result.values.build, base);
  assert.equal(result.values.build, repo.git("rev-parse", "HEAD"));
  assert.equal(repo.git("merge-base", "--is-ancestor", base, "HEAD"), "");
  assert.equal(readFileSync(join(repo.directory, "feature.txt"), "utf8"), "A reviewed feature\n");
  assert.equal(readFileSync(join(repo.directory, "new-schema.sql"), "utf8"), "ALTER TABLE examples ADD COLUMN label TEXT;\n");
});

test("a conflicting preview base fails without publishing a build commit", context => {
  const repo = repository(context);

  repo.git("switch", "-qc", "feature");
  repo.write("schema.sql", "CREATE TABLE examples (id INTEGER PRIMARY KEY);\n");
  const head = repo.commit("Change feature schema");

  repo.git("switch", "-q", "main");
  repo.write("schema.sql", "CREATE TABLE examples (id TEXT PRIMARY KEY, label TEXT);\n");
  const base = repo.commit("Change base schema");

  repo.git("switch", "-q", "feature");
  const result = repo.prepare(head, base);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /conflict/i);
  assert.equal(result.recorded, "");
  assert.equal(repo.git("rev-parse", "HEAD"), head);
});

test("preview preparation refuses a checkout that differs from the recorded PR head", context => {
  const repo = repository(context);

  repo.git("switch", "-qc", "feature");
  repo.write("feature.txt", "A reviewed feature\n");
  const head = repo.commit("Add feature");
  const result = repo.prepare(repo.initial, repo.initial);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/i);
  assert.equal(result.recorded, "");
  assert.equal(repo.git("rev-parse", "HEAD"), head);
});

test("a missing preview base fails without changing the checked-out source", context => {
  const repo = repository(context);
  const result = repo.prepare(repo.initial, "0".repeat(40));

  assert.notEqual(result.status, 0);
  assert.equal(result.recorded, "");
  assert.equal(repo.git("rev-parse", "HEAD"), repo.initial);
});
