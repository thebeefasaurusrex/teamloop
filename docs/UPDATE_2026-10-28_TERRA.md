# October 28, 2026: active Terra routes move to GPT-6.1 Terra

The operator accepted replacing active local `gpt-5.6-terra` selections with **`gpt-6.1-terra` at Medium effort**, while explicitly retaining the uncertainty about included subscription savings. **GPT-6.1 Sol Medium remains TeamLoop lead.** The pinned Opus 5.5 and Sonnet 5.5 jobs, privacy boundaries, spending safeguards and deliberate promotion rules remain unchanged.

The accepted local operating policy is `1.14.0`, effective October 28, 2026. This is a current model-selection change, not a rewrite of historical tests or a claim that Terra's quality improved by a measured amount.

## What changes

New bounded Terra work uses the 6.1 pin in the installed current-model registry, relevant profiles and active routing. Historical GPT-5.6 Terra scores, old source snapshots and dated decisions remain labeled as the model actually tested. GPT-6 Sol remains excluded from active routing; this migration does not replace 6.1 Sol as accountable lead.

The public runtime resolves provider/model choices from the adopter's explicit configuration. Inspection found no active GPT-5.6 Terra literal in that generic runtime or its skills, so this release does not introduce a personal Terra default into portable code. The [sanitized October 28 operating snapshot](ACTIVE_ROUTING_2026-10-28.json) documents the author's local setup; it is not an automatic portable configuration. Package version is unchanged.

## What the matched smoke establishes

On October 27, both exact requested Terra pins completed the same small tool-free source-review packet at Medium with a 90-second deadline. Each identified the same two seeded requirements defects, proposed the correct minimal recommendations and made no claim of executing tests.

| Requested configuration | Observed review result | Elapsed | Reported input | Reported output |
| --- | --- | ---: | ---: | ---: |
| GPT-5.6 Terra Medium | Same two target defects | 9.134s | 14,499 | 202 |
| GPT-6.1 Terra Medium | Same two target defects | 6.656s | 15,670 | 193 |

These two completed calls establish that the requested new pin works on that small path. They are not a broad quality comparison, latency distribution, visual/computer-use test or a new grade for the older benchmark artifacts. The backend did not separately return an actual model identity, so exact requested CLI pins are recorded without independent backend attestation. Different reported input counts despite the same packet have no established model/system-encoding explanation here.

## Credit rates are not included subscription savings

The [official pricing page](https://learn.chatgpt.com/docs/pricing), checked October 28, lists these **Standard credit-billing rates per million tokens**:

| Configuration | Input credits | Cached-input credits | Output credits |
| --- | ---: | ---: | ---: |
| GPT-5.6 Terra | 50 | 5 | 300 |
| GPT-6.1 Terra | 25 | 1.25 | 125 |

For equal token counts, those rates are lower by 50%, 75% and approximately 58.3% respectively. They do not establish the same reductions in included subscription allowance. The official page explicitly distinguishes credit prices from included subscription usage, which also depends on task, model, context and speed.

The rounded weekly meter read 50% before and after each tiny smoke. That cannot resolve either call's actual allowance use or prove a quota-saving ratio. No credit purchase, paid API fallback or overflow was used. Credit-rate illustrations are not credits billed, cash savings, or a verified doubling of subscription capacity. The operator accepted the migration with **included subscription savings still unverified**.

## Publication and operating truth

The current roster and dated change record now distinguish the accepted Terra 6.1 pin from preserved 5.6 evidence. 6.1 Sol retains scope, integration and verification; Terra remains selected for bounded work rather than gaining unattended authority. Runtime activation and publication require cross-file validation against the same policy version, with existing rollback and failure evidence retained.

Unfinished Argon/Opus design work is outside this release and supplies no result or promotion claim here.

This was my personal experiment, not an official Glean benchmark.
