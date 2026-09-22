# Operating TeamLoop

## Installation and configuration

The repository installer copies this skill, its reference, and its Node runner into one self-contained folder. It refuses to overwrite any existing skill. Installing does not log in, call a model, edit provider settings, or start a service. Node.js 22 or newer is required. The release has no npm runtime dependencies.

Create a private copy of `config/providers.example.json` with a filename ending in `.local.json`. Relative paths resolve from that file's directory. Task roots resolve from their task-spec file's directory. All real providers start disabled. Keep configuration, credential files, task packets, run logs and model output out of public repositories.

Each enabled provider must have a model allowlist. A model entry looks like `"your-verified-model-id": {"efforts":["default","high"],"imageInput":false}`. Those are examples, not a claim that a particular model accepts those efforts. Verify IDs, effort labels, CLI flags, billing and image support against your installed provider version. Optional `resolvedModels` is a list of accepted provider-reported model IDs; if set, missing or different reports fail the run. Without it, reported identity is recorded but not guaranteed to match an alias. Codex's current decoder can return unknown actual model identity.

Only the four included transport implementations are recognized: Codex CLI, Claude Code CLI, Gemini through Antigravity CLI, and NVIDIA's API. Model IDs and role assignments are configuration. A new transport requires code and tests, not just a new roster row. These adapters are a preview of a working local implementation, not a universal CLI compatibility promise.

Configure actual executable paths when command discovery is ambiguous. On Windows, `.cmd` and `.bat` shims are not automatically launched by this shell-free runner. Use a supported native executable; do not add a shell fallback merely to make a wrapper work.

## CLI

From the repository, use `node src/team-loop.mjs`. In an installed skill, use `node <skill-directory>/scripts/run.mjs`. Quote paths with spaces.

```
node src/team-loop.mjs prepare examples/task.json config/my.local.json
node src/team-loop.mjs run <packet.json> <provider> <model-id> <effort> config/my.local.json
node src/team-loop.mjs status config/my.local.json
node src/team-loop.mjs cancel <run-id> config/my.local.json
node src/route.mjs examples/route.json config/roster.local.json config/my.local.json
node src/team-loop.mjs plan validate <plan.json> config/my.local.json
node src/team-loop.mjs plan show <plan.json> config/my.local.json
node src/team-loop.mjs plan graph <plan.json> config/my.local.json
node src/team-loop.mjs plan run <plan.json> config/my.local.json
node src/team-loop.mjs plan status [plan-run-id] config/my.local.json
node src/team-loop.mjs mode status <config.json>
node src/team-loop.mjs mode activate <name> <RFC3339-expiry> <config.json>
node src/team-loop.mjs mode standard <config.json>
node src/team-loop.mjs build <builder-spec.json> <config.json>
```

The installed wrapper uses `route` as its first argument followed by the same three JSON paths. You supply a roster file and an availability snapshot. The example roster is intentionally incomplete. Unconfigured or unavailable workers become visible unfilled roles, not hidden calls to another model. The installed `run.mjs` wrapper also accepts `mode` and `build` as its first argument, followed by the same arguments as the repository CLI forms above.

## Execution plans

An execution plan coordinates one to sixteen already prepared review packets. It has `schemaVersion`, `taskId`, `policyVersion`, a `maxConcurrency` value from one to three, and a `stages` array. Each stage has an ID, `type: "review"`, a packet path, provider, model, optional effort, dependencies, and a `failureMode` of `required` or `advisory`.

`required` means a failed stage cancels anything that depends on it and makes the plan run fail. `advisory` preserves the failed review as evidence but allows dependent stages to proceed; the plan ends `completed_with_failures`. Independent stages continue even when another stage fails. Stages for different providers may run concurrently up to the plan ceiling. Two stages for one provider run sequentially, preserving the existing one-provider lock and attempt controls.

Plans are strict data, not scripts. Unknown fields fail validation. There is no command field, shell execution, remote import, automatic retry, provider substitution, or final-decision action. `plan validate`, `plan show`, and `plan graph` make no provider call. `plan run` delegates each stage to the same packet, account, model, timeout, transport, and attempt checks used by the existing `run` command.

The plan runner writes one NDJSON object per lifecycle event to stdout and to `plan-runs/<plan-run-id>/events.ndjson` under `stateRoot`. The same directory retains a resolved `plan.json` snapshot and atomic `status.json`. Events contain plan and stage identity, status, worker-run pointers, packet hashes returned by the worker runner, verdict labels, and sanitized failure metadata. They do not contain packet source text, prompts, raw model output, credentials, or account identities. A terminal plan run still has `leadDecisionRequired: true`.

`prepare` selects 1-16 text files up to 1 MiB each, caps the text packet at 2 MiB, and supports up to 8 explicitly named images, at most 10 MiB each and 40 MiB total. Sources are checked by hash before and after a run. Image header checks are type sanity checks, not malware scanning, OCR, or full decoding. Image transport is currently limited to Claude and NVIDIA, and must also be enabled in the specific model profile. NVIDIA has an additional 2 MiB image payload cap.

`run` receives one provider and one model. It starts one owned worker process with an isolated run directory and a sanitized environment. No shell interpolation is used. One provider lock prevents concurrent runs against the same provider in the same state directory. Separate providers can run concurrently; the lead is responsible for the overall team budget.

Worker timeout is 30 seconds to 15 minutes, bounded by the packet and the configured cap. Authentication checks and setup are outside that worker timeout. Cancellation is cooperative at the runner level and terminates the local owned process tree; it cannot guarantee a remote request stops billing immediately. The output stream limit is 2 MiB. HTML output has its own declared byte cap, default 128 KiB. Configuration caps attempts per provider and packet, including failures. A new packet hash has a new attempt budget; this is not a monthly spending limiter.

## Execution modes

Standard mode is canonical. `mode status` reports the effective mode for a given configuration. `mode activate <name> <RFC3339-expiry> <config.json>` turns on a named, time-bounded overlay; `mode standard <config.json>` returns to standard immediately. An activated mode is an expiring overlay whose state is stored under `stateRoot`, not a rewrite of routing policy: it does not add providers, models, or roles, and it does not change which transports are recognized.

Overlay state that is absent, malformed, disabled, tied to a policy that has since changed, expired, or otherwise not validated all resolve to standard rather than to some ambiguous partial state. Activation cannot exceed 31 days.

## Claude Bridge builder

`build <builder-spec.json> <config.json>` runs one Claude Bridge builder attempt against a fixed specification. The implemented builder spec fields are:

- `schemaVersion`: the spec schema version the runner validates the file against.
- `id`: a stable identifier for the task.
- `repository`: the Git worktree the builder operates on.
- `baseRevision`: the exact commit the repository's current HEAD must match before the attempt starts.
- `dataClass`: the declared sensitivity classification of the task.
- `timeoutMs`: the bounded wall-clock budget for the attempt.
- `assignment`: the task description handed to Claude.
- `requirements`: the itemized requirements Claude must satisfy.
- `constraints`: the itemized limits Claude must respect.
- `allowedFiles`: the exact set of repository-relative paths Claude may read, edit, or write.
- verification command objects: each has `command`, `args`, and `timeoutMs`, and together define the deterministic checks run after the attempt.

`repository` must be an existing Git worktree, and `baseRevision` must exactly match its current HEAD; a mismatch is rejected before any edit is attempted. The source checkout itself remains unchanged throughout: Claude works in a separate, detached worktree created under `stateRoot`, not in the checkout named by `repository`.

`allowedFiles` accepts 1 to 64 distinct repository-relative paths. Absolute paths, parent-directory traversal, glob patterns, secret-path segments, and paths outside the repository are all rejected.

Inside that detached worktree, Claude is given Read, Edit, and Write capability restricted to exactly the selected files. Shell access, glob or search tooling, web access, MCP, notebook edits, subagent spawning, commits, pushes, deployments, and any form of self-promotion are unavailable to it.

Verification is deterministic and runs outside Claude, only through the configured `verificationExecutables`; Claude does not execute its own checks. The run retains changed paths, tool paths, models, rate-limit status, verification results, the candidate patch, and hashes for lead review.

Before a builder attempt proceeds, the runner requires a recent manual Max 5x plan attestation, a usage-credits-off attestation, a normal claude.ai login, an allowed account, the configured model and effort, a matching validated builder version, and live overage telemetry showing overage is rejected and not in use.

A completed builder run still does not promote, commit, push, or deploy anything, and it does not prove correctness. The lead must inspect the candidate patch before applying it.

A failed build records its evidence and writes standard mode immediately. Operators must diagnose the failure and explicitly reactivate the mode; the runner does not silently retry.

## Access and billing gates

Use only your own authorized accounts and supported access methods. TeamLoop does not pool identities, bypass provider limits, convert subscription credentials into third-party API access, or silently buy overflow. No live calls happen during installation, demo, or tests.

For subscription transports, add exact account emails to `allowedAccounts`. These checks help prevent accidental account crossover; local login records are not a cryptographic attestation of the CLI's entire behavior. The CLI still owns its authentication. Logs record an account fingerprint, not the account email.

**Codex:** configure the executable and dedicated `codexHome`. Authenticate through the provider's normal login flow. The runner requires a ChatGPT-auth login, rejects API-key mode, and asks the CLI for a read-only, tool-disabled ephemeral run. A separate process does not join the original chat; it receives the packet.

**Claude:** configure its executable and normal subscription login. Confirm usage-credit overflow is off in the provider UI, set `claudeUsageCreditsOff` to true, and set `billingCheckedAt` to that check's ISO timestamp. That manual attestation expires after 24 hours. TeamLoop cannot independently read the billing toggle. The CLI's reported subscription type must be pro or max. Unknown flags or incompatible CLI versions should fail, not be removed to make it work.

**Gemini / Antigravity:** experimental, version-sensitive adapter. `antigravityHome` must be the OS user's `.gemini/antigravity-cli` directory. The inherited compatibility path sets `SSH_CONNECTION` in the child environment to select the CLI's file-backed consumer login instead of an IDE keyring. Set `antigravityFileLoginCompatibility` true only after verifying this behavior on your installed version. If the documented login mechanism changes, leave this adapter off until it is updated. It is not a general Google API adapter. Identity verification contacts Google's userinfo endpoint using the CLI's native access token and never logs that token.

Its `settings.json` must have `enableTelemetry:false`, `toolPermission:"strict"`, no `modelProvider` override, no enabled `useG1Credits`, and no enabled `allowNonWorkspaceAccess`. `permissions.deny` must include `read_file(*)`, `write_file(*)`, `read_url(*)`, `execute_url(*)`, `command(*)`, `unsandboxed(*)`, and `mcp(*)`. The runner checks settings but does not edit them. Explicit `node scripts/setup-gemini.mjs --install-agents config/my.local.json` installs only the two TeamLoop agent definitions. Existing conflicting definitions are never overwritten. Identity checks never create them.

**NVIDIA:** optional API transport, not part of a chat subscription. Enable only for explicitly public or synthetic evidence. `allowApiSpend:true` is a deliberate operator acknowledgement that API calls may be metered even if an account offers promotional capacity. Configure an absolute private key-file path, an allowed model ID, supported efforts, and optional `requestOptions` with `temperature`, `top_p`, and `max_tokens`. Never put the key in config or chat. No POST retry is performed; an accepted asynchronous request may be polled. Fixed provider endpoints refuse redirects.

## Failures and evidence

Each started or budget-rejected attempt gets its own run directory and `status.json`, including requested model, requested effort, packet hash, timing, completion status, error classification, and provider-reported usage where present. Unknown usage is null, not zero. These token counters are not directly comparable prices across providers. Preflight rejections before run allocation are command errors, not dispatched attempts. Capture them separately in an evaluation log.

Classifications are diagnostic labels, not final attribution of blame. Preserve malformed/truncated output and classify harness limits separately from worker quality. A transport may report a structured response but still have failed a browser test. A model may produce useful partial work but not complete a conforming delivery.

After a crash, inspect the lock's PID and run record. Do not delete a lock while its process or an owned child is running. Once you have verified no owner survives, you may remove that one stale lock and document the interrupted attempt. There is no automatic stale-lock stealing.

## Security limits

Tool restrictions and event guards reduce exposure. They are not an OS-level sandbox for every provider. A post-hoc rejected tool event cannot undo a side effect. Pilot with non-sensitive packets. A compromised local executable, malicious same-user process, or compromised provider is outside this runner's guarantees. File hashes establish consistency, not truth or authorization.

Artifact validation is a delivery-format check, not an HTML security sanitizer. Generated scripts can be malicious, and simple URL checks do not cover every exfiltration mechanism. Do not auto-open output. Inspect it, use a disposable unauthenticated sandbox, and test the actual behavior before accepting it.

Raw local provider output can still contain sensitive material despite best-effort redaction. Never publish the state directory. Share only a separately reviewed, allowlisted export. There is no automatic global memory, conversation harvesting, silent background agent, or usage dashboard in this release.
