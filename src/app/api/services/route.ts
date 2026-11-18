import { handle, listServices } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => Response.json({ services: await listServices() }));
}
