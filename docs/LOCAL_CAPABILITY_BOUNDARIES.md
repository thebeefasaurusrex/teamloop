# Portable toolkit and local operating policy

Updated October 25, 2026. Package version remains `0.2.0-rc.2`. The author's personal operating policy is `1.12.0`, effective October 25, 2026. These version numbers describe different systems.

The [field notes](https://frontier-model-routing-field-notes.netlify.app/) report the author's local setup, experiments, and decisions. This repository is a selected portable derivative. A model's appearance in those notes does not enable it here or establish compatibility for another account.

## Included in the October 21 synchronization

- Claude Code as a supported lead: `install-skill.mjs --host claude` installs the same runner and reference with Claude Code lead instructions. Codex remains the default host.

## October 25 evidence update

The [dated results](UPDATE_2026-10-25.md) report the original benchmark replay, qualified Claude delivery failures, separate recovery pilots and matched Haiku versus 6.1 feature trial. The operator selected GPT-6.1 Sol Medium as local lead and excluded GPT-6 Sol from active routing. No automatic Haiku promotion followed. These are local operating decisions and measured historical evidence, not portable defaults or newly supported provider capabilities.

## Included in the October 12 synchronization

- Required-evidence manifests map requirement IDs to selected text files or inclusive original line ranges. Optional expected whole-file hashes catch drift. The manifest never reads an unselected file.
- Deliberate source slices retain a range, omission reason, selected hash, parent hash, and original line numbers. Preparation and dispatch check mechanical coverage. Parent-file changes outside the slice also invalidate a prepared packet.
- `inspect-evidence` returns local coverage findings without preparing a packet or making a model call. Missing files, uncovered required ranges, expected-hash drift, and recognized truncation markers fail closed. Semantic sufficiency remains the lead's decision.
- Existing compact receipts preserve reported cached, thinking, and total token fields without filling absent fields with zero. The history cap cannot hide active runs or failures in the selected scope. Unknown flags and missing status-filter values fail explicitly.

Compact receipts themselves were already present in the September 24 public baseline. This synchronization improves them; it does not count them as a newly introduced capability.

## Local capabilities excluded from the public runtime

| Local capability or decision | Public toolkit boundary |
| --- | --- |
| Frozen, classified one-time subscription availability switch | The public runner and execution plans still have no automatic retry or provider substitution. |
| Current role assignments, including GPT-6.1 Sol Medium lead, GPT-6 Sol exclusion and the DeepSeek engineering specialist | Public routing remains driven by the adopter's explicit roster. No private lineup or new provider adapter was copied. |
| Experimental file-backed benchmark recovery with shared Read/Write/Edit/Compute | Not included as a general worker mode. The public reviewer stays completion-only; Claude Bridge retains its separately bounded opt-in builder contract. No verified native Claude continuation fix is claimed. |
| Experimental Fable creative selection and returned-model identity guards | No Fable-specific dispatch route, activation flag, or compatibility claim was added. |
| Tool routing and remote deterministic worker placement | No private tool registry, worker address, remote execution integration, or machine configuration is included. |
| Local observation display (reviewer-to-lead room placement, plain activity labels, Claude Code sessions) | Not included. The display reads the author's private session records; the portable runner has no display. |
| Task-specific subscription/account attestations | No private accounts, credentials, personal paths, or billing state is included. Adopters supply and verify their own configuration. |

Portable checks do not validate fresh provider compatibility, subscription entitlement, production-model quality, semantic completeness, an entire image/font format, or a universal sandbox. Coverage manifests apply to text evidence; they do not perform OCR or assess required image regions. Source hashes prove consistency, not truth or permission to disclose.

The release allowlist controls the shipped files. Runtime state and operator settings stay private. The local model roster is historical and operational evidence, never a default public leaderboard or employer endorsement.
