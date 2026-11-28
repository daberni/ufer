import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

/*
 * Captures the README screenshots from a fresh synthetic demo database.
 * Everything it creates (database, secrets, demo user, dev server) is throwaway and removed on exit; it never reads `.env` values or contacts a bank provider.
 * Requires a local Chrome; set CHROME_PATH to use another Chromium-based browser.
 */

const port = Number(process.env.SCREENSHOT_PORT ?? 3917);
const origin = `http://127.0.0.1:${port}`;
const outputDirectory = path.resolve("docs/screenshots");
const quality = 82;

type Shot = {
  name: string;
  path: string;
  /** Waits for the view's content before capturing. */
  ready: (page: Page) => Promise<void>;
  /** Interaction before capturing, such as opening a detail panel. */
  prepare?: (page: Page) => Promise<void>;
  fullPage?: boolean;
};

type Viewport = {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
};

const viewports: Viewport[] = [{
  name: "desktop",
  width: 1440,
  height: 960,
  mobile: false
}, {
  name: "phone",
  width: 390,
  height: 844,
  mobile: true
}];

async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.querySelector("[aria-busy='true']"));
  // Charts animate in; give them time to finish before capturing.
  await page.waitForTimeout(900);
}

async function heading(page: Page, text: string | RegExp) {
  await page.getByRole("heading", {
    name: text
  }).first().waitFor();
  await settled(page);
}

const shots: Shot[] = [{
  name: "overview",
  path: "/",
  ready: page => heading(page, /Your money/)
}, {
  name: "transactions",
  path: "/transactions",
  ready: page => heading(page, "Transactions")
}, {
  name: "accounts",
  path: "/accounts",
  ready: page => heading(page, "Accounts")
}, {
  name: "account-details",
  path: "/accounts/demo-checking",
  ready: page => heading(page, /Everyday account/)
}, {
  name: "rules",
  path: "/rules",
  ready: page => heading(page, "Categorization")
}, {
  name: "connections",
  path: "/accounts",
  ready: async page => {
    await heading(page, "Bank connections");
    await page.locator("#bank-connections").scrollIntoViewIfNeeded();
    await page.evaluate(() => document.getElementById("bank-connections")?.scrollIntoView({
      block: "start"
    }));
    await settled(page);
  }
}];

function run(command: string, args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "inherit"]
    });
    let output = "";

    child.stdout.on("data", chunk => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}.`));
      }
    });
    child.stdin.end(input ?? "");
  });
}

async function waitForServer(server: ChildProcess) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (server.exitCode !== null) {
      throw new Error("The development server stopped before it was ready.");
    }

    try {
      const response = await fetch(`${origin}/privacy`);

      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error("The development server did not become ready.");
}

async function signIn(browser: Browser, username: string, password: string) {
  const context = await browser.newContext({
    baseURL: origin
  });
  const page = await context.newPage();

  // Signed-out visitors see the sign-in form in place of the dashboard.
  await page.goto("/");
  await page.locator("input[name=username]").fill(username);
  await page.locator("input[name=password]").fill(password);
  await page.locator("button").filter({
    hasText: "Open dashboard"
  }).click();
  await page.getByRole("heading", {
    name: /Your money/
  }).waitFor();

  const state = await context.storageState();

  await context.close();

  return state;
}

/** Captures through the DevTools protocol, which encodes WebP directly. */
async function capture(page: Page, file: string, fullPage: boolean) {
  const session = await page.context().newCDPSession(page);
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
    top: window.scrollY
  }));
  const viewport = page.viewportSize();
  const height = fullPage ? Math.min(size.height, 3200) : viewport?.height ?? size.height;
  const result = await session.send("Page.captureScreenshot", {
    format: "webp",
    quality,
    captureBeyondViewport: fullPage,
    clip: {
      x: 0,
      y: fullPage ? 0 : size.top,
      width: size.width,
      height,
      scale: 1
    }
  });

  writeFileSync(file, Buffer.from(result.data, "base64"));
  await session.detach();
}

async function captureAll(browser: Browser, storageState: Awaited<ReturnType<typeof signIn>>) {
  const variants: {
    viewport: Viewport;
    colorScheme: "light" | "dark";
    shots: Shot[];
  }[] = [
    ...viewports.map(viewport => ({
      viewport,
      colorScheme: "light" as const,
      shots
    })),
    {
      viewport: viewports[0],
      colorScheme: "dark",
      shots: shots.filter(shot => shot.name === "overview")
    }
  ];

  for (const variant of variants) {
    const context = await browser.newContext({
      baseURL: origin,
      storageState,
      viewport: {
        width: variant.viewport.width,
        height: variant.viewport.height
      },
      deviceScaleFactor: variant.viewport.mobile ? 2 : 1,
      isMobile: variant.viewport.mobile,
      hasTouch: variant.viewport.mobile,
      colorScheme: variant.colorScheme,
      locale: "en-GB",
      timezoneId: "Europe/Vienna",
      reducedMotion: "reduce"
    });
    const page = await context.newPage();

    for (const shot of variant.shots) {
      const suffix = variant.colorScheme === "dark" ? "-dark" : "";
      const file = path.join(outputDirectory, `${shot.name}-${variant.viewport.name}${suffix}.webp`);

      await page.goto(shot.path);
      // Development error badges are not part of the product.
      await page.addStyleTag({
        content: "nextjs-portal { display: none !important; }"
      });
      await shot.ready(page);
      await shot.prepare?.(page);
      await capture(page, file, shot.fullPage ?? false);
      console.log(`Captured ${path.relative(process.cwd(), file)}`);
    }

    await context.close();
  }
}

/**
 * The server shows the demo as a configured production installation, without the sandbox marker and the missing-configuration notice.
 * Its application ID and key are throwaway values no provider knows; the captured views make no provider request, because sync skips demo accounts and the bank directory loads only when the connect dialog opens.
 */
function productionLookingEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const {
    privateKey
  } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });

  return {
    ...env,
    ENABLE_BANKING_ENVIRONMENT: "PRODUCTION",
    ENABLE_BANKING_APP_ID: randomUUID(),
    ENABLE_BANKING_PRIVATE_KEY: privateKey.export({
      type: "pkcs8",
      format: "pem"
    }).toString()
  };
}

async function main() {
  mkdirSync(outputDirectory, {
    recursive: true
  });
  const workDirectory = mkdtempSync(path.join(tmpdir(), "ufer-screenshots-"));
  const username = "demo";
  const password = randomBytes(18).toString("base64url");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: `file:${path.join(workDirectory, "demo.db")}`,
    DATABASE_AUTH_TOKEN: "",
    APP_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    CRON_SECRET: randomBytes(32).toString("hex"),
    ENABLE_BANKING_ENVIRONMENT: "SANDBOX",
    ENABLE_BANKING_APP_ID: "",
    ENABLE_BANKING_PRIVATE_KEY: "",
    ENABLE_BANKING_PRIVATE_KEY_PATH: "",
    ENABLE_BANKING_REDIRECT_URL: `${origin}/api/banking/callback`
  };
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;

  try {
    console.log(await run("npx", ["tsx", "scripts/seed-demo.ts", "--confirm"], env));
    await run("npx", ["tsx", "scripts/manage-users.ts", "create"], env, JSON.stringify({
      username,
      name: "Alex Demo",
      email: "alex@example.com",
      password,
      role: "owner"
    }));

    server = spawn("npx", ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      env: productionLookingEnvironment(env),
      stdio: ["ignore", "ignore", "inherit"],
      detached: true
    });
    await waitForServer(server);

    browser = await chromium.launch(process.env.CHROME_PATH ? {
      executablePath: process.env.CHROME_PATH
    } : {
      channel: "chrome"
    });
    await captureAll(browser, await signIn(browser, username, password));
  } finally {
    await browser?.close();

    // The dev server spawns workers; stop the whole process group unless it has already exited.
    if (server?.pid && server.exitCode === null) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch (error) {
        console.warn(`Could not stop the development server: ${error instanceof Error ? error.message : error}`);
      }
    }

    rmSync(workDirectory, {
      recursive: true,
      force: true
    });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
