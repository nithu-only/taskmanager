import { bad, deleteEvent, handle, parseId } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (!id) return bad("That isn't a valid history entry.");
    if (!deleteEvent(id)) return bad("That history entry was already removed.", 404);
    return Response.json({ ok: true });
  });
}
