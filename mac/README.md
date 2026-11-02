# TeamLoop Mac development preview

A native SwiftUI setup and menu-bar companion for text-based TeamLoop assignments and supported provider quota readings. Target: **Apple Silicon and macOS 14 or later**. Intel and universal builds are not provided. There is no measured RAM, disk-space, battery-life or performance minimum.

This is a separate Mac application, version **0.1.2 development**, inside the TeamLoop source repository. It is an **ad-hoc-signed development build, not Apple-notarized**. A successful build does not establish production readiness or working access to every provider account. See the [build field note](../docs/UPDATE_2026-11-02_MAC.md) and [setup guide](SETUP.md).

## What is implemented

- Guided provider-tool installation and official sign-in actions. Local checklist acknowledgements are separate from detected tool and connection status.
- Text tasks with one selected primary, up to two independent reviewers, and synthesis by the primary. Reference documents must be explicitly selected. Results remain in local history.
- Provider-specific usage parsing and 50%, 75% and 90% warnings for qualified reported subscription windows. Missing, stale or identity-unverified data stays unavailable. API routes do not acquire invented five-hour or weekly quotas.
- Native Keychain storage for app-owned API and alert-relay secrets. Subscription passwords and OAuth remain with official provider tools.
- Optional start-at-login and app-scoped idle-sleep prevention while monitoring or work is active. Display sleep, screen lock and deliberate sleep or shutdown remain normal.
- An optional single-device, fixed-recipient email relay. The relay needs a separately provisioned service and verified sender; it is not deployed by installing the app. Mail-service acceptance is distinct from inbox delivery.

No automatic model substitution, inference retry or API fallback is provided. Explicit API routes require public or synthetic task material. These local controls are not an account-wide spending cap or a universal OS sandbox. The Mac app's policy is separate from the portable review runner's operating policy; publishing it does not change that runner's roster.

## Build from source

Development requires macOS 14+, Apple Silicon, Xcode or its command-line tools, and Node.js 22+ for tests. From this folder:

```sh
npm test
npm run check
swift test --parallel
bash scripts/package-macos.sh
```

The package script produces `dist/TeamLoop.app` and `dist/TeamLoop-macos-arm64.zip`. It downloads a pinned native Node runtime, checks its SHA-256, bundles its license, signs the local development app ad hoc, verifies the bundle and exercises the bundled runtime/core against isolated state without provider calls. The resulting app does not require the user to install Homebrew, npm or Xcode. Its selected provider CLIs remain separate prerequisites.

For Developer ID distribution, supply your own `SIGNING_IDENTITY` and `NOTARY_PROFILE` to the script. That path still needs successful notarization, stapling, Gatekeeper assessment and separate downloaded-app acceptance. No signing identity or notarization credentials are distributed here.

The [public Mac development workflow](../.github/workflows/mac-development.yml) builds and tests the app on hosted macOS runners. A [workflow template](ci/mac-development.yml) is also included. The existing 0.1.2 development release was built on the earlier hosted Mac pipeline and checked against this public source export; its receipt records that boundary. Later public Actions artifacts are separate builds with their own receipts and checksums. Use only an explicitly labeled development download whose version and checksum match its published receipt. Do not treat an Actions upload alone as a consumer release.

The public preview has its own GitHub-based bundle/Keychain namespace. An earlier development build's app-owned saved keys are not automatically migrated. Official provider credentials remain managed by those tools; configure app-owned secrets again through the public app if needed.

## Quota and provider boundaries

Codex uses official app-server account and rate-limit reads. Claude readings use an explicitly selected [CodexBar CLI](https://github.com/steipete/CodexBar/blob/main/docs/cli.md) source with app-owned configuration; no CodexBar code is bundled. Google read-only usage commands are version-qualified. The currently qualified Google report can omit account identity, so this implementation reports identity-unverified instead of account-bound percentage warnings. Installed versions, authentication and model entitlement must be checked for each account.

Model labels are configurable defaults, not an availability guarantee. Text advisory orchestration is not full Codex desktop feature parity. The app does not scrape browser conversations, export provider token stores or infer quotas from plan names.

## Local storage and optional relay

State and private run results are stored under the current user's `Library/Application Support/TeamLoop`. Configuration and observation state use a bounded, atomic JSON store. Diagnostics contain counts and statuses rather than prompt text, task results or credentials. Secrets cross the native/core boundary through a bounded stdin pipe, not command-line arguments.

The optional [relay source](relay/server.mjs) binds to loopback behind an operator-managed HTTPS reverse proxy. Configure a dedicated device token, fixed verified sender and recipient, and durable receipt storage. Keep the mail-service credential on the server. The app does not create an email account or send a test until explicitly requested.

```text
TEAMLOOP_DEVICE_TOKEN=<unique random device token>
RESEND_API_KEY=<send-only mail-service key>
TEAMLOOP_MAIL_FROM=<verified sender>
TEAMLOOP_MAIL_TO=<paired recipient>
TEAMLOOP_RELAY_LEDGER=<private durable folder>
PORT=8787
```

## Acceptance still required

The fresh 0.1.2 hosted build passed 130 portable tests and 12 native XCTest cases; its 30 build-input files and ten bundled core modules were checked against this export. A separate assisted setup reached native application screens. Neither proves clean standard-user acceptance, an end-to-end multi-provider task, live quota accuracy, actual notification/email delivery or background sleep/login lifecycle behavior. Those remain explicit checks for this public preview.

The current Swift 5 language-mode build emits a Swift 6 migration warning around `DispatchGroup.wait` in the bridge. This source does not claim Swift 6 language-mode compatibility.

Code is covered by the repository's [Apache 2.0 license](LICENSE) and [NOTICE](NOTICE). The bundled Node runtime retains its own upstream license. Provider tools, subscriptions and credentials are not included.
