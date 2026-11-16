import { z } from "zod";
import type { LegalConfiguration } from "../types";

type Environment = Record<string, string | undefined>;

const variables = {
  name: "OPERATOR_NAME",
  address: "OPERATOR_ADDRESS",
  email: "OPERATOR_EMAIL",
  processors: "DATA_PROCESSORS"
} as const;

const text = (maximum: number) => z.string().trim().min(1).max(maximum);

const processorSchema = z.object({
  name: text(200),
  purpose: text(500),
  location: text(200)
}).strict();

const configurationSchema = z.object({
  name: text(200),
  address: z.string().trim().max(500).optional(),
  email: z.email().max(254),
  processors: z.array(processorSchema).max(20)
});

/**
 * Validates the deployment-specific details shown in the privacy notice and terms; read per request so configuration changes apply without a rebuild.
 * The pages must never show partial or placeholder details that could pass for a registrable operator identity.
 */
export function legalConfiguration(env: Environment = process.env): LegalConfiguration {
  const result = configurationSchema.safeParse({
    name: env[variables.name],
    address: env[variables.address],
    email: env[variables.email]?.trim(),
    processors: parseJson(env[variables.processors])
  });

  if (!result.success) {
    const fields = new Set(result.error.issues.map(issue => String(issue.path[0])));
    const invalidVariables = Object.entries(variables).filter(([field]) => fields.has(field)).map(([, variable]) => variable);

    return {
      configured: false,
      invalidVariables
    };
  }

  const addressLines = (result.data.address ?? "").split("\n").map(line => line.trim()).filter(Boolean);

  return {
    configured: true,
    operator: {
      name: result.data.name,
      addressLines,
      email: result.data.email
    },
    processors: result.data.processors
  };
}

// An unset or malformed value stays undefined so validation reports DATA_PROCESSORS; an explicit [] declares that no processors are used.
function parseJson(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }

    throw error;
  }
}
