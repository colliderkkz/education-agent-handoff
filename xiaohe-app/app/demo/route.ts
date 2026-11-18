import { env } from "cloudflare:workers";
import { createDemoToken } from "../../lib/demo-identity";
import { assertSameOrigin, errorResponse } from "../../lib/server/http";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const token = await createDemoToken((env as unknown as { DEMO_SESSION_SECRET: string }).DEMO_SESSION_SECRET);
    return new Response(null, { status: 303, headers: {
      Location: "/", "Cache-Control": "no-store",
      "Set-Cookie": `__Host-xiaohe_demo=${token}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`,
    } });
  } catch (error) { return errorResponse(error); }
}
