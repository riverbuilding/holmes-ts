# Fixture evaluation reports

Run the explicit, credentialed evaluator with:

```sh
npm run evaluate:fixtures -- --runs 1 --report docs/evaluations/phase-5-fixture-evaluation-YYYY-MM-DD.json
```

It uses only committed fixture observations and never starts Docker. Reports contain hashes, tool/citation summaries, normalized optional usage, and a reviewer decision placeholder. They deliberately exclude API keys, prompts, model prose, and evidence bodies. Review each locally displayed answer against the matching typed rubric before changing `needs-review` to `pass` or `fail`.

To diagnose an evaluation locally, append `--verbose`. It writes each model
response, requested tool call, projected fixture tool result, and safe provider
failure summary to stderr; it does not change the sanitized report. This mode
is limited to the fixture evaluator, but its transcript can still contain model
prose and fixture observations, so do not redirect it to a committed file or
use it with sensitive fixture data.
