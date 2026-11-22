import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { database } from "@/server/database/connection";
import { createAuth } from "@/server/security/auth";

const recovery = z.object({
  email: z.email(),
  password: z.string().min(12).max(128)
});

// Operator-only recovery uses the library's one-time reset workflow; the token never leaves this process.
export async function resetUserPassword(payload: unknown) {
  const input = recovery.parse(payload);
  let resetToken: string | undefined;
  const auth = createAuth(await database(), {
    onPasswordReset: token => {
      resetToken = token;
    }
  });

  await auth.api.requestPasswordReset({
    body: {
      email: input.email
    }
  });

  if (!resetToken) {
    throw new ValidationError("The requested user could not be recovered.");
  }

  await auth.api.resetPassword({
    body: {
      token: resetToken,
      newPassword: input.password
    }
  });

  return {
    changed: true
  };
}
