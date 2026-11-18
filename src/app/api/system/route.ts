import { bad, handle, loadSystem, oneOf, readJson, systemAction } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => Response.json(await loadSystem()));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const action = oneOf(body?.action, ["refresh", "clear-history"] as const);
    if (!action) return bad("Choose whether to refresh the readings or clear the activity history.");
    await systemAction(action);
    return Response.json({ ok: true, action });
  });
}
