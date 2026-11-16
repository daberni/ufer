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
  OPERATOR_ADDRESS: "Example Street 1\n 1000 Example City \n\n",
  OPERATOR_EMAIL: " operator@example.test ",
  DATA_PROCESSORS: processors
};

test("complete operator details and processors are trimmed and split into address lines", () => {
  assert.deepEqual(legalConfiguration(complete), {
    configured: true,
    operator: {
      name: "Example Operator",
      addressLines: ["Example Street 1", "1000 Example City"],
      email: "operator@example.test"
    },
    processors: [{
      name: "Example Hosting",
      purpose: "Runs the application.",
      location: "Example Region"
    }]
  });
});

test("the postal address is optional and an explicit empty processor list is valid", () => {
  const result = legalConfiguration({
    ...complete,
    OPERATOR_ADDRESS: undefined,
    DATA_PROCESSORS: "[]"
  });

  assert.equal(result.configured, true);
  assert.deepEqual(result.configured && result.operator.addressLines, []);
  assert.deepEqual(result.configured && result.processors, []);
});

test("an unconfigured installation names every missing variable and exposes no partial details", () => {
  assert.deepEqual(legalConfiguration({}), {
    configured: false,
    invalidVariables: ["OPERATOR_NAME", "OPERATOR_EMAIL", "DATA_PROCESSORS"]
  });
});

test("blank, malformed or incomplete values make the configuration invalid", () => {
  const cases: [Record<string, string>, string][] = [
    [{
      OPERATOR_NAME: "   "
    }, "OPERATOR_NAME"],
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
