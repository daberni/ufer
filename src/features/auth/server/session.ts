import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { HttpError } from "@/lib/errors";

type InstallationSession = {
  authenticated: boolean;
};

export function sessionOptions(): SessionOptions {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new HttpError(503, "Configure SESSION_SECRET with at least 32 characters.");
  }

  const secure = new URL(process.env.APP_URL || "http://localhost:3000").protocol === "https:";

  return {
    password: secret,
    cookieName: secure ? "__Host-session" : "session",
    ttl: 7 * 86_400,
    cookieOptions: {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/"
    }
  };
}

export async function installationSession() {
  return getIronSession<InstallationSession>(await cookies(), sessionOptions());
}

export async function authenticated() {
  if (!process.env.APP_PASSWORD) {
    if (process.env.NODE_ENV === "production") {
      throw new HttpError(503, "APP_PASSWORD is required in production.");
    }

    return true;
  }

  const session = await installationSession();

  return session.authenticated === true;
}

export async function requireAuth() {
  if (!(await authenticated())) {
    throw new HttpError(401, "Sign in to continue.");
  }
}
