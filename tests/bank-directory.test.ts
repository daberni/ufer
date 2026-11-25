import assert from "node:assert/strict";
import { test } from "node:test";
import { cachedLoad, directoryCountries } from "../src/features/banking/server/bank-directory";

test("the directory's countries are each listed once, whatever the provider's order", () => {
  assert.deepEqual(directoryCountries([{
    country: "SE"
  }, {
    country: "AT"
  }, {
    country: "PT"
  }, {
    country: "AT"
  }]), ["AT", "PT", "SE"]);
  assert.deepEqual(directoryCountries([]), []);
});

test("a loaded directory is reused until it expires", async () => {
  let clock = 0;
  let loads = 0;
  const directory = cachedLoad(async () => ++loads, 1_000, () => clock);

  assert.equal(await directory.get(), 1);
  clock = 999;
  assert.equal(await directory.get(), 1);
  clock = 1_000;
  assert.equal(await directory.get(), 2);
});

test("a failed load is not kept, so the next request retries the provider", async () => {
  let fail = true;
  let loads = 0;
  const directory = cachedLoad(async () => {
    loads++;

    if (fail) {
      throw new Error("provider unavailable");
    }

    return "directory";
  }, 60_000, () => 0);

  await assert.rejects(directory.get(), /provider unavailable/);
  fail = false;
  assert.equal(await directory.get(), "directory");
  assert.equal(await directory.get(), "directory");
  assert.equal(loads, 2);
});
