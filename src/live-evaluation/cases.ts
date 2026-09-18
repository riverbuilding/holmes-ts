import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const TEST_CASE_FILENAME = "test_case.yaml";
const ALLOWED_KEYS = new Set(["user_prompt", "expected_output", "before_test", "after_test", "tags"]);

export interface LiveEvaluationCase {
  readonly id: string;
  readonly folder: string;
  readonly userPrompt: string;
  readonly expectedOutput: readonly string[];
  readonly beforeTest: string;
  readonly afterTest: string;
  readonly tags: readonly string[];
}

export function loadLiveEvaluationCases(root: string = liveEvaluationCasesRoot()): readonly LiveEvaluationCase[] {
  const cases: LiveEvaluationCase[] = [];
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  for (const id of directories) {
    const folder = `${root}/${id}`;
    cases.push(...expandPrompts(id, folder, parseCase(`${folder}/${TEST_CASE_FILENAME}`)));
  }

  if (cases.length === 0) throw new Error("No live evaluation cases were found.");
  return cases;
}

export function liveEvaluationCase(id: string): LiveEvaluationCase {
  const testCase = loadLiveEvaluationCases().find((candidate) => candidate.id === id);
  if (testCase === undefined) throw new Error(`No live evaluation case is defined for ${id}.`);
  return testCase;
}

function liveEvaluationCasesRoot(): string {
  return fileURLToPath(new URL("../../tests/llm/fixtures/test_ask_holmes/", import.meta.url));
}

function parseCase(filename: string): CaseDocument {
  const document = parseDocument(readFileSync(filename, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`Live evaluation case is invalid YAML: ${filename}`);
  const value = document.toJS();
  if (!isRecord(value)) throw new Error(`Live evaluation case is invalid: ${filename}`);
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`Live evaluation case has an unknown field (${key}): ${filename}`);
  }

  const userPrompt = strings(value.user_prompt);
  const expectedOutput = strings(value.expected_output);
  const beforeTest = string(value.before_test);
  const afterTest = string(value.after_test);
  const tags = value.tags === undefined ? [] : stringList(value.tags);
  if (userPrompt === undefined || expectedOutput === undefined || beforeTest === undefined || afterTest === undefined || tags === undefined) {
    throw new Error(`Live evaluation case is invalid: ${filename}`);
  }
  return { userPrompt, expectedOutput, beforeTest, afterTest, tags };
}

function expandPrompts(id: string, folder: string, document: CaseDocument): LiveEvaluationCase[] {
  return document.userPrompt.map((userPrompt, index) => ({
    id: document.userPrompt.length === 1 ? id : `${id}[${index}]`,
    folder,
    userPrompt,
    expectedOutput: document.expectedOutput,
    beforeTest: document.beforeTest,
    afterTest: document.afterTest,
    tags: document.tags
  }));
}

function strings(value: unknown): readonly string[] | undefined {
  return typeof value === "string" ? (nonBlank(value) ? [value] : undefined) : stringList(value);
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(nonBlank) ? [...value] : undefined;
}

function string(value: unknown): string | undefined {
  return nonBlank(value) ? value : undefined;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface CaseDocument {
  readonly userPrompt: readonly string[];
  readonly expectedOutput: readonly string[];
  readonly beforeTest: string;
  readonly afterTest: string;
  readonly tags: readonly string[];
}
