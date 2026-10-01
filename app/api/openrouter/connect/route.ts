import { encrypt, fail, userId } from "../../../server/core";
export async function GET(request: Request) {
  try {
    const owner = await userId(),
      origin = new URL(request.url).origin;
    const verifier = Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString("base64url"),
      state = crypto.randomUUID();
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");
    const callback = origin + "/api/openrouter/callback?state=" + state;
    const url =
      "https://openrouter.ai/auth?" +
      new URLSearchParams({
        callback_url: callback,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
    const cookie = await encrypt(
      JSON.stringify({ verifier, state, expires: Date.now() + 600000 }),
      owner + ":oauth",
    );
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Set-Cookie":
          "dev_pkce=" +
          encodeURIComponent(cookie) +
          "; HttpOnly; SameSite=Lax; Path=/api/openrouter; Max-Age=600" +
          (origin.startsWith("https:") ? "; Secure" : ""),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
