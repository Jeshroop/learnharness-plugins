# Map

A LearnHarness plugin that turns your learning graph into a map of ideas, and keeps the evidence that you have
mastered each one.

## What it does

- **Map view** (sidebar). Your ideas, grouped by the chat they came from and nested by which idea builds on which.
  Each idea shows a state: passed, ready to learn next, or not yet. Click an idea to see its evidence.
- **Evidence log.** When the tutor asks a question, it records which ideas were tested and how you did, in an
  append-only, hash-chained log in the plugin's data folder. A pass is computed from the log, never taken from the
  tutor's say-so.
- **The pass rule.** An idea passes when a later answer, to a different question on the same idea, is correct and
  unaided, and the log holds a quote of your own reasoning (at least three words, written before the tutor
  replied). If you got the idea right first time, you also need high confidence (90 or more) or to say so in your
  own words. A mastery estimate (Bayesian knowledge tracing) is shown beside the rule.
- **Corrections.** You can void a record from the Map view, with a reason. Voids are logged, never deleted.
- **Tutor tools.** `declare_tested`, `record_attempt`, `read_evidence` and `link_evidence` for the teaching tutor;
  the practice tutor gets the last three.

## Status

Early. The rule, the log and the views are covered by 99 tests, but the tutor tools have not yet run in a real
quiz.

Map reads the app's graph (`nodes.jsonl`, `chains.jsonl`). It also reads `relations.jsonl`, which only a modified
LearnHarness build writes: it tags worked examples as applications of a principle, so they fold under it. On the
standard app that file is absent and every idea counts as a principle; everything else works.

## Install

See the [repository README](../README.md#install-a-plugin).

## What it stores

`<plugins folder>/map/data/evidence.jsonl`: the evidence log — which ideas each question tested, how each answer
went, quotes from your answers, and voids. The plugin sends nothing anywhere.

## Licence

AGPL-3.0 — see [LICENSE](LICENSE).
