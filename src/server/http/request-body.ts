import { HttpError } from "@/lib/errors";

/** Largest accepted JSON body; CSV imports carry up to 1 MB of CSV text, and JSON escaping needs headroom. */
export const maxRequestBodyBytes = 2 * 1024 * 1024;

function tooLarge() {
  return new HttpError(413, "Request body is too large.");
}

/** Reads a request body as text and stops once it exceeds the limit, whether or not the request declares its length. */
async function readBodyText(request: Request) {
  if (Number(request.headers.get("content-length")) > maxRequestBodyBytes) {
    throw tooLarge();
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const {
      done,
      value
    } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > maxRequestBodyBytes) {
      await reader.cancel();

      throw tooLarge();
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a JSON request body; an unreadable body is the caller's input error, not a server failure. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await readBodyText(request);

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Input is incomplete or invalid.");
  }
}
