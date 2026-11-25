import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { initializeDatabase, migrationReport } from "../src/server/database/migrations";
import { olderRelease } from "./fixtures/older-release";

test("the migration report names exactly the changesets a release would apply, in order", async context => {
  const directory = mkdtempSync(join(tmpdir(), "ufer-migration-report-"));
  const client = createClient({
    url: `file:${join(directory, "database.sqlite")}`
  });

  context.after(() => {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  });

  await initializeDatabase(client, olderRelease(directory, 20));

  const report = await migrationReport(client);
  const all = (await migrationReport(createClient({
    url: ":memory:"
  }))).pendingChangesets;

  assert.equal(report.applied, 20);
  assert.equal(report.pending, all.length - 20);
  assert.deepEqual(report.pendingChangesets, all.slice(20));
  assert.match(report.pendingChangesets[0], /^0020_.+\.sql$/);
});
