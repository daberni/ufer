import assert from "node:assert/strict";
import { test } from "node:test";
import { legalConfiguration } from "../src/features/legal/server/legal-configuration";

const processors = JSON.stringify([{
  name: "Example Hosting",
  purpose: "Runs the application.",
  location: "Example Region"
}]);

const complete = {
  OPERATOR_NAME: " Example Operator ",
  OPERATOR_RESIDENCE: " Example City, Example Country ",
  OPERATOR_EMAIL: " operator@example.test ",
  DATA_PROCESSORS: processors
};

test("complete operator details and processors are trimmed", () => {
  assert.deepEqual(legalConfiguration(complete), {
    configured: true,
    operator: {
      name: "Example Operator",
      residence: "Example City, Example Country",
      email: "operator@example.test"
    },
    processors: [{
      name: "Example Hosting",
      purpose: "Runs the application.",
      location: "Example Region"
    }]
  });
});

test("the contact email is optional, including the empty value hosting dashboards store", () => {
  for (const email of [undefined, "", "  "]) {
    const result = legalConfiguration({
      ...complete,
      OPERATOR_EMAIL: email
    });

    assert.equal(result.configured, true);
    assert.equal(result.configured && result.operator.email, null);
  }
});

test("an explicit empty processor list is valid", () => {
  const result = legalConfiguration({
    ...complete,
    DATA_PROCESSORS: "[]"
  });

  assert.deepEqual(result.configured && result.processors, []);
});

test("an unconfigured installation names every missing required variable and exposes no partial details", () => {
  assert.deepEqual(legalConfiguration({}), {
    configured: false,
    invalidVariables: ["OPERATOR_NAME", "OPERATOR_RESIDENCE", "DATA_PROCESSORS"]
  });
});

test("blank, malformed or incomplete values make the configuration invalid", () => {
  const cases: [Record<string, string>, string][] = [
    [{
      OPERATOR_NAME: "   "
    }, "OPERATOR_NAME"],
    [{
      OPERATOR_RESIDENCE: "   "
    }, "OPERATOR_RESIDENCE"],
    [{
      OPERATOR_EMAIL: "operator at example.test"
    }, "OPERATOR_EMAIL"],
    [{
      DATA_PROCESSORS: "not json"
    }, "DATA_PROCESSORS"],
    [{
      DATA_PROCESSORS: JSON.stringify([{
        name: "Example Hosting",
        purpose: "Runs the application."
      }])
    }, "DATA_PROCESSORS"],
    [{
      DATA_PROCESSORS: JSON.stringify({
        name: "Example Hosting"
      })
    }, "DATA_PROCESSORS"]
  ];

  for (const [override, variable] of cases) {
    assert.deepEqual(legalConfiguration({
      ...complete,
      ...override
    }), {
      configured: false,
      invalidVariables: [variable]
    }, variable);
  }
});
