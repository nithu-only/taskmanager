import { bad, handle, oneOf, parseId, readJson, serviceAction, setServiceStartup } from "@/lib/server";
import { STARTUP_TYPES } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (!id) return bad("That isn't a valid service.");
    const body = await readJson(req);
    if (!body) return bad("The request didn't include any changes.");

    if (body.startupType !== undefined) {
      const type = oneOf(body.startupType, STARTUP_TYPES);
      if (!type) return bad("Choose a valid startup type.");
      return Response.json({ service: await setServiceStartup(id, type) });
    }

    const action = oneOf(body.action, ["start", "stop", "restart"] as const);
    if (!action) return bad("A service can only be started, stopped or restarted.");
    return Response.json({ service: await serviceAction(id, action) });
  });
}
