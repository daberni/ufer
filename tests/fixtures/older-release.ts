import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Copies the checked-in changesets and keeps only the first `count`, as an older release would have them. */
export function olderRelease(directory: string, count: number) {
  const target = join(directory, "release", "drizzle", "sqlite");

  cpSync("drizzle/sqlite", target, {
    recursive: true
  });

  const journalFile = join(target, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as {
    entries: {
      tag: string
    }[]
  };
  const kept = new Set(journal.entries.slice(0, count).map(entry => entry.tag));

  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalFile, JSON.stringify(journal));

  for (const file of readdirSync(target).filter(name => name.endsWith(".sql"))) {
    if (!kept.has(file.replace(/\.sql$/, ""))) {
      rmSync(join(target, file));
    }
  }

  return target;
}

