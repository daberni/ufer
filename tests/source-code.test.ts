import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceCodeUrl } from "../src/features/legal/server/source-code";

function configured(value: string) {
  return sourceCodeUrl({
    SOURCE_CODE_URL: value
  });
}

test("the source offer is absent when SOURCE_CODE_URL is unset or blank", () => {
  assert.equal(sourceCodeUrl({}), null);
  assert.equal(configured(""), null);
  assert.equal(configured("   "), null);
});

test("the source offer links to a trimmed absolute http or https URL", () => {
  assert.equal(configured(" https://example.test/ufer/tree/v1.0.0 "), "https://example.test/ufer/tree/v1.0.0");
  assert.equal(configured("http://nas.example.test/source.tar.gz"), "http://nas.example.test/source.tar.gz");
});

test("an invalid SOURCE_CODE_URL fails instead of rendering an unusable or script link", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,source", "/source", "example.test/ufer", "ftp://example.test/ufer"]) {
    assert.throws(() => configured(value), /SOURCE_CODE_URL/, value);
  }
});
