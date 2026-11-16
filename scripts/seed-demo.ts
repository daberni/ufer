import { loadEnvConfig } from "@next/env";
import { Temporal } from "temporal-polyfill";
import { assertDemoSeedRequest, DemoSeedRefusal, seedDemoData } from "../src/features/demo/server/demo-seed-service";
import { database } from "../src/server/database/connection";
import { today, validDate } from "../src/lib/time";

function runDateOption() {
  const option = process.argv.find(argument => argument.startsWith("--date="));

  if (!option) {
    return undefined;
  }

  const value = option.slice("--date=".length);

  if (!validDate(value) || Temporal.PlainDate.compare(Temporal.PlainDate.from(value), today()) > 0) {
    throw new DemoSeedRefusal("--date must be a past or current date in YYYY-MM-DD form.");
  }

  return Temporal.PlainDate.from(value);
}

async function main() {
  loadEnvConfig(process.cwd());

  const options = {
    confirmed: process.argv.includes("--confirm"),
    runDate: runDateOption()
  };

  assertDemoSeedRequest(options);

  const db = await database();

  try {
    console.log(JSON.stringify(await seedDemoData(options), null, 2));
  } finally {
    db.$client.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Demo seed failed.");
  process.exitCode = 1;
});
