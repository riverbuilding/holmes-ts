import { writeFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";
import { runFixtureEvaluation, serializeEvaluationReport, validateReportDestination } from "./runner.js";

export interface EvaluationArguments {
  readonly runs: number;
  readonly report: string;
}

export function parseEvaluationArguments(arguments_: readonly string[]): EvaluationArguments {
  let runs = 5;
  let report: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if ((flag === "--runs" || flag === "--report") && value === undefined) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--runs") runs = Number(value);
    else if (flag === "--report") report = value;
    else throw new Error("Usage: evaluate:fixtures --runs <positive integer> --report <docs/evaluations/path>.");
    index += 1;
  }
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer.");
  if (report === undefined) throw new Error("--report must be supplied.");
  return { runs, report: validateReportDestination(report) };
}

async function main(): Promise<void> {
  const arguments_ = parseEvaluationArguments(process.argv.slice(2));
  const config = loadConfig();
  const report = await runFixtureEvaluation(arguments_.runs, {
    provider: new OpenAiCompatibleProvider(config.provider),
    model: config.provider.model
  });
  await writeFile(arguments_.report, serializeEvaluationReport(report), "utf8");
  console.log(`Fixture evaluation report written to ${arguments_.report}`);
}

if (process.argv[1]?.endsWith("evaluation/cli.js") || process.argv[1]?.endsWith("evaluation/cli.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
