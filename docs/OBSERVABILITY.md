# Local observability

TeamLoop can record exact visible text size, provider-reported usage, and selected lifecycle events. The public toolkit also provides offline reference counters, an SQLite search index, and parsers for explicitly supplied subscription observations.

## Enable journal capture on Windows

Create a private directory at the resolved LocalAppData location `TeamLoop/observability/v1`. Its owner and allow entries must be limited to your account, SYSTEM and Administrators. The runner checks the root and journal partition ACLs and refuses aliases. In your local config set `observability.enabled` to true and `observability.root` to that directory's absolute path. Set `observability.python` to an absolute Python executable with SQLite FTS5 for automatic index refresh after journal closure. Set `observability.automaticIndexing` to false to manage the index yourself. Windows is the qualified host for journal capture. The explicit index CLI can also read selected journals on other hosts with Python and FTS5.

Only selected event metadata enters the journal. Existing runner receipts and raw execution artifacts still need private storage. A missing seal or incomplete source is reflected in index coverage. Usage observations include source and scope. Intermediate and terminal reports can overlap, so they should not be summed as independent calls.

Use `python src/log-index.py search --database DATABASE --task-id TASK --limit 50` or `coverage --database DATABASE`. The default partition output is `indexes/YYYY-MM-DD.sqlite` under the configured root. For an explicit rebuild, use `build --manifest SELECTED.json --database DATABASE`. See the module's `--help` and manifest contract.

## Offline references

The supplied examples are opt-in. Copy the relevant helper directory into a private scratch folder before setup. Neither engine is a qualified tokenizer for current Claude or Antigravity aliases. TeamLoop retains the visible-input reference count separately from requested-model tokens, native usage and subscription observations.

- **Claude.** In the copied directory run `npm init -y`, then `npm install --save-exact --ignore-scripts --no-audit @anthropic-ai/tokenizer@0.0.4 tiktoken@1.0.22`. Run `node pin-engine.mjs` and use its descriptor as `observability.localTokenizers.claude`. Anthropic calls its legacy tokenizer a very rough approximation for newer models. It normalizes text with NFKC.
- **Gemini.** Use Windows x64 and Python 3.13. Run `python setup-public-assets.py` and `python pin-engine.py` from the copied directory. Setup downloads the pinned public SentencePiece wheel and Google vocabulary. The descriptor in `descriptor.local.json` goes under `observability.localTokenizers.gemini`. The reference vocabulary is associated with Gemini 2.5 Flash in Google's local tokenizer mapping. Current TeamLoop aliases remain unverified.

Try `node scripts/measure-input.mjs CONFIG PROVIDER MODEL TEXT_FILE`. Runtime sends the text to the pinned helper over stdin. The optional reference count is bounded to 1 MiB and ten seconds. A failed reference count leaves the original visible size available. Package and vocabulary downloads occur during explicit setup.

## Subscription observations and deployment scope

`src/quota-probe.mjs`, `src/claude-usage-report.mjs`, and `src/gemini-usage-report.mjs` normalize explicitly supplied observations. They preserve window, scope and unknown values. The automatic account polling and Dream Machine Control Room described in Frontier Field Notes are components of the author's private installation. This repository contains the portable measurement, journal and index code and the report parsers. The hosted Field Notes publishes the engineering record.

See the [Frontier Field Notes](https://frontier-model-routing-field-notes.netlify.app/#observability) for the one-run qualification and its limits.
