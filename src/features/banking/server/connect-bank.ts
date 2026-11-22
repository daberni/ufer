import type { AuthContext } from "@/server/security/session";
import { HttpError } from "@/lib/errors";
import { randomBytes, randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { availableBanks, requestAuthorization, verifyApplication } from "@/features/banking/server/enable-banking-client";
import { hash } from "@/server/security/tokens";
import { timestamp } from "@/lib/time";
import { findConnectableAccount, insertAuthorization } from "./connection-repository";
import { bankCallbackUrl } from "./callback-url";

export async function connectBank(payload: unknown, actor: AuthContext) {
  const {
    bank,
    country,
    accountId
  } = z.object({
    bank: z.string().min(1).max(200),
    country: z.string().regex(/^[A-Z]{2}$/),
    // The manual account to connect; without it, the authorized bank accounts map by their identifiers.
    accountId: z.string().min(1).max(100).optional()
  }).parse(payload);

  if (accountId && !(await findConnectableAccount(accountId))) {
    throw new HttpError(409, "Only an active manual account can be connected to a bank.");
  }

  const callback = bankCallbackUrl();
  const [banks, application] = await Promise.all([availableBanks(country), verifyApplication()]);
  const selected = banks.find(item => item.name === bank && item.country === country);

  if (!selected) {
    throw new HttpError(400, "This bank is unavailable in the selected environment.");
  }

  if (!application.redirect_urls.includes(callback)) {
    throw new HttpError(409, "Register this exact callback URL in the Enable Banking application.");
  }

  const state = randomBytes(32).toString("base64url");
  const browser = randomBytes(32).toString("base64url");
  const validitySeconds = Math.min(selected.maximum_consent_validity ?? 86400, 180 * 86400);
  const validUntil = Temporal.Now.instant().add({
    seconds: validitySeconds
  }).subtract({
    minutes: 1
  });
  const authorization = await requestAuthorization({
    access: {
      valid_until: timestamp(validUntil),
      balances: true,
      transactions: true
    },
    aspsp: {
      name: bank,
      country
    },
    state,
    redirect_url: callback,
    psu_type: "personal",
    language: "en"
  });

  await insertAuthorization({
    id: randomUUID(),
    bank,
    country,
    stateHash: hash(state),
    browserHash: hash(browser),
    authorizationId: authorization.authorization_id,
    targetAccountId: accountId ?? null,
    actor
  });

  return {
    url: authorization.url,
    browser,
    secure: new URL(callback).protocol === "https:"
  };
}
