# TeamLoop

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/assets/teamloop-horizontal-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="brand/assets/teamloop-horizontal-light.png">
  <img src="brand/assets/teamloop-horizontal-light.png" alt="TeamLoop: Assembly Cinch symbol and Arcade wordmark" width="660">
</picture>

TeamLoop is a local-first toolkit for running bounded AI reviews from Codex or Claude Code. You talk to one lead. It selects the evidence, hands a focused task to a reviewer, and checks the returned findings before acting on them.

## Try it without accounts

With Node.js 22 or newer:

```sh
git clone https://github.com/thebeefasaurusrex/teamloop.git
cd teamloop
npm run demo
```

The demo runs a fixture through a real local child process and prints the plan, event ledger, and saved review location. Expect a completed stage with a `blocked` review. The runner delivered a fixture and no model was called.

## Run your first live review

The smallest live example uses Codex CLI, an existing ChatGPT subscription login, and the bundled synthetic CSV review. See the [adapter compatibility record](docs/RELEASE_STATUS.md#adapter-compatibility) for the exact tested combination.

1. Set `CODEX_HOME` to a dedicated local directory. Use `export CODEX_HOME=/path/to/teamloop-codex` in a POSIX shell or `$env:CODEX_HOME = 'C:/path/to/teamloop-codex'` in PowerShell. Run `codex login` and choose ChatGPT sign-in. Confirm `codex login status` reports ChatGPT login.
2. Copy `config/providers.example.json` to `config/my.local.json`. Set `codexHome` to that same directory, set `providers.codex.enabled` to `true`, and put your signed-in email in `providers.codex.allowedAccounts`. The example already lists `gpt-6.1-sol` with `medium` effort. If your CLI or subscription uses a different model, update that model entry and the command below together. Use the executable name `codex` when it resolves directly, or set the top-level `codex` field to the executable's full path.
3. Prepare the packet, then replace `PACKET_PATH` with the path printed by the first command.

```sh
node src/team-loop.mjs prepare examples/task.json config/my.local.json
node src/team-loop.mjs run "PACKET_PATH" codex gpt-6.1-sol medium config/my.local.json
node src/team-loop.mjs status --task export-review config/my.local.json
```

A delivered review reports `status: completed` and a `files.review` path. Open that JSON file and verify its findings against `examples/brief.md` and `examples/export.mjs`. The runner checks delivery and packet integrity. The lead owns the judgment. If the attempt fails, start with `failureClass` in the receipt and see the [operating reference](skills/team-loop/references/operations.md) for setup and recovery.

## Use it from Codex or Claude Code

Install the skill for your lead:

```sh
node scripts/install-skill.mjs
node scripts/install-skill.mjs --host claude
```

Choose the command for your host. The installer uses that host's skills directory and refuses to overwrite an existing installation. Use `--dest` to test in a new directory. The [operating reference](skills/team-loop/references/operations.md) covers discovery and provider configuration.

Copy `config/roster.example.json` to `config/roster.local.json`, then set the model and effort for the roles you want to use. Give the lead your private config and roster paths and ask it to use TeamLoop for a focused review.

## How it works

```text
Lead scopes the task → Router proposes reviewers → Runner dispatches hashed evidence
→ Worker returns a structured review → Lead verifies findings and decides what to change
```

Typed [execution plans](skills/team-loop/references/operations.md#execution-plans) add dependencies, required or advisory stages, and bounded concurrency. The [operating reference](skills/team-loop/references/operations.md) also covers packet size limits, evidence slices, run receipts, and the temporary Claude Bridge. Preview adapters support Codex CLI, Claude Code CLI, Gemini through Antigravity CLI, and NVIDIA's API.

## Guardrails and limits

Every review starts with explicitly selected evidence, restricted provider invocations, and time and output limits. The 16-file, 1 MiB-per-file, and 2 MiB-packet caps bound evidence ingestion and disclosure. Use required evidence ranges to keep a larger review focused. The router limits each recommendation to three reviewers so each review can be adjudicated. A typed plan allows up to three concurrent stages, with one active run per provider, to bound simultaneous model calls.

Keep local config, packets, and raw receipts private. Review source and images before disclosure. Treat generated HTML as active content and use an isolated browser with network access disabled when you need an offline preview. See [SECURITY.md](SECURITY.md).

## Project and release

- [Release status and dated updates](docs/RELEASE_STATUS.md)
- [Tests, demo, release and formatting checks](.github/workflows/ci.yml)
- [Local observability](docs/OBSERVABILITY.md)
- [Apple Silicon development preview](mac/README.md)
- [Evaluation kit](evals/README.md) and [field study](https://frontier-model-routing-field-notes.netlify.app/)
- [Brand kit](brand/README.md), [contributing](CONTRIBUTING.md), and [publication checklist](docs/PUBLISHING.md)

Created by Mark Salisbury with Codex, inspired by [Claudex Loop](https://github.com/chaseai-yt/claudex-loop). See [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md), [LICENSE](LICENSE), and [NOTICE](NOTICE).
