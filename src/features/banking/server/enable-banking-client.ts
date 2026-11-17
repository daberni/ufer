import { HttpError } from "@/lib/errors";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { timestamp, validDate } from "@/lib/time";
import { environment } from "./environment";

// Fields Ufer reads, persists or shows are checked here; a response that does not match them is rejected as a provider failure.
const providerTextLength = 500;

// An optional descriptive value never stops an import or a connection: a malformed value is dropped.
const optionalText = z.string().max(providerTextLength).nullish().catch(undefined);

const providerAmount = z.looseObject({
  amount: z.string(),
  currency: z.string()
});

// Persisted timestamps use the format of `timestamp()`, because SQL compares them as text.
const providerInstant = z.string().transform((value, context) => {
  try {
    return timestamp(Temporal.Instant.from(value));
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }

    context.addIssue({
      code: "custom",
      message: "Expected an instant with a UTC offset."
    });

    return z.NEVER;
  }
});

const applicationResponse = z.object({
  environment: z.string(),
  redirect_urls: z.array(z.string())
});

const bank = z.object({
  name: z.string().min(1).max(200),
  country: z.string().regex(/^[A-Z]{2}$/),
  maximum_consent_validity: z.number().int().positive().nullish(),
  psu_types: z.array(z.string()).nullish(),
  beta: z.boolean().nullish()
});

const bankDirectoryResponse = z.object({
  aspsps: z.array(bank)
});

const authorizationResponse = z.object({
  url: z.url({
    protocol: /^https$/
  }),
  authorization_id: z.string().min(1)
});

const bankAccount = z.object({
  uid: z.string(),
  identification_hash: z.string(),
  identification_hashes: z.array(z.string()).nullish(),
  account_id: z.object({
    iban: z.string().max(64).nullish().catch(undefined)
  }).nullish().catch(undefined),
  currency: z.string(),
  name: optionalText,
  product: optionalText,
  cash_account_type: optionalText
});

const sessionEnvelope = z.looseObject({
  session_id: z.string().min(1),
  access: z.object({
    valid_until: providerInstant
  })
});

const sessionResponse = sessionEnvelope.extend({
  accounts: z.array(bankAccount),
  aspsp: z.object({
    name: z.string(),
    country: z.string()
  })
});

const balance = z.object({
  balance_type: z.string(),
  balance_amount: providerAmount,
  reference_date: z.string().refine(validDate).nullish()
});

const balancesResponse = z.object({
  balances: z.array(balance)
});

const party = z.looseObject({
  name: optionalText
}).nullish().catch(undefined);

const partyAccount = z.looseObject({
  iban: z.string().max(64).nullish().catch(undefined)
}).nullish().catch(undefined);

// Loose objects keep the provider fields Ufer does not read, because the raw transaction is stored with each booking.
const bankTransaction = z.looseObject({
  entry_reference: z.string().nullish(),
  transaction_id: z.string().nullish(),
  status: z.string(),
  booking_date: z.string().nullish(),
  value_date: z.string().nullish(),
  transaction_amount: providerAmount,
  credit_debit_indicator: z.string(),
  creditor: party,
  debtor: party,
  creditor_account: partyAccount,
  debtor_account: partyAccount,
  remittance_information: z.array(z.string().max(providerTextLength)).nullish().catch(undefined),
  note: optionalText
});

const transactionPageResponse = z.object({
  transactions: z.array(bankTransaction),
  continuation_key: z.string().nullish()
});

export type Bank = z.infer<typeof bank>;

export type BankAccount = z.infer<typeof bankAccount>;

export type BankTransaction = z.infer<typeof bankTransaction>;

export type Balance = z.infer<typeof balance>;

export type BankSession = z.infer<typeof sessionResponse>;

export class BankingError extends HttpError {
  constructor(public code: string, public upstreamStatus: number) {
    const messages: Record<string, string> = {
      EXPIRED_SESSION: "Bank authorization has expired. Reconnect the bank.",
      EXPIREDSESSION: "Bank authorization has expired. Reconnect the bank.",
      INVALID_SESSION: "Bank authorization is invalid. Reconnect the bank.",
      ASPSP_RATE_LIMIT_EXCEEDED: "The bank is not allowing another retrieval right now. Try syncing later.",
      REDIRECT_URL_NOT_ALLOWED: "The callback URL does not match the registered redirect URL."
    };

    super(upstreamStatus === 429 ? 429 : 502, messages[code] || `Enable Banking returned ${code} (HTTP ${upstreamStatus}).`);
  }
}

// Enable Banking ErrorCode values for a session that can no longer be used or revoked.
const endedSessionCodes = ["EXPIRED_SESSION", "CLOSED_SESSION", "REVOKED_SESSION", "SESSION_DOES_NOT_EXIST", "EXPIREDSESSION", "INVALID_SESSION"];

/** The provider no longer accepts this session; only a new bank authorization gives access again. */
export function sessionEnded(error: unknown) {
  return error instanceof BankingError && endedSessionCodes.includes(error.code);
}

export function bankingConfigured() {
  return Boolean(process.env.ENABLE_BANKING_APP_ID && (process.env.ENABLE_BANKING_PRIVATE_KEY_PATH || process.env.ENABLE_BANKING_PRIVATE_KEY));
}

type SigningKey = {
  source: string;
  key: KeyObject;
};

type ProviderToken = {
  applicationId: string;
  key: KeyObject;
  token: string;
  renewAt: Temporal.Instant;
};

const tokenLifetimeSeconds = 300;
// A reused token keeps at least this much validity for the request that carries it.
const tokenRenewalMarginSeconds = 60;
let signingKey: SigningKey | undefined;
let providerToken: ProviderToken | undefined;

function privateKey() {
  const inlineKey = process.env.ENABLE_BANKING_PRIVATE_KEY;
  const source = inlineKey ? `inline:${inlineKey}` : `file:${process.env.ENABLE_BANKING_PRIVATE_KEY_PATH}`;

  if (signingKey?.source !== source) {
    const pem = inlineKey?.replace(/\\n/g, "\n") || readFileSync(process.env.ENABLE_BANKING_PRIVATE_KEY_PATH!, "utf8");

    signingKey = {
      source,
      key: createPrivateKey(pem)
    };
  }

  return signingKey.key;
}

/** The provider JWT for API requests; one token is reused until shortly before its five-minute lifetime ends. */
export async function applicationToken() {
  if (!bankingConfigured()) {
    throw new HttpError(503, "Enable Banking application ID and private key are missing.");
  }

  const applicationId = process.env.ENABLE_BANKING_APP_ID!;
  const key = privateKey();
  const now = Temporal.Now.instant();
  const cached = providerToken;

  if (cached && cached.applicationId === applicationId && cached.key === key && Temporal.Instant.compare(now, cached.renewAt) < 0) {
    return cached.token;
  }

  const issuedAt = Math.floor(now.epochMilliseconds / 1000);
  const token = await new SignJWT({}).setProtectedHeader({
    typ: "JWT",
    alg: "RS256",
    kid: applicationId
  }).setIssuer("enablebanking.com").setAudience("api.enablebanking.com").setIssuedAt(issuedAt).setExpirationTime(issuedAt + tokenLifetimeSeconds).sign(key);

  providerToken = {
    applicationId,
    key,
    token,
    renewAt: now.add({
      seconds: tokenLifetimeSeconds - tokenRenewalMarginSeconds
    })
  };

  return token;
}

async function bankingRequest<T>(path: string, schema: z.ZodType<T>, body?: unknown, method = body ? "POST" : "GET"): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`https://api.enablebanking.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await applicationToken()}`,
        Accept: "application/json",
        ...(body ? {
          "Content-Type": "application/json"
        } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000)
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, "Enable Banking is unavailable or the local key configuration is invalid.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const code = typeof data.error === "string" && /^[A-Z_]+$/.test(data.error) ? data.error : "API_ERROR";

    throw new BankingError(code, response.status);
  }

  return validProviderData(await readProviderBody(response, method), schema);
}

// A body that cannot be read is a provider failure, not the user's input. DELETE /sessions answers without a body.
async function readProviderBody(response: Response, method: string): Promise<unknown> {
  let text: string;

  try {
    text = await response.text();
  } catch {
    throw new HttpError(502, "Enable Banking returned an unreadable response.");
  }

  if (!text.trim() && method === "DELETE") {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, "Enable Banking returned an unreadable response.");
  }
}

// Only issue locations and codes are logged; provider values may contain financial data.
function validProviderData<T>(data: unknown, schema: z.ZodType<T>) {
  const result = schema.safeParse(data);

  if (!result.success) {
    console.warn("Enable Banking response rejected.", {
      issues: result.error.issues.map(issue => ({
        path: issue.path.join("."),
        code: issue.code
      }))
    });

    throw new HttpError(502, "Enable Banking returned an unexpected response.");
  }

  return result.data;
}

export async function verifyApplication() {
  const application = await bankingRequest("/application", applicationResponse);

  if (application.environment !== environment()) {
    throw new HttpError(409, "The application environment does not match ENABLE_BANKING_ENVIRONMENT.");
  }

  return application;
}

export async function deleteSession(sessionId: string) {
  await bankingRequest(`/sessions/${encodeURIComponent(sessionId)}`, z.unknown(), undefined, "DELETE");
}

/** Starts a bank authorization; the returned redirect is always an HTTPS URL. */
export async function requestAuthorization(request: object) {
  return bankingRequest("/auth", authorizationResponse, request);
}

/** Capture the recoverable credential before validating nested session details. */
export async function createSession(code: string) {
  return bankingRequest("/sessions", sessionEnvelope, {
    code
  });
}

export function validateBankSession(session: unknown) {
  return validProviderData(session, sessionResponse);
}

export async function fetchBalances(uid: string) {
  const result = await bankingRequest(`/accounts/${encodeURIComponent(uid)}/balances`, balancesResponse);

  return result.balances;
}

export async function availableBanks(country: string) {
  const result = await bankingRequest(`/aspsps?country=${encodeURIComponent(country)}`, bankDirectoryResponse);

  return result.aspsps.filter(bank => !bank.psu_types || bank.psu_types.includes("personal"));
}

/** The bank directory for the connect dialog; it also confirms that the provider application belongs to the configured environment. */
export async function listBanks(country: string) {
  const [banks] = await Promise.all([availableBanks(country), verifyApplication()]);

  return banks;
}

export async function fetchTransactions(uid: string, dateFrom: string, heartbeat?: () => Promise<void>): Promise<BankTransaction[]> {
  const result: BankTransaction[] = [];
  const seen = new Set<string>();
  let continuation: string | undefined;

  do {
    await heartbeat?.();
    const query = new URLSearchParams({
      date_from: dateFrom
    });

    if (continuation) {
      query.set("continuation_key", continuation);
    }

    const page = await bankingRequest(`/accounts/${encodeURIComponent(uid)}/transactions?${query}`, transactionPageResponse);

    result.push(...page.transactions);
    continuation = page.continuation_key || undefined;

    if (continuation) {
      if (seen.has(continuation) || seen.size >= 200) {
        throw new HttpError(502, "Transaction retrieval did not finish. Existing data has been preserved.");
      }

      seen.add(continuation);
    }
  } while (continuation);

  return result;
}
