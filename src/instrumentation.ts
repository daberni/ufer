import { applicationOrigin } from "@/server/http/origin";

// Refuses to start a production server without a valid application origin; the build has none to check.
export function register() {
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    applicationOrigin();
  }
}
