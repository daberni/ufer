import type { AuthContext } from "@/features/auth/server/session";
import { HttpError } from "@/lib/errors";
import { randomBytes, randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { availableBanks, bankingRequest, verifyApplication } from "@/features/banking/server/enable-banking-client";
import { hash } from "@/server/security/tokens";
import { timestamp } from "@/lib/time";
import { insertAuthorization } from "./connection-repository";

export async function connectBank(payload: unknown, actor: AuthContext) {
  const {
    bank,
    country
  } = z.object({
    bank: z.string().min(1).max(200),
    country: z.string().regex(/^[A-Z]{2}$/)
  }).parse(payload);
  const banks = await availableBanks(country);
  const selected = banks.find(item => item.name === bank && item.country === country);

  if (!selected) {
    throw new HttpError(400, "This bank is unavailable in the selected environment.");
  }

  const callback = process.env.ENABLE_BANKING_REDIRECT_URL || `${process.env.APP_URL || "http://localhost:3000"}/api/banking/callback`;
  const application = await verifyApplication();

  if (!application.redirect_urls?.includes(callback)) {
    throw new HttpError(409, "Register this exact callback URL in the Enable Banking application.");
  }

  const state = randomBytes(32).toString("base64url");
  const browser = randomBytes(32).toString("base64url");
  const validitySeconds = Math.min(Math.floor(Number(selected.maximum_consent_validity)) || 86400, 180 * 86400);
  const validUntil = Temporal.Now.instant().add({
    seconds: validitySeconds
  }).subtract({
    minutes: 1
  });
  const authorization = await bankingRequest<{
    url: string;
    authorization_id: string;
  }>("/auth", {
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

  if (new URL(authorization.url).protocol !== "https:") {
    throw new HttpError(502, "Invalid bank redirect.");
  }

  await insertAuthorization({
    id: randomUUID(),
    bank,
    country,
    stateHash: hash(state),
    browserHash: hash(browser),
    authorizationId: authorization.authorization_id,
    actor
  });

  return {
    url: authorization.url,
    browser,
    secure: new URL(callback).protocol === "https:"
  };
}
