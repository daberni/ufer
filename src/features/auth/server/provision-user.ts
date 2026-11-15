import { z } from "zod";
import { HttpError } from "@/lib/errors";
import { database } from "@/server/database/connection";
import { createAuth } from "./auth";
import { addMembership, ownerExists } from "./membership-repository";

const enrollment = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/),
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(12).max(128),
  role: z.enum(["owner", "member"])
});

// Operator-only use: this function is never exposed through an HTTP route.
export async function provisionUser(payload: unknown) {
  const input = enrollment.parse(payload);
  const db = await database();

  return db.transaction(async tx => {
    const owner = await ownerExists(tx);

    if (input.role === "owner" && owner) {
      throw new HttpError(409, "An owner already exists. Use member enrollment for additional users.");
    }

    if (input.role === "member" && !owner) {
      throw new HttpError(409, "Provision the installation owner first.");
    }

    const auth = createAuth(tx, {
      enrollment: true
    });
    const result = await auth.api.signUpEmail({
      body: input
    });

    // autoSignIn=false can deliberately mask duplicate email addresses. A membership must reference a stored new user.
    await addMembership(tx, result.user.id, input.role);

    return {
      id: result.user.id,
      username: input.username.toLowerCase(),
      role: input.role
    };
  });
}
