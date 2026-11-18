import { health, handle } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const status = health();
    return Response.json(status, { status: status.ok ? 200 : 503 });
  });
}
