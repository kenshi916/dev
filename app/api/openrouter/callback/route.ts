import {
  AppError,
  decrypt,
  external,
  setSecret,
  userId,
} from "../../../server/core";
export async function GET(request: Request) {
  const url = new URL(request.url);
  let location = "/?connected=openrouter";
  try {
    const owner = await userId();
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("dev_pkce="))
      ?.slice(9);
    if (!cookie)
      throw new AppError("OpenRouter connection expired. Try again.");
    const session = JSON.parse(
      await decrypt(decodeURIComponent(cookie), owner + ":oauth"),
    );
    if (
      session.expires < Date.now() ||
      session.state !== url.searchParams.get("state")
    )
      throw new AppError("Connection verification failed.");
    const code = url.searchParams.get("code");
    if (!code)
      throw new AppError("OpenRouter did not authorize this connection.");
    const r = await external(
      "https://openrouter.ai/api/v1/auth/keys",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          code_verifier: session.verifier,
          code_challenge_method: "S256",
        }),
      },
      "OpenRouter",
    );
    const d: any = await r.json();
    if (!d.key) throw new AppError("OpenRouter did not return a key.");
    await setSecret(owner, "openrouter", d.key);
  } catch (e) {
    location =
      "/?connection_error=" +
      encodeURIComponent(
        e instanceof AppError ? e.message : "OpenRouter connection failed.",
      );
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie":
        "dev_pkce=; HttpOnly; SameSite=Lax; Path=/api/openrouter; Max-Age=0",
      "Cache-Control": "no-store",
    },
  });
}
