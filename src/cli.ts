import { loadConfig } from "./config.js";
import { DEFAULT_LIMITS } from "./core/types.js";
import { investigate } from "./core/investigate.js";
import { OpenAiCompatibleProvider } from "./llm/openai-compatible-provider.js";
import { renderResult } from "./output/render.js";
import { LOCAL_DOCKER_INVESTIGATION_SYSTEM_PROMPT } from "./prompts/local-docker-investigate.js";
import { createFixtureTools, type FixtureScenario } from "./tools/fixtures.js";
import { createDockerTools, type DockerScope } from "./tools/docker.js";
import { DockerCli, type DockerContext } from "./tools/docker-cli.js";
import { ToolRegistry } from "./tools/registry.js";

export interface AskArguments {
  question: string;
  dockerContext?: string;
  fixture?: FixtureScenario;
  verbose: boolean;
}

export type VerboseProgressEvent =
  | { readonly kind: "context-resolved"; readonly context: DockerContext }
  | { readonly kind: "tool-complete"; readonly toolName: string; readonly resourceKind: string; readonly durationMs: number; readonly completion: string; readonly truncated: boolean; readonly evidenceId?: string };

/** Formats only reviewed metadata; raw Docker output is never accepted here. */
export function formatVerboseProgress(event: VerboseProgressEvent): string {
  if (event.kind === "context-resolved") return `Docker context resolved: ${event.context}`;
  return [
    `Docker tool ${event.toolName}`,
    `resource=${event.resourceKind}`,
    `durationMs=${event.durationMs}`,
    `completion=${event.completion}`,
    `truncated=${event.truncated}`,
    ...(event.evidenceId === undefined ? [] : [`evidence=${event.evidenceId}`])
  ].join(" ");
}

function usage(): string {
  return "Usage: holmes-ts ask <question> [--docker-context <name>] [--fixture <missing-env|unavailable-image|insufficient-evidence>] [--verbose]";
}

export function parseAskArguments(arguments_: string[]): AskArguments {
  if (arguments_[0] !== "ask" || !arguments_[1]) throw new Error(usage());
  const parsed: AskArguments = { question: arguments_[1], verbose: false };
  for (let index = 2; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (flag === "--verbose") {
      parsed.verbose = true;
      continue;
    }
    if ((flag === "--docker-context" || flag === "--fixture") && !value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--docker-context") parsed.dockerContext = value;
    else if (flag === "--fixture") {
      if (!isFixtureScenario(value)) throw new Error(`Unknown fixture scenario: ${value}`);
      parsed.fixture = value;
    } else throw new Error(`Unknown argument: ${flag}`);
    index += 1;
  }
  if (parsed.fixture !== undefined && parsed.dockerContext !== undefined) {
    throw new Error("--fixture and --docker-context cannot be used together.");
  }
  return parsed;
}

function isFixtureScenario(value: string): value is FixtureScenario {
  return value === "missing-env" || value === "unavailable-image" || value === "insufficient-evidence";
}

export interface CliStartupDependencies {
  readonly dockerCli?: Pick<DockerCli, "resolveContext">;
  readonly createDockerTools?: (scope: DockerScope) => ReturnType<typeof createDockerTools>;
  readonly createFixtureTools?: (scenario: FixtureScenario) => ReturnType<typeof createFixtureTools>;
  readonly reportProgress?: (event: VerboseProgressEvent) => void;
}

/**
 * Constructs the registry only after live context resolution. Fixtures take a
 * separate branch before the Docker adapter is even consulted.
 */
export async function createAskRegistry(
  arguments_: AskArguments,
  config: ReturnType<typeof loadConfig>,
  dependencies: CliStartupDependencies = {}
): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  const fixtureFactory = dependencies.createFixtureTools ?? createFixtureTools;
  const dockerFactory = dependencies.createDockerTools ?? createDockerTools;
  let tools: ReturnType<typeof createDockerTools>;
  if (arguments_.fixture === undefined) {
    const dockerCli = dependencies.dockerCli ?? new DockerCli();
    const context = await dockerCli.resolveContext(
      arguments_.dockerContext,
      new AbortController().signal,
      config.docker.commandTimeoutMs
    );
    tools = dockerFactory({ context });
    if (arguments_.verbose) dependencies.reportProgress?.({ kind: "context-resolved", context });
  } else {
    tools = fixtureFactory(arguments_.fixture);
  }
  for (const tool of tools) registry.register(tool);
  return registry;
}

async function main(): Promise<void> {
  const arguments_ = parseAskArguments(process.argv.slice(2));
  const config = loadConfig();
  const registry = await createAskRegistry(arguments_, config, {
    reportProgress: (event) => console.error(formatVerboseProgress(event))
  });
  const result = await investigate(arguments_.question, {
    provider: new OpenAiCompatibleProvider(config.provider),
    registry,
    systemPrompt: LOCAL_DOCKER_INVESTIGATION_SYSTEM_PROMPT,
    limits: DEFAULT_LIMITS
  });
  console.log(renderResult(result));
}

if (process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
