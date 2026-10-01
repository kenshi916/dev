import { body, fail, userId } from "../../server/core";
import { readWalletLive, refreshWalletLive } from "../../server/wallet-live";
export async function GET() {
  try { return Response.json(await readWalletLive(await userId()), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try { const owner = await userId(); await body(request); return Response.json(await refreshWalletLive(owner), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return fail(error); }
}
