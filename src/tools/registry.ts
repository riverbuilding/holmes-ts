import type { ToolCall, ToolDefinition, ToolExecutionResult, ToolRegistration } from "../core/types.js";

function invalidArguments(message: string): ToolExecutionResult {
  return { status: "error", code: "invalid-arguments", message, retryable: false };
}

export class ToolRegistry {
  private readonly registrations = new Map<string, ToolRegistration>();

  public register(tool: ToolRegistration): void {
    if (this.registrations.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.registrations.set(tool.name, tool);
  }

  public list(): ToolDefinition[] {
    return [...this.registrations.values()].map(({ name, description, parameters }) => ({ name, description, parameters }));
  }

  /** The sole path from a provider tool call to a tool executor. */
  public async dispatch(call: ToolCall, signal: AbortSignal): Promise<ToolExecutionResult> {
    const tool = this.registrations.get(call.name);
    if (!tool) {
      return { status: "error", code: "unknown-tool", message: `Tool '${call.name}' is unavailable.`, retryable: false };
    }
    let arguments_: unknown;
    try {
      arguments_ = tool.parseArguments(call.arguments);
    } catch (error) {
      return invalidArguments(error instanceof Error ? error.message : "Invalid tool arguments.");
    }
    try {
      return await tool.execute(arguments_, signal);
    } catch {
      return { status: "error", code: "internal", message: `Tool '${call.name}' failed.`, retryable: false };
    }
  }
}
