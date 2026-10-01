import { fail } from "../../server/core";
import { publicActivity } from "../../server/public-activity";

export async function GET(request: Request) {
  try {
    const kind = new URL(request.url).searchParams.get("kind");
    return Response.json({ items: await publicActivity(kind === "coin_launched" ? kind : undefined), updatedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "public, max-age=10" },
    });
  } catch (error) { return fail(error); }
}
