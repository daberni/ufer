import assert from "node:assert/strict";
import test from "node:test";
import { applicationOrigin, requireOrigin } from "../src/server/http/origin";

const originEnvironment = ["APP_URL", "VERCEL_ENV", "VERCEL_BRANCH_URL", "VERCEL_URL"] as const;

function withEnvironment(values: Partial<Record<(typeof originEnvironment)[number], string>>, run: () => void) {
  const previous = new Map(originEnvironment.map((name) => [name, process.env[name]]));

  for (const name of originEnvironment) {
    delete process.env[name];
  }

  Object.assign(process.env, values);

  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function writeFrom(origin: string) {
  return new Request("https://ufer-git-feature-team.vercel.app/api/accounts", {
    method: "POST",
    headers: {
      origin
    }
  });
}

test("preview deployments accept their own branch and deployment origins", () => {
  withEnvironment({
    VERCEL_ENV: "preview",
    VERCEL_BRANCH_URL: "ufer-git-feature-team.vercel.app",
    VERCEL_URL: "ufer-abc123-team.vercel.app"
  }, () => {
    assert.equal(applicationOrigin(), "https://ufer-git-feature-team.vercel.app");
    requireOrigin(writeFrom("https://ufer-git-feature-team.vercel.app"));
    requireOrigin(writeFrom("https://ufer-abc123-team.vercel.app"));
    assert.throws(() => requireOrigin(writeFrom("https://ufer-git-other-team.vercel.app")));
  });
});

test("production ignores deployment hosts and only accepts the configured origin", () => {
  withEnvironment({
    APP_URL: "https://ufer.example",
    VERCEL_ENV: "production",
    VERCEL_BRANCH_URL: "ufer-git-main-team.vercel.app",
    VERCEL_URL: "ufer-def456-team.vercel.app"
  }, () => {
    assert.equal(applicationOrigin(), "https://ufer.example");
    requireOrigin(writeFrom("https://ufer.example"));
    assert.throws(() => requireOrigin(writeFrom("https://ufer-def456-team.vercel.app")));
  });
});

test("production fails without an HTTPS APP_URL instead of falling back to localhost", () => {
  for (const environment of [{
    VERCEL_ENV: "production"
  }, {
    VERCEL_ENV: "production",
    APP_URL: "http://ufer.example"
  }, {
    VERCEL_ENV: "production",
    APP_URL: "not a url"
  }] as const) {
    withEnvironment(environment, () => {
      assert.throws(() => applicationOrigin(), {
        status: 503
      });
    });
  }

  const environment = process.env as Record<string, string | undefined>;
  const previous = environment.NODE_ENV;

  environment.NODE_ENV = "production";

  try {
    withEnvironment({}, () => {
      assert.throws(() => applicationOrigin(), {
        status: 503
      });
    });
    withEnvironment({
      APP_URL: "https://ufer.example"
    }, () => {
      assert.equal(applicationOrigin(), "https://ufer.example");
    });
    withEnvironment({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "ufer-git-feature-team.vercel.app"
    }, () => {
      assert.equal(applicationOrigin(), "https://ufer-git-feature-team.vercel.app");
    });
  } finally {
    if (previous === undefined) {
      delete environment.NODE_ENV;
    } else {
      environment.NODE_ENV = previous;
    }
  }
});
