import { z } from "zod";

type Environment = Record<string, string | undefined>;

const sourceCodeUrlSchema = z.url({
  protocol: /^https?$/
});

/**
 * Where users of this installation obtain its Corresponding Source, as AGPL-3.0 section 13 requires for modified network deployments; null when not configured.
 * Read per request so a changed value applies without a rebuild. An invalid value fails loudly instead of silently hiding the source offer.
 */
export function sourceCodeUrl(env: Environment = process.env): string | null {
  const value = env.SOURCE_CODE_URL?.trim();

  if (!value) {
    return null;
  }

  const result = sourceCodeUrlSchema.safeParse(value);

  if (!result.success) {
    throw new Error("SOURCE_CODE_URL must be an absolute http or https URL.");
  }

  return result.data;
}
