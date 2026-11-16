import { HttpError } from "@/lib/errors";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { Temporal } from "temporal-polyfill";
import { environment } from "./environment";

export type Bank = {
  name: string;
  country: string;
  maximum_consent_validity: number;
  psu_types?: string[];
  beta?: boolean;
  logo?: string;
};

export type BankAccount = {
  uid: string;
  identification_hash: string;
  identification_hashes?: string[];
  account_id?: {
    iban?: string;
  };
  currency: string;
  name?: string;
  product?: string;
  cash_account_type?: string;
};

/** The fields Ufer reads; the complete provider transaction is stored as JSON alongside them. */
export type BankTransaction = {
  entry_reference?: string;
  transaction_id?: string;
  status: string;
  booking_date?: string;
  value_date?: string;
  transaction_amount: {
    amount: string;
    currency: string;
  };
  credit_debit_indicator: "CRDT" | "DBIT";
  creditor?: {
    name?: string;
  };
  debtor?: {
    name?: string;
  };
  creditor_account?: {
    iban?: string;
  };
  debtor_account?: {
    iban?: string;
  };
  remittance_information?: string[];
  note?: string;
  exchange_rate?: {
    instructed_amount?: {
      amount: string;
      currency: string;
    };
  };
};

export type Balance = {
  balance_type: string;
  balance_amount: {
    amount: string;
    currency: string;
  };
  reference_date?: string;
};

export type BankSession = {
  session_id: string;
  accounts: BankAccount[];
  access: {
    valid_until: string;
  };
  aspsp: {
    name: string;
    country: string;
  };
};

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

export async function bankingRequest<T>(path: string, body?: unknown, method = body ? "POST" : "GET"): Promise<T> {
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

  return readProviderBody<T>(response, method);
}

// A body that cannot be read is a provider failure, not the user's input. DELETE /sessions answers without a body.
async function readProviderBody<T>(response: Response, method: string): Promise<T> {
  let text: string;

  try {
    text = await response.text();
  } catch {
    throw new HttpError(502, "Enable Banking returned an unreadable response.");
  }

  if (!text.trim() && method === "DELETE") {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, "Enable Banking returned an unreadable response.");
  }
}

export async function verifyApplication() {
  const application = await bankingRequest<{
    environment: string;
    redirect_urls: string[];
  }>("/application");

  if (application.environment !== environment()) {
    throw new HttpError(409, "The application environment does not match ENABLE_BANKING_ENVIRONMENT.");
  }

  return application;
}

export async function deleteSession(sessionId: string) {
  await bankingRequest<unknown>(`/sessions/${encodeURIComponent(sessionId)}`, undefined, "DELETE");
}

export async function availableBanks(country: string) {
  const result = await bankingRequest<{
    aspsps: Bank[];
  }>(`/aspsps?country=${encodeURIComponent(country)}`);

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

    const page = await bankingRequest<{
      transactions: BankTransaction[];
      continuation_key?: string | null;
    }>(`/accounts/${encodeURIComponent(uid)}/transactions?${query}`);

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
