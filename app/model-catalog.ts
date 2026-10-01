// Provider images were verified on OpenRouter's public model/provider pages.
// Original URLs and page provenance: /model-icons/sources.json.
export const MODEL_PROVIDER_LOGOS: Record<string, string> = {
  "aion-labs": "/model-icons/aion-labs.png",
  amazon: "/model-icons/amazon.png",
  anthropic: "/model-icons/anthropic.svg",
  "arcee-ai": "/model-icons/arcee-ai.png",
  "bytedance-seed": "/model-icons/bytedance-seed.png",
  cohere: "/model-icons/cohere.png",
  deepseek: "/model-icons/deepseek.png",
  fireworks: "/model-icons/fireworks.png",
  google: "/model-icons/google.svg",
  inception: "/model-icons/inception.svg",
  inclusionai: "/model-icons/inclusionai.png",
  liquid: "/model-icons/liquid.png",
  meta: "/model-icons/meta.png",
  "meta-llama": "/model-icons/meta.png",
  minimax: "/model-icons/minimax.png",
  mistralai: "/model-icons/mistralai.png",
  moonshotai: "/model-icons/moonshotai.png",
  nvidia: "/model-icons/nvidia.png",
  openai: "/model-icons/openai.svg",
  openrouter: "/model-icons/openrouter.png",
  perceptron: "/model-icons/perceptron.png",
  qwen: "/model-icons/qwen.png",
  relace: "/model-icons/relace.png",
  sakana: "/model-icons/sakana.png",
  stepfun: "/model-icons/stepfun.png",
  thinkingmachines: "/model-icons/thinkingmachines.png",
  upstage: "/model-icons/upstage.png",
  "x-ai": "/model-icons/x-ai.png",
  xiaomi: "/model-icons/xiaomi.png",
  "z-ai": "/model-icons/z-ai.png",
};

export const OPENROUTER_LOGO_URL = MODEL_PROVIDER_LOGOS.openrouter;

export function modelProvider(model: string): string {
  return model.split("/")[0]?.toLowerCase() || "openrouter";
}

export function modelLogoUrl(model: string): string {
  const url = MODEL_PROVIDER_LOGOS[modelProvider(model)];
  return typeof url === "string" ? url : OPENROUTER_LOGO_URL;
}

export type CatalogModel = {
  id: string;
  name: string;
  created?: number;
  provider: string;
  providerName: string;
  iconUrl: string;
};
