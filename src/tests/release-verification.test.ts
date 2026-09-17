import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("release commands keep deterministic checks separate from provider and fixture workflows", () => {
  const scripts = packageScripts(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

  assert.equal(scripts.test, "npm run test:deterministic");
  assert.equal(scripts.build, "npm run clean && tsc -p tsconfig.json");
  assert.equal(scripts.clean, "rm -rf dist");
  assert.equal(scripts["test:deterministic"], "npm run build && node --test dist/**/*.test.js");
  assert.equal(scripts["test:provider"], "npm run build && node --test dist/tests/openai-compatible-provider.integration.js");
  assert.equal(scripts["evaluate:fixtures"], "npm run build && node dist/evaluation/cli.js");
});

test("sample environment contains only blank credential and runtime settings", () => {
  const sample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

  assert.match(sample, /^LLM_API_KEY=$/m);
  assert.match(sample, /^LLM_MODEL=$/m);
  assert.match(sample, /^LLM_BASE_URL=$/m);
  assert.match(sample, /^LLM_MODEL_TIMEOUT_MS=$/m);
  assert.match(sample, /^DOCKER_SUBPROCESS_TIMEOUT_MS=$/m);
});

function packageScripts(contents: string): Readonly<Record<string, string>> {
  const manifest: unknown = JSON.parse(contents);
  if (typeof manifest !== "object" || manifest === null || !("scripts" in manifest)) throw new Error("package.json must contain scripts.");

  const scripts = manifest.scripts;
  if (typeof scripts !== "object" || scripts === null) throw new Error("package.json scripts must be an object.");
  const validated: Record<string, string> = {};
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== "string") throw new Error("package.json scripts must contain string values.");
    validated[name] = value;
  }
  return validated;
}
