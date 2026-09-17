# Fixture evaluation reports

Run the explicit, credentialed evaluator with:

```sh
npm run evaluate:fixtures -- --runs 5 --report docs/evaluations/phase-5-fixture-evaluation-YYYY-MM-DD.json
```

It uses only committed fixture observations and never starts Docker. Reports contain hashes, tool/citation summaries, normalized optional usage, and a reviewer decision placeholder. They deliberately exclude API keys, prompts, model prose, and evidence bodies. Review each locally displayed answer against the matching typed rubric before changing `needs-review` to `pass` or `fail`.
