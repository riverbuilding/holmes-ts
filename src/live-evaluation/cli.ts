import { loadConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";
import { liveEvaluationCase } from "./cases.js";
import { runLiveEvaluation } from "./runner.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const result = await runLiveEvaluation(liveEvaluationCase("restart-loop"), {
    provider: new OpenAiCompatibleProvider(config.provider)
  });
  console.log(result.investigation.answer);
  console.log(`\nEvaluation: ${result.review.decision}`);
  console.log(result.review.rationale);
  if (!result.investigation.complete || result.investigation.citationValidation.invalidEvidenceIds.length > 0 || result.review.decision !== "pass") {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("live-evaluation/cli.js") || process.argv[1]?.endsWith("live-evaluation/cli.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
