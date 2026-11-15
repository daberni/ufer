import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { resetUserPassword } from "../src/features/auth/server/password-recovery";
import { provisionUser } from "../src/features/auth/server/provision-user";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { database } from "../src/server/database/connection";

async function main() {
  loadEnvConfig(process.cwd());

  if (process.stdin.isTTY) {
    throw new Error("Provide user-maintenance JSON on stdin from your password manager. Passwords must not be command-line arguments.");
  }

  const operation = process.argv[2];

  if (operation !== "create" && operation !== "reset-password") {
    throw new Error("Use the user:create or user:reset-password command.");
  }

  const payload = JSON.parse(readFileSync(0, "utf8"));
  const db = await database();

  try {
    if (operation === "reset-password") {
      console.log(JSON.stringify(await resetUserPassword(payload)));
    } else {
      const result = await provisionUser(payload);

      console.log(JSON.stringify({
        created: true,
        id: result.id,
        role: result.role
      }));
    }
  } finally {
    db.$client.close();
  }
}

main().catch(error => {
  const expected = error instanceof z.ZodError || error instanceof SyntaxError || error instanceof APIError;

  console.error(expected ? "User maintenance failed. Check the enrollment fields and existing users." : "User maintenance failed. Check the database, configuration and installation ownership.");
  process.exitCode = 1;
});
