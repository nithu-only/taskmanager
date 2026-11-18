import { bad, bulkEnd, bulkUpdate, handle, oneOf, readJson } from "@/lib/server";
import { PRIORITIES } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return null;
  if (!value.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)) return null;
  return [...new Set(value)] as number[];
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    if (!body) return bad("The request didn't include any changes.");
    const ids = parseIds(body.ids);
    if (!ids) return bad("Select between 1 and 200 processes.");
    const status = body.status !== undefined ? oneOf(body.status, ["running", "suspended"] as const) : undefined;
    const priority = body.priority !== undefined ? oneOf(body.priority, PRIORITIES) : undefined;
    if (body.status !== undefined && !status) return bad("A task can only be suspended or resumed.");
    if (body.priority !== undefined && !priority) return bad("Choose a valid priority.");
    if (!status && !priority) return bad("Choose a status or priority to change.");

    const result = await bulkUpdate(ids, { ...(status ? { status } : {}), ...(priority ? { priority } : {}) });
    if (result.kind === "not_found") return bad("Those tasks are no longer running. Refresh and try again.", 404);
    if (result.kind === "protected") return bad(`Access is denied. ${result.name} is a protected Windows process. No tasks were changed.`, 403);
    if (result.kind === "unresponsive") return bad(`${result.name} isn't responding and can't be suspended. No tasks were changed. End the task instead.`, 409);
    return Response.json({ updatedIds: result.ids, count: result.changed });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    if (!body) return bad("The request didn't include a selection.");
    const ids = parseIds(body.ids);
    if (!ids) return bad("Select between 1 and 200 tasks.");
    const result = await bulkEnd(ids, body.force === true);
    if (result.kind === "not_found") return bad("Those tasks are no longer running. Refresh and try again.", 404);
    if (result.kind === "protected") {
      return bad(`Access is denied. ${result.name} is a core Windows process, so Windows will not let it be ended. No tasks were changed.`, 403);
    }
    if (result.kind === "failed") return bad(result.error, 403);
    return Response.json({ endedIds: result.ids, tasks: result.tasks, skipped: result.skipped });
  });
}
