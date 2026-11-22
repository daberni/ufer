import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { deleteRule, updateRuleDetails, updateRuleEnabled } from "@/features/transactions/server/rule-application-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return updateRuleEnabled(id, await readJson(request));
  });
}

export async function PUT(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return updateRuleDetails(id, await readJson(request));
  });
}

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return deleteRule(id);
  });
}
