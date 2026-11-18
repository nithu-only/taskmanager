import { bad, bulkUpdate, endProcess, findProcess, handle, oneOf, parseId, readJson } from "@/lib/server";
import { PRIORITIES } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const GONE = "That process is no longer running. It may have already ended.";

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (!id) return bad("That isn't a valid process.");
    const found = findProcess(id);
    if (!found) return bad(GONE, 404);
    return Response.json({ process: found.dto });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (!id) return bad("That isn't a valid process.");
    const body = await readJson(req);
    if (!body) return bad("The request didn't include any changes.");
    const found = findProcess(id);
    if (!found) return bad(GONE, 404);

    const status = body.status !== undefined ? oneOf(body.status, ["running", "suspended"] as const) : undefined;
    const priority = body.priority !== undefined ? oneOf(body.priority, PRIORITIES) : undefined;
    if (body.status !== undefined && !status) return bad("A process can only be suspended or resumed.");
    if (body.priority !== undefined && !priority) return bad("Choose a valid priority.");
    if (!status && !priority) {
      return bad(
        "A running program's name and description come from the program itself, so they can't be edited here. You can change its priority or suspend it.",
        400,
      );
    }

    const result = await bulkUpdate([id], { ...(status ? { status } : {}), ...(priority ? { priority } : {}) });
    if (result.kind === "protected") {
      return bad(`Access is denied. ${result.name} is a protected Windows process.`, 403);
    }
    if (result.kind === "unresponsive") {
      return bad(`${result.name} isn't responding, so it can't be suspended. End the task instead.`, 409);
    }
    if (result.kind === "not_found") return bad(GONE, 404);

    const updated = findProcess(id);
    return Response.json({ process: updated?.dto ?? found.dto });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (!id) return bad("That isn't a valid process.");
    const force = new URL(req.url).searchParams.get("force") === "1";
    const result = await endProcess(id, force);
    if (result.kind === "not_found") return bad(GONE, 404);
    if (result.kind === "protected") {
      return bad(`Access is denied. ${result.name} is a core Windows process, so Windows will not let it be ended.`, 403);
    }
    if (result.kind === "failed") return bad(result.error, 403);
    return Response.json({ endedIds: result.ids });
  });
}
