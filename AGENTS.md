# Contribution guidance

## Scope discipline

- Change code only to satisfy the current requested task and its directly
  necessary tests.
- Do not add fields, parameters, abstractions, dependency injection points, or
  wiring solely for a possible future slice. Add them when the current slice
  has a concrete consumer.
- Prefer the smallest complete change. If future work would benefit from a
  design choice, record it in the relevant plan or issue rather than adding
  dormant production code.
- Remove accidental speculative code discovered during review unless it is
  required by an explicitly accepted current requirement.
- Preserve existing user changes. Do not reformat, revert, or clean up
  unrelated files.
- When adding behavior to an existing block, preserve the formatting and line
  layout of the pre-existing code. Do not collapse, expand, reorder, or
  otherwise restyle existing statements unless the current change requires it
  for correctness.
- Keep formatting-only changes out of feature diffs. If formatting is required
  by an established formatter, isolate it in a separate, explicitly requested
  change.

## Comments

- Do not add comments unless they are necessary to explain a non-obvious
  decision, safety constraint, or behavior introduced by the current change.
- Do not add speculative comments for anticipated future work.
- Do not edit, expand, move, or remove comments attached to existing code
  unless that code is part of the current requested change and its comment has
  become inaccurate.

## Readability and formatting

- Write production and test code in a readable multi-line style. Do not compress
  functions, branches, loops, object literals, or error handling into dense
  one-line statements merely to reduce line count.
- Use line breaks and local variables to make validation, control flow, and
  side effects easy to review. A short single-line guard or return is fine when
  it remains immediately clear.
- Apply these rules to newly written code and to code touched by the current
  task; do not reformat unrelated code solely for style.

## TypeScript practices

- Keep `strict` TypeScript intact. Do not weaken compiler options or use
  `any`, unsafe casts, or non-null assertions to bypass a type error when a
  sound type or runtime check is practical.
- Use `import type` for type-only imports and retain the project's `.js`
  relative import specifiers under `NodeNext` module resolution.
- Keep public contracts narrow and explicit. Prefer discriminated unions for
  state/result variants and readonly inputs where mutation is not required.
- Validate untrusted data at boundaries (CLI arguments, environment values,
  provider responses, process output) before it reaches core logic.
- Keep side effects injectable when deterministic tests need control, but do
  not introduce an injection seam without a current test or runtime use.
- Keep process, network, filesystem, and rendering concerns at their existing
  boundaries; avoid leaking raw external output into user-facing errors or
  provider-visible evidence.

## Verification

- Add or update focused deterministic tests with each behavioral change.
- Run `npm run check` and the relevant test suite before handing off. Run
  `npm test` when the change can affect build output or cross-module behavior.
- Use `git diff --check` before completion.
