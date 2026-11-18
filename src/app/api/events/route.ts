import { clearEvents, handle, listEvents } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => Response.json({ events: listEvents() }));
}

export async function DELETE() {
  return handle(async () => {
    clearEvents();
    return Response.json({ ok: true });
  });
}
