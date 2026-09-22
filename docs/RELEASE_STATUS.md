# Portable release status

Public preview: `0.2.0-rc.2`. The initial preview `0.2.0-rc.1` was prepared and authorized for GitHub publication on 2026-09-21. Repository: [thebeefasaurusrex/teamloop](https://github.com/thebeefasaurusrex/teamloop).

## Changes in rc.2

- Removed two hardcoded personal literals from the Claude Bridge builder's screening patterns and rewrote the public Git history so they do not remain in earlier commits. Configured `blockedLiterals` now cover the builder as well as review packets.
- The release check screens allowlisted text files for email addresses other than documentation placeholders and GitHub no-reply addresses.
- Every denied path, secret pattern, redaction rule, environment filter, atomic write, process runner and lock now lives once in `src/shared.mjs`. The Claude Bridge builder previously used a separate process runner that did not terminate the child's whole process tree on macOS or Linux and did not respond to interrupt signals; it now uses the same runner as the reviewer path.
- Screening failures name the pattern and the file or field that tripped them. A held provider lock reports its holder instead of a raw `EEXIST`.
- Failure classification recognizes account, subscription and attestation refusals as `authentication` before matching provider names, and reports an exhausted attempt budget as `attempt-budget`.
- Claude output decoding parses one JSON envelope or one event per line by structure rather than by the presence of a newline.
- The Claude Bridge builder prompt names the host platform from the runner instead of stating Windows, and the accepted plan attestation labels are configuration (`claudeBridge.allowedPlanAttestations`) rather than a fixed `max-5x`.
- Added GitHub Actions running the fixture suite, the demo, the release check and a Prettier formatting check on Linux, macOS and Windows with Node 22 and 24. Added `.prettierrc.json` and reformatted all code, JSON and YAML; Markdown prose and the brand kit are excluded from formatting.
- Test fixtures are removed after each test file unless `TEAMLOOP_KEEP_FIXTURES=1` is set. Six regression tests were added for the new behavior, bringing the suite to 90.

## Included

Portable configuration, a role-based recommendation router, a typed multi-review execution plan, the derivative Node runner, a self-contained Codex skill installer, disabled-by-default live adapters, no-account demo, software regression tests, and a model-neutral evaluation kit.

The separate [brand reference kit](../brand/README.md) includes the selected identity, logo exports, fonts, usage rules and copy-ready AI briefs. Its font and artwork notes are distinct from the software license. The release includes the explicitly allowlisted files in `release-files.json`, not the private installation or its history.

The historical personal model roster and historical evaluation results are not runtime defaults. The field-study website is linked as an example of the method, not packaged as proof of compatibility or a recommended universal ranking.

## Verified locally

Windows 11 with Node.js 22.18.0: 90 local software tests passed. They cover packet integrity, stale evidence, path exclusions, provider response parsing, forbidden tool events, timeouts, cancellation, output limits, explicit configuration, per-provider attempt budgets, lock contention, screening error labels, failure classification, isolated installation, overwrite refusal, typed plan validation, dependency scheduling, provider serialization, transitive failure propagation, unexpected scheduler recovery, lifecycle events, and the plan CLI. Release-check tests cover allowed binary signatures, invalid signatures, unsupported non-UTF8 input, credential screening and email screening. Binary signature checks do not validate an entire image/font format or prove an asset has no sensitive content. The demo exercises an actual local child-process round trip through a typed plan with a deterministic fixture. It makes no model or account calls.

An independent reviewer installed a disposable copy and exercised route, prepare, run, status and the attempt cap. Their initial findings led to corrections for missing model identity, raw metadata screening, frozen image transport and interrupted-run handling. A fresh independent install confirmed the original four findings were resolved. Its remaining status-listing issue was repaired and covered by a regression test. These are software release checks, not additional model-evaluation outcomes.

For the initial preview, a bounded Gemini Flash High static review found a transitive required-failure propagation defect and a stranded-running recovery risk. Both were reproduced in source, repaired, and covered by focused regression tests. A parallel Claude Sonnet review timed out with no result and was not retried or replaced. These runs reviewed the software; they did not create new benchmark scores or roster evidence.

## Provider software versions on the authoring machine

The live adapters were extracted from a personal installation and their command-line flags, output protocols and startup messages are pinned to the provider versions present when they were written. Adopters should compare against their own installed versions before enabling an adapter.

| Provider | Software present when rc.2 was prepared | Notes |
| --- | --- | --- |
| Node.js | 22.18.0 | Fixture suite, demo and release check |
| Claude Code CLI | 2.1.277 | Reviewer adapter and Claude Bridge builder flags |
| Antigravity CLI | 1.2.2 behavior referenced in `src/antigravity.mjs` | Settings sparsification workaround targets this version |
| Codex CLI | Not recorded | Record the `codex --version` output on the next live smoke test |
| NVIDIA API | HTTP protocol, no CLI | Endpoint fixed in `src/nvidia-nim.mjs` |

Presence on the authoring machine is not a claim that a fresh live call was made against that version for this release; see the next section.

## Not verified in this release task

No fresh live Codex, Claude, Gemini or NVIDIA model calls were used for rc.2 publication checks. No model-provider account login or billing setting was changed. Live adapters remain version-sensitive previews. They have protocol fixtures but still require an opt-in compatibility smoke test on each adopter's environment.

Continuous integration on macOS and Linux was added in rc.2; its first passing run on those platforms is the evidence that the portable core works there, and until that run is green, no cross-platform claim is made. No universal process sandbox, penetration-test certification, provider-terms approval, unlimited subscription use, token savings percentage, or model-quality ranking is implied.

The existing personal skill/runtime was not modified. The public repository uses the author's personal account. Apache 2.0, attribution, final identity and publication are approved. The portable installer includes LICENSE and NOTICE in new installations. Publication checks are not a legal determination of ownership or an employer-IP review.

## Recovery behavior

Status JSON is published by temporary file plus rename. An interrupted directory with no status is ignored during budget enumeration because this runner writes its first status before authenticating or dispatching. An existing malformed status instead fails closed with a reconciliation message. Reconcile that one record against retained logs before recovery; do not delete spending evidence to unblock another attempt. This is intentional caution, not automatic corruption repair.

Plan runs retain a frozen plan snapshot, atomically updated status and an append-only lifecycle event file. Required stage failures cancel their dependents and fail the plan. Advisory failures remain visible while independent or downstream work may continue. The runner never retries or substitutes a failed stage automatically.
