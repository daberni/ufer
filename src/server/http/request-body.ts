import { HttpError } from "@/lib/errors";

/** Largest accepted JSON body; CSV imports carry up to 1 MB of CSV text, and JSON escaping needs headroom. */
export const maxRequestBodyBytes = 2 * 1024 * 1024;

/** Reads a JSON request body; an unreadable body is the caller's input error, not a server failure. */
export async function readJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));

  if (declaredLength > maxRequestBodyBytes) {
    throw new HttpError(413, "Request body is too large.");
  }

  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Input is incomplete or invalid.");
  }
}
