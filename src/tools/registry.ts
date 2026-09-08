import type { ToolDefinition } from "../core/types.js";

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  public register(tool: ToolDefinition): void {
    if (this.definitions.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.definitions.set(tool.name, tool);
  }

  public list(): ToolDefinition[] {
    return [...this.definitions.values()];
  }
}
