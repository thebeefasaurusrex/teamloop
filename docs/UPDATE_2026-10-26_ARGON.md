# October 26, 2026: Argon review trials and the final-watch correction

GPT-6.1 Sol Medium remains the operator-selected TeamLoop lead. Opus 5.5 High keeps selected design/architecture work and Sonnet 5.5 High keeps critique and selected synthesis. Argon Medium is a candidate for selected bounded text reviews, not an automatic replacement for Flash, either Claude specialist, or the lead. The canonical production Argon allowlist is not promoted by this evidence release.

## Three current-work trials

Argon Medium and Flash High reviewed three actual TeamLoop work products frozen at public commit `ec9ae370463f3f02f51aa0d301d1fd9795176fa0`: receipt/capture implementation, public evidence claims, and Gemini completion compatibility. Each pair received the same selected sources, schema, operational-tools-off contract and 15-minute deadline. The lead's baseline was frozen before external responses. These are current-work review trials, not another replay of the original design benchmark.

Preparation initially refused a synthetic credential-screening fixture before any inference. A declared amendment replaced that full unit-test file with the verbatim shared EOF-fixture excerpt, lines 1-57, for both workers. Other selected inputs stayed unchanged. This exclusion avoids sending secret-shaped test strings; it is not a secret-scanning bypass or a difference between the paired workers.

| Task | Argon Medium | Flash High | Argon / Flash elapsed |
| --- | ---: | ---: | ---: |
| Receipt runtime | 100 | Failed, unscored | 54.159s / 198.106s |
| Public claims | 97 | 59 | 43.055s / 224.894s |
| Gemini completion | 81 | 52 | 45.999s / 176.641s |

All three Argon attempts and two Flash attempts completed. The receipt control ended on native `INTERNAL` HTTP 500. Its early authentication classification came from a heuristic contaminated by unrelated startup OAuth logging, not the terminal failure. A fresh read-only preflight established readiness before only the four still-unattempted cells resumed within the original six-call plan. The failed receipt control stayed failed. No retry, repair, replacement attempt, provider substitution or paid fallback was used; the CLI's advertised retry did not execute before the guard stopped that attempt.

Five delivered reviews received identity-masked, task-specific utility judgments, then source-backed lead adjudication. Argon won both delivered paired comparisons. There is no three-to-zero quality claim: Flash's failed receipt attempt has no quality score. A 100 on an accurate receipt review is useful approval under this packet and rubric, not a production-readiness certificate. See the [six-row current-work export](../evals/results/argon-field-trials-2026-10-26.csv).

## A finding that changed the code

Argon's completion review identified a real final-watch gap: a child can write a watched safety warning and exit before the next periodic read observes it. Offline reproduction succeeded against both public and installed process helpers, in approximately 112 and 109 milliseconds. This is an engineering defect in observation timing, not proof that any live paid fallback, actual tool escape or model-permission failure happened.

The process-helper correction waits for an outstanding watch check and performs a final watched-file read before publishing child completion. Each watch/cancellation filesystem probe has a 1,000-millisecond deadline. Existing stop precedence remains authoritative and final checks do not kill a process after it has already exited. Regression fixtures cover the correction. The correction is installed in the actual TeamLoop runtime. All 149 public tests, nine additional independent checks, four installed private watch checks and 11 installed shared-helper checks passed. The model-quality scores describe the frozen pre-change inputs.

Other protocol and array-shape claims were not adopted merely because a reviewer proposed them. A task-local documentation correction describes the existing completion authority without introducing an unnecessary deep-equality requirement. Findings remain hypotheses until checked against the actual contract.

## Antigravity compatibility boundary

CLI 1.4.7 warns that the configured `unsandboxed` deny spelling is invalid and ignores that rule. Ignoring an invalid denial does not grant a permission, but the configuration cannot be described as seven effective native denials. The existing operational-event guard and other explicit settings remain in place; no permission was broadened, no universal OS sandbox was established, and schema-only `finish` remains distinct from operational tools. This is a compatibility limitation to track, not a reason to weaken guards.

## Earlier frozen text comparison

The preceding nine-primary screen used GPT-6.1 Sol High, Argon Medium and Flash High on identical systems, migration and synthesis evidence. The original systems task retained 45 minutes; the separate October 24 short screens retained six minutes. Native effort labels are not equal compute. These scores retain their original rubrics and are not pooled with the current-work utility scores.

| Configuration | Migration | Synthesis | Systems /100 | Systems elapsed |
| --- | --- | --- | ---: | ---: |
| GPT-6.1 Sol High | 5/5 targets | 8/8 targets | 87 | 124.974s |
| Argon Medium | 5/5 targets | 8/8 targets | 61 | 66.650s |
| Flash High | 5/5, with an overstatement | 7 full, 1 partial | 39 | 350.950s |

Both Gemini systems responses asserted supplied Host files were missing and treated explicitly forbidden nested behavior as a demonstrated failure. All three missed the authoritative queue handler. Both saved Gemini prompts were byte-identical 452,842-byte inputs containing all 12 complete selected sources; native logs showed no truncation warning. Outgoing Google request bodies and backend-attended context were not captured, so token ratios cannot prove or exclude downstream truncation. The cause of the missing-source assertions remains unknown. See the [nine-row screen export](../evals/results/argon-text-screen-2026-10-26.csv).

The earlier NVIDIA branch stopped at its sole Super VL image/schema canary after the missing-or-mismatched returned-model guard fired. The native identity value was not retained, leaving missing field, alias and wrong model unresolved. Four scored Super/Ultra/Muse calls stayed held. There is no NVIDIA quality result, known token usage or verified new Muse checkpoint in that cohort.

## What TeamLoop will do

Keep 6.1 accountable for scope, integration and verification. Argon supplied useful bounded reviews and one reproduced novel implementation finding, earning continued selected-review consideration. It also overstated some protocol/fallback risks. Neither these small trials nor faster observed completion justify a broad automatic Flash replacement, lead change, image/video claim or unattended authority. Policy remains `1.13.0`; pinned Opus/Sonnet roles remain unchanged. Experimental Argon evaluation support is not a shipped production capability.

One attempt per configuration/task and AI-assisted masked judgments do not establish statistical stability, human ratification or model-only superiority. Provider identity was checked through CLI initialization, not independent backend provenance. Target coverage does not certify every recommendation. Latency is an observation; lead labor, per-model subscription quota and cash savings were not measured. Provider-reported reasoning/cached counts are subsets where labeled, and worker exports exclude supervision and grading overhead. No historical score was rewritten.

This was my personal experiment, not an official Glean benchmark.
