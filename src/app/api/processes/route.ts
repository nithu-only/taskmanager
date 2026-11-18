import { bad, createProcess, handle, loadProcesses, parseProcessInput, readJson } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => Response.json(await loadProcesses()));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    if (!body) return bad("The request didn't include any task details.");
    const parsed = parseProcessInput(body);
    if ("error" in parsed) return bad(parsed.error);

    const created = await createProcess(parsed.data);

    // Child rows in the form are real extra programs, so they are started too.
    if (Array.isArray(body.children)) {
      for (const raw of body.children.slice(0, 10)) {
        const child = parseProcessInput(raw);
        if ("data" in child) await createProcess(child.data).catch(() => null);
      }
    }

    return Response.json({ process: created }, { status: 201 });
  });
}
