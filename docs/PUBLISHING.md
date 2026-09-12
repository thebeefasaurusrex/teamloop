# Publication checklist

Public repository: [thebeefasaurusrex/teamloop](https://github.com/thebeefasaurusrex/teamloop). The owner authorized the initial public preview after selecting the identity and Apache 2.0 code license. For future releases, verify the active CLI account again before upload. Do not publish from a business or employer account by convenience.

## Decisions before upload

1. Preserve the selected name and [brand reference kit](../brand/README.md). Assembly Cinch, Anta, Arcade blue/green and the hard-shadow light treatment are selected. Earlier auditions are not release assets.
2. Apache 2.0 was approved on 2026-09-12 and is included as [LICENSE](../LICENSE), with project attribution in [NOTICE](../NOTICE) and matching package metadata. Confirm authority to release the included work, including any applicable employment/IP obligations. Choosing a license is not ownership clearance. Retain relevant notices under the license; do not invent an additional compulsory website byline.
3. Use public issues for sanitized support and private vulnerability reporting for sensitive security reports. Private reporting is enabled on this repository; verify it remains available before a release.
4. Decide whether the linked historical field-study site should remain the primary demonstration or be mirrored later. This release deliberately links to it instead of copying its private source environment.

## Validate the exact upload

Run `node --test`, `node scripts/demo.mjs`, and `node scripts/check-release.mjs` from the release folder. Validate the skill with your Codex skill tooling if available. Inspect every file in `release-files.json`. The check verifies the explicit allowlist, common secret/path patterns and relative Markdown links; it is not a complete secret audit.

Make a clean ZIP or export containing only that list, never the original working installation, raw runtime state, or a parent folder. Any archive prepared before the 2026-09-12 license update is superseded and must not be uploaded. Re-run checks from the extracted export. Keep raw test logs outside the public archive. The brand kit's reviewed verification/provenance records are explicitly allowlisted and contain no account credentials or local paths.

## Publish a release

Use the intended personal account and the established public history, never a push of the private lab. Ensure commits use the author's chosen public or GitHub-provided no-reply email. Do not set global Git identity merely to get past a commit error. Review the staged filenames and content before upload. Compare the staged tree with the allowlist, tag the intended commit, and mark release candidates as prereleases.

After upload, open the repository as an ordinary public visitor. Confirm README links, license rendering and the no-account quick start. The code supports Node 22+, but a passing Windows fixture suite does not establish live-provider or multi-platform compatibility. Keep the public-preview label until independent setup experience justifies removing it.

Only after a real public repository URL exists should the field-study site link to it. Do not insert a guessed URL, a business-account URL, or a “coming soon” link presented as a working download.

The local `package.json` remains `private:true` to prevent accidental npm publication. A GitHub release does not require an npm package or package-registry credentials.
