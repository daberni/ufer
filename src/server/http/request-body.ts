import { HttpError } from "@/lib/errors";

/** Reads a JSON request body; an unreadable body is the caller's input error, not a server failure. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Input is incomplete or invalid.");
  }
}
