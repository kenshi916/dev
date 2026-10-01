import {
  modelLogoUrl,
  modelProvider,
  type CatalogModel,
} from "../../model-catalog";

type OpenRouterModel = {
  id?: string;
  name?: string;
  created?: number;
  supported_parameters?: string[];
};

let cache: { expires: number; models: CatalogModel[] } | undefined;
export async function GET() {
  try {
    if (cache && cache.expires > Date.now())
      return Response.json({ models: cache.models });
    const r = await fetch(
      "https://openrouter.ai/api/v1/models?supported_parameters=tools",
      { signal: AbortSignal.timeout(15000) },
    );
    if (!r.ok)
      throw new Error("OpenRouter model catalog is temporarily unavailable.");
    const body = (await r.json()) as { data?: OpenRouterModel[] };
    const models: CatalogModel[] = (Array.isArray(body.data) ? body.data : [])
      .filter(
        (m): m is OpenRouterModel & { id: string; name: string } =>
          typeof m.id === "string" &&
          typeof m.name === "string" &&
          Array.isArray(m.supported_parameters) &&
          m.supported_parameters.includes("tools"),
      )
      .map((m) => ({
        id: m.id,
        name: m.name,
        ...(typeof m.created === "number" && Number.isFinite(m.created)
          ? { created: m.created }
          : {}),
        provider: modelProvider(m.id),
        providerName: m.name.includes(":")
          ? m.name.split(":")[0].trim()
          : modelProvider(m.id),
        iconUrl: modelLogoUrl(m.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    cache = { expires: Date.now() + 300000, models };
    return Response.json({ models });
  } catch {
    return Response.json(
      { error: "OpenRouter model catalog is temporarily unavailable." },
      { status: 503 },
    );
  }
}
