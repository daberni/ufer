import { z } from "zod";
import type { LegalConfiguration } from "../types";

type Environment = Record<string, string | undefined>;

const variables = {
  name: "OPERATOR_NAME",
  residence: "OPERATOR_RESIDENCE",
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
  residence: text(200),
  email: z.email().max(254).optional(),
  processors: z.array(processorSchema).max(20)
});

/**
 * Validates the deployment-specific details shown in the privacy notice and terms; read per request so configuration changes apply without a rebuild.
 * The pages must never show partial or placeholder details that could pass for a registrable operator identity.
 */
export function legalConfiguration(env: Environment = process.env): LegalConfiguration {
  const result = configurationSchema.safeParse({
    name: env[variables.name],
    residence: env[variables.residence],
    email: optional(env[variables.email]),
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

  return {
    configured: true,
    operator: {
      name: result.data.name,
      residence: result.data.residence,
      email: result.data.email ?? null
    },
    processors: result.data.processors
  };
}

// Hosting dashboards often store an unused variable as an empty string; treat it as not set.
function optional(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
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
