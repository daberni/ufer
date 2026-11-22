import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { HttpError } from "@/lib/errors";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { allowedOrigins, applicationOrigin } from "@/server/http/origin";
import { authAccounts, authRateLimits, authSessions, authUsers, authVerifications } from "@/server/database/auth-schema";

type AuthOptions = {
  enrollment?: boolean;
  onPasswordReset?: (token: string) => void;
};

const httpHeaderName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function createAuth(db: Database | DatabaseTransaction, options: AuthOptions = {}) {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new HttpError(503, "Configure BETTER_AUTH_SECRET with at least 32 characters.");
  }

  const baseURL = applicationOrigin();
  const trustedClientAddressHeader = process.env.TRUSTED_CLIENT_IP_HEADER?.trim();

  // Better Auth reads this name through the Headers API, which throws on every request for an invalid name.
  if (trustedClientAddressHeader && !httpHeaderName.test(trustedClientAddressHeader)) {
    throw new HttpError(503, "Configure TRUSTED_CLIENT_IP_HEADER as a single HTTP header name.");
  }

  return betterAuth({
    appName: "Ufer",
    logger: {
      disabled: true
    },
    baseURL,
    secret,
    trustedOrigins: allowedOrigins(),
    database: drizzleAdapter(db, {
      provider: "sqlite",
      transaction: !options.enrollment,
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        rateLimit: authRateLimits
      }
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.enrollment,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: options.onPasswordReset ? async ({ token }) => options.onPasswordReset?.(token) : undefined
    },
    // A session ends after 24 hours without use; see docs/security.md.
    session: {
      expiresIn: 24 * 3_600,
      updateAge: 3_600,
      cookieCache: {
        enabled: false
      }
    },
    account: {
      accountLinking: {
        enabled: false
      }
    },
    advanced: {
      useSecureCookies: baseURL.startsWith("https:"),
      // Rate limits count per client only through the header the operator's proxy overwrites; any other forwarded header is ignored so it cannot create a fresh counter.
      ipAddress: {
        ipAddressHeaders: trustedClientAddressHeader ? [trustedClientAddressHeader] : []
      }
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/username": {
          window: 900,
          max: 10
        },
        "/change-password": {
          window: 900,
          max: 10
        }
      }
    },
    hooks: {
      before: createAuthMiddleware(async context => {
        if (context.path !== "/change-password") {
          return;
        }

        // A password change signs out every other session (OWASP ASVS 3.3.3), because it is often the response to a leaked password.
        // Better Auth leaves this to an optional `revokeOtherSessions` flag in the request body; setting it here enforces it for every caller, so a client cannot opt out.
        return {
          context: {
            body: {
              ...context.body,
              revokeOtherSessions: true
            }
          }
        };
      })
    },
    // Forwards a renewed session cookie from server-side session checks to the response; it must stay the last plugin.
    plugins: [username(), nextCookies()]
  });
}

type Auth = ReturnType<typeof createAuth>;

// Built once per database connection instead of per request; configuration is read when the instance is created.
const requestAuth = new WeakMap<Database, Auth>();

/** The shared Better Auth instance for request handling on the application's database connection. */
export async function authentication() {
  const db = await database();
  let auth = requestAuth.get(db);

  if (!auth) {
    auth = createAuth(db);
    requestAuth.set(db, auth);
  }

  return auth;
}
