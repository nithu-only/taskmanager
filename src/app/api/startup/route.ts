import { addStartup, bad, handle, listStartup, oneOf, readJson, str } from "@/lib/server";
import { IMPACTS } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => Response.json({ apps: await listStartup() }));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    if (!body) return bad("The request didn't include any app details.");
    const name = str(body.name, 80);
    const command = str(body.command, 400);
    if (!name) return bad("Enter a name for the startup app.");
    if (!command) return bad("Enter the command that starts the app, for example C:\\Tools\\app.exe.");
    const apps = await addStartup({
      name,
      command,
      publisher: str(body.publisher, 120) ?? "",
      impact: oneOf(body.impact, IMPACTS) ?? "low",
    });
    return Response.json({ apps }, { status: 201 });
  });
}
