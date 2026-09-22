# Portable release status

Public preview: `0.2.0-rc.1`. Prepared and authorized for GitHub publication on 2026-09-21. Repository: [thebeefasaurusrex/teamloop](https://github.com/thebeefasaurusrex/teamloop).

## Included

Portable configuration, a role-based recommendation router, a typed multi-review execution plan, the derivative Node runner, a self-contained Codex skill installer, disabled-by-default live adapters, no-account demo, software regression tests, and a model-neutral evaluation kit.

The separate [brand reference kit](../brand/README.md) includes the selected identity, logo exports, fonts, usage rules and copy-ready AI briefs. Its font and artwork notes are distinct from the software license. The release includes 74 explicitly allowlisted files, not the private installation or its history.

The historical personal model roster and historical evaluation results are not runtime defaults. The field-study website is linked as an example of the method, not packaged as proof of compatibility or a recommended universal ranking.

## Verified locally

Windows with Node.js 22.18.0: 84 local software tests passed. They cover packet integrity, stale evidence, path exclusions, provider response parsing, forbidden tool events, timeouts, cancellation, output limits, explicit configuration, per-provider attempt budgets, isolated installation, overwrite refusal, typed plan validation, dependency scheduling, provider serialization, transitive failure propagation, unexpected scheduler recovery, lifecycle events, and the plan CLI. Release-check tests cover allowed binary signatures, invalid signatures, unsupported non-UTF8 input and continued text credential screening. Binary signature checks do not validate an entire image/font format or prove an asset has no sensitive content. The demo exercises an actual local child-process round trip through a typed plan with a deterministic fixture. It makes no model or account calls.

An independent reviewer installed a disposable copy and exercised route, prepare, run, status and the attempt cap. Their initial findings led to corrections for missing model identity, raw metadata screening, frozen image transport and interrupted-run handling. A fresh independent install confirmed the original four findings were resolved. Its remaining status-listing issue was repaired and covered by a regression test. These are software release checks, not additional model-evaluation outcomes.

For this preview, a bounded Gemini Flash High static review found a transitive required-failure propagation defect and a stranded-running recovery risk. Both were reproduced in source, repaired, and covered by focused regression tests. A parallel Claude Sonnet review timed out with no result and was not retried or replaced. These runs reviewed the software; they did not create new benchmark scores or roster evidence.

## Not verified in this release task

No fresh live Codex or NVIDIA model calls were used for publication checks. One Gemini review completed; one Claude review timed out with no result. No model-provider account login or billing setting was changed. Live adapters were extracted from a personal implementation and remain version-sensitive previews. They have protocol fixtures but still require an opt-in compatibility smoke test on each adopter's environment.

No macOS/Linux test execution has been claimed. No universal process sandbox, penetration-test certification, provider-terms approval, unlimited subscription use, token savings percentage, or model-quality ranking is implied.

The existing personal skill/runtime was not modified. The public repository uses the author's personal account and fresh Git history. Apache 2.0, attribution, final identity and publication are approved. The portable installer includes LICENSE and NOTICE in new installations. Publication checks are not a legal determination of ownership or an employer-IP review.

## Recovery behavior

Status JSON is published by temporary file plus rename. An interrupted directory with no status is ignored during budget enumeration because this runner writes its first status before authenticating or dispatching. An existing malformed status instead fails closed with a reconciliation message. Reconcile that one record against retained logs before recovery; do not delete spending evidence to unblock another attempt. This is intentional caution, not automatic corruption repair.

Plan runs retain a frozen plan snapshot, atomically updated status and an append-only lifecycle event file. Required stage failures cancel their dependents and fail the plan. Advisory failures remain visible while independent or downstream work may continue. The runner never retries or substitutes a failed stage automatically.
