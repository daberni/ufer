import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { editManualTransaction, readBooking, removeManualTransaction, updateTransactionCategory } from "@/features/transactions/server/transaction-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  return respond(request, async () => readBooking((await context.params).id), {
    access: "session"
  });
}

export async function PATCH(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return updateTransactionCategory(id, await readJson(request));
  });
}

export async function PUT(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return editManualTransaction(id, await readJson(request));
  });
}

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return removeManualTransaction(id);
  });
}
