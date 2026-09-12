# TeamLoop

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/assets/teamloop-horizontal-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="brand/assets/teamloop-horizontal-light.png">
  <img src="brand/assets/teamloop-horizontal-light.png" alt="TeamLoop: Assembly Cinch symbol and Arcade wordmark" width="660">
</picture>

**One conversation. A deliberately small team. Evidence before agreement.**

TeamLoop is a local orchestration toolkit for using multiple AI subscriptions and optional specialist providers from a Codex-led workflow. It helps the lead decide when another model is worth involving, send it a focused brief, preserve what happened, and verify the useful parts before changing the project.

Created by **Mark Salisbury with Codex**. Inspired by [Claudex Loop](https://github.com/chaseai-yt/claudex-loop), implemented as a separate system. The starting question was practical: how do I use the subscriptions I already pay for without becoming the human API between three chat windows?

This is a **public preview**, extracted from a working personal setup. The portable core is tested with local fixtures. Live provider compatibility must be checked for your own account, CLI version, and platform. It is not a universal model leaderboard, a new chat app, or a claim of guaranteed token savings.

## What is it, actually?

| Part | What it does | What it is made of |
| --- | --- | --- |
| Control room | You talk to the lead; the lead owns the final decision | Your Codex conversation |
| Skill | Tells the lead how to scope, route, brief and adjudicate | A short Markdown instruction file and operating reference |
| Router | Suggests an eligible worker for each requested role | Deterministic JavaScript plus your JSON roster |
| Runner | Starts a bounded job and checks its delivery | Local Node.js scripts and provider adapters |
| Shared context | Gives reviewers the same selected evidence | Hashed JSON packets, not a hidden shared brain |
| Receipts | Keeps attempts, outputs, timings and failures | Local files, not a hosted database |

The lead does the judgment. The runner does the plumbing. Your existing provider software still performs the model call. Nothing in this repo runs continuously in the background.

```text
Your request in Codex
  -> Lead scopes the task and runs useful deterministic checks
  -> Router recommends a small team from your configured roster
  -> Runner sends a frozen evidence packet to selected workers
  -> Lead checks findings, resolves disagreements and edits the project
  -> You get the result, material contributions and verification limits
```

## Why bother?

Some jobs need a different eye. Some need a narrow code review. Some need adversarial questions before an expensive build. Others need one local test and no additional model at all.

TeamLoop supports parallel work across providers, independent verification, and smaller context handoffs. Those can improve throughput and reduce redundant reading. They can also add coordination cost. The useful test is whether the team helped finish the job better, not whether more models appeared in the transcript.

You can request a red team for any scoped task. That does not make the result correct. Each important finding still needs evidence, and the lead still has to make the call.

## Try it without accounts

Use Node.js 22 or newer. Clone this repository, open its folder, and run:

```sh
git clone https://github.com/thebeefasaurusrex/teamloop.git
cd teamloop
node --test
node scripts/demo.mjs
node scripts/check-release.mjs
```

There are **no runtime dependencies to install** and these commands make **no model or authentication calls**. The demo starts a local mock worker, freezes a real example packet, validates a structured response, and saves a run record in a printed temporary directory. It intentionally returns a blocked review: the plumbing worked, but no AI actually reviewed the task. Temporary test/demo files are retained for inspection.

## Use it from Codex

Install the self-contained skill:

```sh
node scripts/install-skill.mjs
```

By default this targets the `team-loop` folder in your Codex skills directory. **It refuses to overwrite an existing installation.** For a safe trial, use `--dest` with an explicit new folder. Load that skill in your Codex environment according to its local skill-discovery behavior. Installation does not log in or alter provider settings.

Copy `config/providers.example.json` to a private `.local.json` file and configure only the providers you intend to use. All real providers ship disabled. Add verified model IDs and reasoning efforts to their allowlists. Copy the example roster to another `.local.json` file and choose the models for your roles. Account access, remaining capacity, and subscription entitlements are not inferred from a brand name.

Then ask naturally:

> Use TeamLoop to review this feature. Run the existing checks first. Bring in an independent reviewer if the remaining risk warrants it. Keep the team to two workers, show me what they caught, and you make the final call.

On first use, give the lead your private config and roster paths. After that, you should not need a spellbook of model invocations. The exact commands, setup gates and recovery steps live in the [operating reference](skills/team-loop/references/operations.md).

## Bring your own lineup

Roles, model IDs, efforts, account allowlists, availability and run budgets are configuration. No particular model generation is the product. The example role choices are teaching examples, not performance rankings.

Included preview adapters connect to Codex CLI, Claude Code CLI, Gemini through Antigravity CLI, and NVIDIA's API. Provider-specific authentication and protocol details still require maintenance. Adding a model to a supported transport is configuration; adding a new transport requires an adapter and tests. A chat subscription does not automatically entitle you to API calls.

The lead can also use its existing local tools before dispatch. This public release does **not** install the author's whole toolbox, remote machines, personal policies, browser sessions, or private model evaluations.

## Evidence and testing

- [Field study and interactive build examples](https://frontier-model-routing-field-notes.netlify.app/): the personal experiment that informed the workflow, with limitations and attempt-level evidence.
- [Evaluation kit](evals/README.md): a reusable protocol, fresh public example, attempt format and summary script. It does not reproduce private historical prompts or import old rankings into your roster.
- `tests/`: software regression checks for the runner, configuration, routing, provider decoders and isolated installation. These are not evidence that one model is better than another.
- [Release status](docs/RELEASE_STATUS.md): what has and has not been verified in this portable edition.

## Guardrails and limits

Explicit file selection, hashes, account checks, time/output caps, restricted worker invocations, no silent retries, no automatic paid fallback, and retained failures are built into the workflow. Model context is passed deliberately, not synced by scraping your chats.

These controls are **not a universal sandbox**. Secret detection is incomplete. Images need human privacy review. Generated HTML is untrusted active content, not safe just because it passed format validation. Provider-specific restrictions may change. Raw local logs can still be sensitive. Read [SECURITY.md](SECURITY.md) before connecting real accounts.

## Project and release

The system and a reusable evaluation method belong here. The linked site carries the historical case study. Your own accounts, current model roster, raw runs and private task data stay local.

TeamLoop software is licensed under [Apache 2.0](LICENSE). Copyright 2026 Mark Salisbury. The [NOTICE](NOTICE) records the project's attribution. Distributed copies and derivatives must meet the license's notice requirements; this is not a mandatory homepage badge or a royalty arrangement.

The [brand reference kit](brand/README.md) includes logo assets, fonts, exact design values and copy-ready AI instructions. Download the folder and open `brand/index.html` for the visual guide. Font files retain their own OFL licenses; the kit's [license separation note](brand/licenses/README.md) does not grant a new public artwork or trademark license.

See [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) for provenance and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution expectations. The repository is [thebeefasaurusrex/teamloop](https://github.com/thebeefasaurusrex/teamloop). This remains a public preview, not a finished cross-platform product. See the [publication checklist](docs/PUBLISHING.md) and [release status](docs/RELEASE_STATUS.md).
