import { HttpError } from "@/lib/errors";

export function requireOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || "http://localhost:3000").origin;

  if (!origin || origin !== expected) {
    throw new HttpError(403, "Invalid request origin.");
  }
}
