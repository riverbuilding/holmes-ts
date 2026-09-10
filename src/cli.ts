import { loadConfig } from "./config.js";
import { DEFAULT_LIMITS } from "./core/types.js";
import { investigate } from "./core/investigate.js";
import { OpenAiCompatibleProvider } from "./llm/openai-compatible-provider.js";
import { renderResult } from "./output/render.js";
import { LOCAL_DOCKER_INVESTIGATION_SYSTEM_PROMPT } from "./prompts/local-docker-investigate.js";
import { createFixtureTools, type FixtureScenario } from "./tools/fixtures.js";
import { createDockerTools } from "./tools/docker.js";
import { ToolRegistry } from "./tools/registry.js";

interface AskArguments {
  question: string;
  dockerContext?: string;
  fixture?: FixtureScenario;
}

function usage(): string {
  return "Usage: holmes-ts ask <question> [--docker-context <name>] [--fixture <missing-env|unavailable-image|insufficient-evidence>]";
}

export function parseAskArguments(arguments_: string[]): AskArguments {
  if (arguments_[0] !== "ask" || !arguments_[1]) throw new Error(usage());
  const parsed: AskArguments = { question: arguments_[1] };
  for (let index = 2; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if ((flag === "--docker-context" || flag === "--fixture") && !value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--docker-context") parsed.dockerContext = value;
    else if (flag === "--fixture") {
      if (!isFixtureScenario(value)) throw new Error(`Unknown fixture scenario: ${value}`);
      parsed.fixture = value;
    } else throw new Error(`Unknown argument: ${flag}`);
    index += 1;
  }
  return parsed;
}

function isFixtureScenario(value: string): value is FixtureScenario {
  return value === "missing-env" || value === "unavailable-image" || value === "insufficient-evidence";
}

async function main(): Promise<void> {
  const arguments_ = parseAskArguments(process.argv.slice(2));
  const config = loadConfig();
  const tools = arguments_.fixture
    ? createFixtureTools(arguments_.fixture)
    : createDockerTools({ context: arguments_.dockerContext });
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
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
