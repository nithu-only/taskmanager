import { bad, deleteStartup, handle, oneOf, parseId, readJson, str, updateStartup } from "@/lib/server";
import { IMPACTS } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (!id) return bad("That isn't a valid startup app.");
    const body = await readJson(req);
    if (!body) return bad("The request didn't include any changes.");

    const patch: { name?: string; command?: string; enabled?: boolean; impact?: "high" | "medium" | "low" | "none" } = {};
    if (body.name !== undefined) {
      const name = str(body.name, 80);
      if (!name) return bad("Enter a name for the startup app.");
      patch.name = name;
    }
    if (body.command !== undefined) {
      const command = str(body.command, 400);
      if (!command) return bad("Enter the command that starts the app.");
      patch.command = command;
    }
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.impact !== undefined) {
      const impact = oneOf(body.impact, IMPACTS);
      if (!impact) return bad("Choose a valid startup impact.");
      patch.impact = impact;
    }

    return Response.json({ apps: await updateStartup(id, patch) });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (!id) return bad("That isn't a valid startup app.");
    return Response.json({ ok: true, apps: await deleteStartup(id) });
  });
}
