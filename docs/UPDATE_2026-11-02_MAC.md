# Building and publishing the TeamLoop Mac development preview

Published November 2, 2026. Implementation and initial hosted-build evidence date from November 1. Created by Mark Salisbury with Codex.

TeamLoop now has a separate [native Mac companion](../mac/README.md): SwiftUI for setup, settings and the menu bar, with a bundled Node core for text assignments, provider observations and durable usage warnings. The public source targets Apple Silicon and macOS 14 or later. It is a development preview, not a consumer-ready or Apple-notarized release.

The build started on a non-Mac development host. A hosted macOS runner compiled and tested the native app, assembled an arm64 application bundle, and exercised the actual bundled runtime and core together. Both the earlier version 0.1.1 build and the fresh public-source version 0.1.2 passed 130 portable tests and 12 native XCTest cases. Version 0.1.2 uses generic UI labels and a public bundle namespace. Its build inputs were compared byte for byte with the public export before publication; its exact artifact and checksum are recorded in the public receipt linked below.

## What changed

The app puts selected provider tools behind one native setup and task surface. A text assignment goes to one selected primary, up to two independent reviewers and a final synthesis. Explicit reference documents can be attached. There is no shared hidden browser history, automatic model substitution or inference retry.

Monitoring is a separate path. Qualified provider observations feed a durable 50/75/90-percent warning state, with separate local-notification and optional email-delivery status. Missing data is reported as unavailable. Google identity qualification and API-provider billing semantics prevent a convincing-looking but invented universal quota meter.

Passwords and subscription OAuth stay with official tools. App-owned API/relay secrets use Keychain and a bounded stdin pipe. Optional idle-sleep prevention belongs to the running app, and start-at-login uses macOS Service Management. The optional metadata-only relay requires its own deployment and fixed verified recipient.

These are Mac-product implementation decisions. They do not change the portable runner's model roster, historical benchmark scores or operating policy. Local fallback restrictions are not an account-wide spending cap or a universal OS sandbox.

## What the evidence supports

| Evidence | Result and boundary |
| --- | --- |
| Earlier hosted build | 130 portable tests and 12 XCTest cases passed; arm64 compilation and packaging completed. This was a hosted runner, not a hardware compatibility matrix. |
| Packaged runtime/core check | The shipped Node executable ran the shipped core against isolated state without provider calls. Downloaded archive integrity and ten bundled core modules were checked. |
| Signing | Strict/deep ad-hoc signature verification passed. Developer ID signing and notarization were not demonstrated. |
| Assisted installation | Native setup/settings screens were reached, an official provider installer reported successful CLI installation, and a task-entry launcher appeared. No completed multi-provider task or accurate live quota meter was established by those observations. |
| Public-source verification | The fresh 0.1.2 hosted build passed 130 core tests and 12 native cases. All 30 build-input files matched the public export, ten bundled core modules matched source, and archive integrity and SHA-256 were checked. A public workflow template supports subsequent builds. |

## The setup problem was more than compilation

An assisted installation exposed several boundaries that a successful CI job cannot exercise. An application bundle could be mistaken for the executable inside `Contents/MacOS`. A development build hit Gatekeeper verification. A terminal waiting for a yes/no answer could look frozen, and a browser-based cloud environment could be mistaken for the installed desktop app's local-folder workflow.

The [setup guide](../mac/SETUP.md) treats those as separate checkpoints: open the whole app, confirm its signing status, complete official tool authentication, distinguish browser/CLI/native windows, and verify one real task before adding more providers. It does not recommend globally disabling security or granting an entire disk merely to inspect an installer.

The strongest observed result is that native startup and part of onboarding worked during assisted setup. Clean standard-user acceptance, real account/model entitlement, quota accuracy, notification/email delivery, background lifecycle and a completed team task still require device acceptance. No relay deployment or live email delivery is claimed. No Intel build, RAM minimum, performance result or support for every Apple Silicon model is claimed.

## Public release boundary

Only selected source, synthetic fixtures, general setup instructions and sanitized evidence are published. Private source history, raw build logs, account information, machine identifiers, screenshots and original task material are excluded. The public source and build do not include provider sessions, paid plans, credentials or a preconfigured email recipient.

The original 0.1.2 development ZIP was produced by the existing hosted Mac pipeline, then checked against the public export. Its private build history is not republished. A separate [public Mac workflow](../.github/workflows/mac-development.yml) is now active and produces its own test evidence, archive, checksum and receipt. Its later builds do not retroactively change the provenance or checksum of the original release ZIP.

The first [public Mac build](https://github.com/thebeefasaurusrex/teamloop/actions/runs/41478174569) passed all 130 core tests, 12 native tests, packaging, strict/deep ad-hoc signature verification, archive checks and receipt generation. The separate [general CI matrix](https://github.com/thebeefasaurusrex/teamloop/actions/runs/41478174476) also passed on Windows, macOS and Linux with Node 22 and 24.

The current Swift 5 language-mode build also retains a known Swift 6 migration warning in the bridge. A download labeled development should remain labeled development until signing and actual-device release gates pass.

See [Mac source and build instructions](../mac/README.md), [setup troubleshooting](../mac/SETUP.md), the [public build receipt](../mac/verification/PUBLIC-BUILD.json), and [Frontier Field Notes](https://frontier-model-routing-field-notes.netlify.app/#mac-development-20261102).
