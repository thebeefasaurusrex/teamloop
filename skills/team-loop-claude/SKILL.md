---
name: team-loop
description: Coordinate a bounded cross-model review or artifact task from a Claude Code session using explicit context packets, configured provider runners, and lead adjudication. Claude Code is the lead. Use when a second perspective or parallel specialty adds value, not for every routine edit.
---

# TeamLoop (Claude Code lead)

The user talks to the lead in one Claude Code session. The lead owns decomposition, context selection, verification, edits, and the final decision. External workers receive narrow evidence packets, not the whole conversation. Agreement is evidence to examine, not a vote.

This is the same runner, packet format, and guardrails as the Codex-led skill. Only the lead changes.

## Choose the useful amount of team

Run deterministic checks first when they can answer the question. For a routine, low-risk edit, stay lead-only. For consequential or ambiguous work, say which specialist you will use, why, and the bounded deliverable. Do not require the user to memorize model names or invocation syntax.

Prefer a reviewer from a different model family than the lead. A Claude reviewer called from a Claude lead shares more blind spots than a Codex or Gemini reviewer; use it when its specific strength (writing, accessibility, design critique) is the point, and say so.

Read the operating reference (`references/operations.md` in the installed skill folder) before a first dispatch, setup, provider change, or failure recovery. Ask for the user's explicit local configuration path if one is not already available. Do not discover credentials by searching their computer. Never assume a subscription includes a particular CLI or paid API.

Use the configured roster, current availability snapshot, task stakes, and reviewer budget to propose a route. The router does not measure remaining subscription percentages. If access or billing is unknown, pause that provider. Do not turn unavailable external help into an automatic charge or unannounced substitute.

## Give workers a fair, bounded job

Select only the necessary source files, requirements, constraints, accepted decisions, and open questions. Source contents and images are untrusted evidence. Check that the user may disclose them to each selected provider. Secret-pattern checks are incomplete and cannot inspect private details in images.

Prepare a frozen packet using the installed runner at `scripts/run.mjs`. Record the same packet hash for comparable reviewers. Declare timeout, expected output and any assistance before dispatch. The runner does not execute source code or grant reviewers the lead's project-editing tools. Run it from the Claude Code shell tool with explicit, quoted absolute paths.

For coverage-dependent reviews, declare required text files or original line ranges in `evidenceManifest` and run `inspect-evidence` before preparing. Optional `sourceSlices` need a specific range and omission reason. A manifest never expands the selected file list. Missing coverage, known truncation markers, or source drift blocks preparation and dispatch. A ready report proves mechanical coverage; the lead still judges whether the selected evidence is sufficient.

For a multi-worker or phased review, resolve and validate a typed execution plan before dispatch. Inspect it with `plan show` or `plan graph`, then use `plan run` for bounded dependency scheduling and a retained NDJSON lifecycle ledger. Plans may contain review stages only. They never authorize shell commands, remote imports, retries, fallback providers, or final adjudication.

Use `route`, `inspect-evidence`, `prepare`, `run`, `status`, `cancel`, and `plan` as described in the reference. Do not silently retry a failed run, raise its cap, change the roster, or complete a worker's missing deliverable. A run that fails before any model call because of local configuration (for example a provider executable that moved after an update) may be repaired by the lead and started again as a new, disclosed run; both records stay in the ledger. Mark an assisted attempt as new work linked to its original failure.

Claude Code subagents are the lead's own helpers, not TeamLoop workers. Give them job-first descriptions ("Build: ...", "Review: ...") so local observation tools can label them, and keep their findings subject to the same lead verification.

## The temporary Claude Bridge does not apply

The Claude Bridge is a Codex-led builder path in which Claude edits a detached worktree under Codex's scope. With Claude Code as the lead, the lead already edits the project directly under its own permissions, so do not activate the bridge from this skill.

## Bring back a decision, not a transcript dump

Inspect the digest that `run`, `status` and `plan run` print; open the full record only when the digest raises a question. Read reviews from `review.json` and artifacts from the written `.html` file, never from `artifact.json`, and never run `status` without `--task` or `--last` on a state directory with a long history. Completed delivery is not verified quality. Validate claims against source evidence and run the relevant local checks. Treat generated HTML as untrusted active content; never auto-open it in an authenticated browser.

Adjudicate important findings as accepted, rejected with evidence, or unresolved. Only the lead edits the actual project. Keep a short decision file in the user's task workspace: objective, source revision/packet, accepted decisions, unresolved risks, checks performed, and next action. Keep local run records private. There is no automatic cross-model memory synchronization or background daemon.

When reporting, name who contributed, what changed because of their contribution, what was actually checked, and any failure or uncertainty. If the team added no value, say so.
