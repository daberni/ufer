import { respond } from "@/server/http/respond";
import { removeBankConnection } from "@/features/banking/server/connection-service";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;
    const retainedAccounts = new URL(request.url).searchParams.get("accounts") ?? "keep";

    if (retainedAccounts !== "keep" && retainedAccounts !== "archive") {
      throw new ValidationError("Choose whether to keep or archive the connection's accounts.");
    }

    return removeBankConnection(id, {
      archiveAccounts: retainedAccounts === "archive"
    });
  });
}
