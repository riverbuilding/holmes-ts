import { writeFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { ProviderError, type AssistantResponse } from "../core/types.js";
import type { LlmProvider } from "../llm/provider.js";
import { chatCompletionsUrl, OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";
import { runFixtureEvaluation, serializeEvaluationReport, validateReportDestination } from "./runner.js";

export interface EvaluationArguments {
  readonly runs: number;
  readonly report: string;
  readonly verbose: boolean;
}

export function parseEvaluationArguments(arguments_: readonly string[]): EvaluationArguments {
  let runs = 1;
  let report: string | undefined;
  let verbose = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (flag === "--verbose") {
      verbose = true;
      continue;
    }
    if ((flag === "--runs" || flag === "--report") && value === undefined) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--runs") runs = Number(value);
    else if (flag === "--report") report = value;
    else throw new Error("Usage: evaluate:fixtures --runs <positive integer> --report <docs/evaluations/path> [--verbose].");
    index += 1;
  }
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer.");
  if (report === undefined) throw new Error("--report must be supplied.");
  return { runs, report: validateReportDestination(report), verbose };
}

async function main(): Promise<void> {
  const arguments_ = parseEvaluationArguments(process.argv.slice(2));
  const config = loadConfig();
  if (arguments_.verbose) {
    console.info(
      `LLM configuration ${JSON.stringify({ model: config.provider.model, baseUrl: config.provider.baseUrl, requestUrl: chatCompletionsUrl(config.provider.baseUrl) })}`
    );
  }
  const provider = new LoggingProvider(new OpenAiCompatibleProvider(config.provider), arguments_.verbose);
  const report = await runFixtureEvaluation(arguments_.runs, {
    provider,
    model: config.provider.model,
    onDiagnostic: arguments_.verbose
      ? (scenario, run, event) => {
          const prefix = `[${scenario.id} run ${run}]`;
          if (event.kind === "model-response") console.info(`${prefix} LLM response ${JSON.stringify(event.response)}`);
          else console.info(`${prefix} tool ${event.call.name} response ${JSON.stringify(event.result)}`);
        }
      : undefined
  });
  await writeFile(arguments_.report, serializeEvaluationReport(report), "utf8");
  console.log(`Fixture evaluation report written to ${arguments_.report}`);
}

class LoggingProvider implements LlmProvider {
  public constructor(
    private readonly provider: LlmProvider,
    private readonly verbose: boolean
  ) {}

  public async respond(
    messages: Parameters<LlmProvider["respond"]>[0],
    tools: Parameters<LlmProvider["respond"]>[1],
    signal: AbortSignal
  ): Promise<AssistantResponse> {
    try {
      return await this.provider.respond(messages, tools, signal);
    } catch (error: unknown) {
      if (this.verbose) console.error(`LLM failure ${JSON.stringify(providerFailureSummary(error))}`);
      throw error;
    }
  }
}

function providerFailureSummary(error: unknown): { readonly name: string; readonly code?: string; readonly status?: number; readonly message: string } {
  if (error instanceof ProviderError) {
    return { name: error.name, code: error.code, ...(error.options.status === undefined ? {} : { status: error.options.status }), message: error.message };
  }
  return { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : String(error) };
}

if (process.argv[1]?.endsWith("evaluation/cli.js") || process.argv[1]?.endsWith("evaluation/cli.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
