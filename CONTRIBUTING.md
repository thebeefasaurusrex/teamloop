# Contributing

The useful unit is a small change with a reproducible reason and a focused test. This is an early local toolkit, not a production hosted service with a compatibility promise.

TeamLoop uses the [Apache License 2.0](LICENSE), with project attribution in [NOTICE](NOTICE). Submit only contributions you have authority to provide under that license. Public contribution intake will open when the repository is published.

Before proposing a provider change, verify the real first-party access method, supported CLI flags, output protocol and billing behavior. Keep model IDs and role choices in configuration. Do not introduce provider impersonation, credential pooling, hidden paid fallback, or retries that erase original failures.

Use local fixtures for ordinary tests. New transport behavior should include success, failure, incomplete output, unexpected tools and cancellation cases. Live-provider smoke tests are opt-in, use an authorized non-sensitive packet, and document the CLI version, platform and usage involved. Never require paid model calls in ordinary CI.

Run `node --test` and `node scripts/check-release.mjs`. Update the operating reference when a command or safety condition changes. Add any new public file to `release-files.json` after reviewing its contents. Do not include personal model rosters, private outcomes, secrets or generated runtime state.

For evaluation changes, preserve the original outcome rows. Report assistance, failure attribution and missing data openly. Do not translate a handful of tasks into a universal model ranking.
