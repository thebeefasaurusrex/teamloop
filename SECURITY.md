# Security and privacy

TeamLoop is a local orchestration tool, not a universal sandbox or a privacy firewall. Start with public or synthetic evidence and verify your installed provider's behavior before allowing sensitive work.

## What this release does

- Keeps real providers disabled until configured; requires explicit model and account allowlists.
- Selects only named source files and images; refuses broad home/drive roots and common credential paths.
- Hashes selected evidence, validates it before and after dispatch, and checks the exact image bytes used for transport.
- Uses explicit subprocess arguments, filtered child environments, private run folders, time/output caps, cancellation, and one lock per provider.
- Requests tool-restricted workers and rejects observed tool activity, malformed output and incompatible terminal events.
- Preserves failed attempts, does not automatically retry, and does not silently switch subscriptions to paid APIs.
- Accepts only typed review stages in execution plans; rejects unknown fields, shell-shaped commands, missing dependencies, cycles, and concurrency above the documented ceiling.
- Requires explicit setup for Gemini agent definitions and refuses to overwrite conflicting files.
- Excludes personal configuration, credential files, runtime state, historical conversations and private evaluation logs from the release allowlist.

## What it does not promise

Pattern matching cannot reliably detect every secret or proprietary fact. It cannot assess privacy in screenshots. Output redaction is best effort. Raw worker logs remain private even after redaction. Do not commit or upload the state directory.

Provider CLIs run under your OS account. Their own tool restrictions and a read-only request are not equivalent to a uniform OS sandbox. A rejected event cannot undo an already executed action. Malicious or compromised executables and same-user local attackers are outside this tool's guarantees. Review CLI versions and access controls; do not weaken guards to work around incompatible flags.

Frozen packets are consistent inputs, not proof that their contents are true, authorized, harmless or immune to prompt injection. The lead must treat source material and worker output as untrusted and validate consequential claims.

HTML validation checks the delivery format and some obvious external references. It is not an active-content sanitizer. Never auto-open generated HTML in an authenticated browser. Inspect it first and test in an isolated, unauthenticated environment.

Attempt caps are per provider and packet within one state directory. They are not an account-wide spending ceiling. Different state directories or new packets have separate budgets. Availability and remaining subscription percentages are operator inputs, not centrally synchronized provider data. Remote billing may continue after a local interruption.

Execution plans coordinate existing bounded review packets. They are not a shell, scheduler, remote task importer, project editor, or substitute for lead judgment. Treat plan files as operator input and inspect the resolved plan or graph before dispatch. A valid plan proves structural consistency, not that its review assignment is wise.

The demo and tests use local synthetic fixtures without real credentials or model calls. Some tests spawn local child processes and create disposable temporary files. This is regression evidence, not a penetration test or proof of live-provider compatibility.

## Reporting a problem

Do not include keys, account identifiers, private prompts, or raw logs in a public issue. Use [private vulnerability reporting](https://github.com/thebeefasaurusrex/teamloop/security/advisories/new) for sensitive security reports. If that channel is unavailable, do not post an exploit containing sensitive information publicly; contact the maintainer through a known private channel and share a minimal sanitized reproduction.

If a secret is exposed, revoke or rotate it at its issuer. Removing it from a working file does not remove it from Git history, uploaded artifacts, caches, or logs. This release does not rotate credentials for you.
