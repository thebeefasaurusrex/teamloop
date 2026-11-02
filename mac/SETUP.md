# TeamLoop Mac setup and troubleshooting

Use an Apple Silicon Mac running macOS 14 or later. This development preview is ad-hoc signed and is not notarized. Verify the download source and its published checksum before opening it. General Apple instructions are at [Safely open apps on your Mac](https://support.apple.com/en-us/102445).

## Open the complete application

1. Download the complete development ZIP from this repository's release, rather than individual files inside an archive preview.
2. Extract it with Finder's built-in Archive Utility.
3. Move **TeamLoop.app** to **Applications** and open it there. Finder may hide the `.app` extension; its Kind should be Application.

`Contents/MacOS/TeamLoopMac` is an internal executable. It is not the application users should open directly. Repeatedly extracting the archive creates numbered copies and makes it harder to identify which app received a security exception.

If macOS says Apple could not verify the app, that is a verification warning, not proof of safety or a positive malware diagnosis. For a verified, trusted development download, Apple documents an app-specific **System Settings > Privacy & Security > Open Anyway** exception after an opening attempt. Do not disable Gatekeeper globally or use blanket quarantine-removal commands. A different warning about detected malware, revoked authorization or a damaged app needs separate investigation.

## Connect one provider first

Open Setup. Install and sign into one supported official provider CLI using the account intended for that provider. Purchases, passwords, MFA and OAuth stay in the provider's own flow. If already subscribed, use the existing-plan path. Prices shown by setup are dated guidance; official checkout and account entitlement remain authoritative.

Some installers finish with a prompt such as `Start Codex now? [y/N]`. Type `y` and Return only while that prompt is active. A later shell prompt ending in `%` or `$` expects a command; typing `y` there produces a harmless command-not-found error. If installation changed the shell's PATH, open a new Terminal window before running the installed command.

Refresh connections in TeamLoop and inspect the reported state. A checked progress box, installed CLI, browser sign-in or selected model label is not independently proof that a real model task will succeed. Start with one tiny public or synthetic text task before adding a second reviewer.

Enable monitoring only for providers you intend to connect. DeepSeek and NVIDIA API credentials are optional, not requirements for using subscription tools. They have different billing and metering semantics.

## Keep the interfaces separate

The TeamLoop native app, a provider CLI, the ChatGPT/Codex desktop app and Codex Cloud in a browser are separate surfaces. A web screen asking for GitHub repositories and a cloud environment is not a local project-folder selector.

For local Codex desktop work, open the installed desktop application and attach only the folder needed for that task. Installing the CLI does not install the graphical desktop application. Current setup guidance is in the [official desktop documentation](https://learn.chatgpt.com/docs/app) and [local-project documentation](https://learn.chatgpt.com/docs/projects?surface=app). Do not select an entire disk merely to inspect a downloaded installer.

## Verify the result

- Compare available usage meters with the provider's own current account display. Unknown or identity-unverified is not zero usage.
- Allow local notifications and verify actual delivery. Accepting a notification request is not a delivery test.
- If using email, provision and pair the fixed-recipient relay, send an explicit test and check the recipient's inbox. Relay acceptance alone is not proof of arrival.
- Check monitor behavior after display sleep, deliberate sleep/wake, login and app quit. The app cannot monitor while the computer is off.
- Verify a complete small task, its selected model, review outputs and final synthesis before treating the team as connected.

When reporting a failure, name the app/window, its last visible prompt and the exact error. Redact account details, prompts, personal file lists and credentials from screenshots. Use safe diagnostics where possible.
