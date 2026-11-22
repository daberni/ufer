import { syncAccounts } from "@/features/banking/server/sync-service";
import { updatePrices } from "@/features/securities/server/price-update-service";
import { Temporal } from "temporal-polyfill";
import { respond } from "@/server/http/respond";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

/** The daily run: bank sync, then security prices. A failed or busy sync does not keep prices from updating; its error is still reported afterwards. */
async function runDailyJobs() {
  // The price update starts no new security after this point, leaving room for its last request (up to 20 s) within maxDuration.
  const deadline = Temporal.Now.instant().add({
    seconds: maxDuration - 40
  });
  const sync = await syncAccounts().then(result => ({
    result
  }), (error: unknown) => ({
    error
  }));
  const prices = await updatePrices(undefined, undefined, deadline);

  if ("error" in sync) {
    throw sync.error;
  }

  return {
    ...sync.result,
    prices
  };
}

export async function GET(request: Request) {
  return respond(request, () => runDailyJobs(), {
    access: "scheduler"
  });
}
