import type { InvestigationProvider } from "../core/investigate.js";

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type LlmProvider = InvestigationProvider;
