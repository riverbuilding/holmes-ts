import type { ProviderConfig } from "./llm/provider.js";

export interface AppConfig {
  provider: ProviderConfig;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = environment.LLM_API_KEY;
  const model = environment.LLM_MODEL;
  if (!apiKey || !model) throw new Error("LLM_API_KEY and LLM_MODEL must be set.");
  return { provider: { apiKey, model, baseUrl: environment.LLM_BASE_URL } };
}
