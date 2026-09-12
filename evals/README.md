# Evaluate the workflow, not the logo

This kit is for a small, honest practitioner trial. It is not a scientifically rigorous benchmark and does not ship a recommended model ranking. The [public field notes](https://frontier-model-routing-field-notes.netlify.app/) describe the author's historical experiment. The fixtures here are new examples, not its original frozen prompts, private logs, or scores.

## Freeze the question first

Choose a task from real work that your team is authorized to share. Name the decision the result should improve: fewer missed defects, clearer designs, faster verification, or less lead-model reading. Do not start with a leaderboard and look for a task that produces one.

Write a task brief with explicit requirements, selected sources, completion conditions, known environmental limitations, and permitted tools. Freeze the packet hash, weighted rubric, time/output caps, model IDs and effort labels before comparing outputs. Use the same packet for comparable reviewers. Tasks that need materially different provider capabilities belong in separate cohorts.

Include a lead-only baseline under the same task conditions. Keep the lead's judging identity and any prior knowledge visible as a possible bias. Count the cost of briefing, orchestration, duplicate context, checking and recovery, not only the final model response.

Use the same predeclared assistance policy for everyone. If a harness error prevents delivery, preserve that original attempt. A repaired or assisted rerun gets a new ID, parent ID and cohort. Useful partial output is a salvage, not a quietly replaced failure.

## Judge observable work

Prefer requirement-level checks. For a UI, test the actual controls, keyboard path and narrow layout. For code, run relevant tests and inspect the diff. A confident explanation is not proof those checks occurred. A response that lists a test has not necessarily run it.

For subjective scoring, define anchored criteria before scoring. Example for a review: requirement coverage 40%, evidence specificity 30%, actionability 20%, and calibrated uncertainty 10%. These weights are illustrative, not a universal measure of intelligence. Describe what low, middle and high performance mean for each criterion. Keep component scores and rationale beside the final score.

If you blind evaluation, record the actual mechanism: random artifact IDs, hidden provider/configuration fields, randomized order, unavailable prior scores, and when the identity map was opened. Do not call it blind merely because the files were renamed. Style can still reveal identity.

## Attempt record

Create one JSON row per attempted configuration. Keep preflight refusals as `delivery:"not-started"`; they are visible but not silently counted as model failures. Required fields are demonstrated in `attempts.example.json`. Never replace an unknown usage count with zero. Actual model identity may be null. Failure attribution is a human judgment that should link to a log excerpt or reproduction, not just inherit the runner's keyword classification.

`score` means completed-work score in 0-100 and is null for failed/not-started attempts. Put partial-work discussion in `notes` and create a separate salvage row if you score a recovered artifact. `verification` is independent of delivery. Use `not-applicable` only when checks genuinely do not apply, not when they were skipped. `mode` and `parentAttemptId` preserve intervention history.

Keep a private extension of each row with rubric components, evidence/log paths, assistance details, browser checks, and adjudication. The public export must be separately reviewed and allowlisted. It should not include credentials, raw private prompts, account identifiers or full local paths. Do not publish hidden reasoning traces. Observable tool events, final outputs and disclosed methodology are enough.

## Reconstructable summaries

```
node evals/summarize.mjs evals/attempts.example.json
```

The provided numbers are synthetic arithmetic fixtures, not measured model results. The script groups by task, configuration and assistance mode, retains the raw outcome rows in its output, and reports:

- Dispatched attempts: completed plus failed deliveries. Not-started rows remain separately counted.
- Delivery reliability: completed deliveries / dispatched attempts.
- Completed-work mean: sum of scores / completed deliveries, only when every completed delivery has a score. Otherwise null.
- Reliability-adjusted mean: sum of completed-work scores / dispatched attempts, only when all completed work is scored. Failed deliveries contribute zero.
- Strict verified-delivery mean: only completed scores with verification `passed` contribute; all other dispatched attempts contribute zero. This deliberately penalizes unverified work and may be inappropriate where behavioral verification is not applicable. Always show the raw rows beside it.

No extra decimal places are displayed. Small samples remain small even when the arithmetic is correct. Do not compare these aggregates across different tasks, criteria or assistance modes as if they were a universal ranking.

## What would count as a useful result?

Report whether another model caught a novel, correct issue; improved an accepted design; reduced the lead's required reading; or saved total elapsed effort after coordination. Report overlap, invalid findings, integration burden, provider refusals, and cases where the lead alone was better. Tokens and time are observations, not a conversion into money unless you have the actual applicable billing information.

The decision can be “keep this specialist for a narrow task,” “use it only for a tie-breaker,” or “leave it out.” A smaller team is a legitimate win.
