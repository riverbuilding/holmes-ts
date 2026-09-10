import type { ProviderConfig } from "./llm/provider.js";
import { DEFAULT_LIMITS } from "./core/types.js";

export const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_LLM_MODEL = "openrouter/free";

export interface AppConfig {
  provider: ProviderConfig;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = environment.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY must be set.");
  const model = environment.LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const baseUrl = environment.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL;
  const modelTimeoutMs = readPositiveInteger(
    environment.LLM_MODEL_TIMEOUT_MS,
    "LLM_MODEL_TIMEOUT_MS",
    DEFAULT_LIMITS.modelTimeoutMs
  );
  return { provider: { apiKey, model, baseUrl, modelTimeoutMs } };
}

function readPositiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}
