# Gitjig Claude bridge

`@gitjig/pi-claude-bridge-host` is gitjig's maintained derivative of `pi-claude-bridge`0.9.0. Its package version is `0.9.0-gitjig.20`. It connects the supported Pi host to Claude Code through the original Anthropic Agent SDK. It is a separate dependency from the official, unmodified Pi packages.

Hosted provider execution waits for the exact captured SDK MCP invocation, including tool-use ID, role-filtered name and matching arguments. Streamed proposals alone cannot execute Pi tools. Query-local admission survives Pi stream resets and supports sequential or parallel handlers; native denial, argument mismatch, terminal closure and late callbacks cannot manufacture approval. The public SDK callback runs in default mode, admits only the captured closed role surface and preserves forced human asks and managed security denials. It changes no persistent permission rules and enables no general permission bypass. Controller standing and delegation checks still apply after native tool admission.

Use this package through gitjig's admitted bridge profile. The upstream `pi install` instructions describe the original extension, not gitjig setup. The source repository provides [provider integration](https://github.com/ilgyu-yi/gitjig/blob/main/docs/providers.md) and [usage](https://github.com/ilgyu-yi/gitjig/blob/main/docs/usage.md) instructions for application configuration and authority limits.

## Current changes from upstream

- Show the provider-reported quota reset calendar date, local time and timezone consistently in failures and warnings. Unknown or invalid reset values do not invent a deadline. Presentation grants no service entitlement or automatic retry.

- Expose bridge-owned provider and lifecycle declarations for composition through public Pi SDK resources, alongside the original extension initializer. Hosted declarations capture provider and long-context settings, and route history through the native account environment. Creating another declaration cannot retarget an earlier provider.
- Require an explicit synchronous diagnostic sink for hosted declarations. Standalone debug and raw-record environment flags cannot enable hosted logging, native CLI debugging or per-message recording. A hosted diagnostic without a sink refuses before native allocation and never falls back to the standalone log. Send immutable diagnostic facts to the captured sink while preserving its receiver. Hosted execution does not persist standalone welcome settings. Standalone initialization retains its configuration and logging route.
- Complete synchronous history preparation and diagnostics before claiming a fresh query. A failure preserves its original cause and completed preparation without creating an unstarted native cleanup hold. Refuse cancelled, closed or synchronously replaced query slots before claiming them.

- Support Pi's public `onProviderStreamEvent` observer with detached original SDK envelopes before normalization and native policy admission. Capture its receiver and callback for the original provider or isolated-summary query, await it through tool continuations, and preserve rejection/cancellation through original cleanup. Cancellation releases the waiting consumer but retains a pending callback as an explicit `pendingObservers` close uncertainty until settlement; native process settlement remains a separate fact. Same-owner close reentry and rewritten-query cancellation cannot deadlock or retarget a successor. Observation does not select structured role results or grant tool authority.
- Accept an explicit frozen hosted JSON-schema intent through public Pi metadata for a fresh provider query, with a separate native-turn bound. Forward it through the original SDK outputFormat option; admit the internal StructuredOutput formatter only under that intent, without widening executable MCP tools or overriding native asks/denials. Refuse formatted history reuse/replacement and keep ordinary, standalone and isolated-summary routes separate. Emit a namespaced original-query settlement attestation after actual native settlement, distinct from observed SDK envelopes. Root-owned source selection and strict role validation remain separate responsibilities.
- Own native-query lifecycle and settlement through the admitted host. Match model, owner and executable identity before provider or summary execution.
- Pass the host's selected executable through the original SDK option for provider and summary queries. A custom admitted pin cannot fall back to the SDK's bundled executable.
- Recheck trusted host prerequisites synchronously before native birth. A rejected preflight seals that query without inventing an unknown native process; attempted births still require their actual settlement records.
- Capture the actual role-filtered tools and schemas. Check native initialization and connected MCP tool identity before tool admission; retain upstream hook and ownership guards.
- Disable optional native frontend discovery/authoring features and isolate user/project settings through the SDK. Accept native-owned builtins by canonical SDK source and literal `builtin` path, not by policy-name lists; duplicate, unidentified and external components remain refused. Native origin grants no tool or controller authority. Native managed policy can still run its hooks; this host does not claim isolation from that policy.
- Run summary requests through the original SDK under the same owner, with an empty query-tool set and bounded shared admission. Require an actual successful SDK terminal result and native settlement before crediting completion.
- Use terminal convenience text only when the current turn has no delivered text block. Do not remove repeated text by string-value deduplication.
- Lower one bounded hosted provider-schema presence-pair form before query allocation. Preserve the original Pi validator and executor. Reject unsupported forms instead of claiming general schema compatibility.

These changes do not grant account permissions, repository authority, service entitlement or general provider compatibility. A successful build or offline protocol test does not qualify a live account or installation.

- Deliver changed host language guidance through the existing native steering FIFO before releasing tool results. Keep query-local acknowledgement, isolation and explicit failure on unavailable delivery.

- Honor hosted Pi thinking off with the original SDK disabled-thinking option; preserve explicit nonoff effort and standalone defaults, including isolated hosted summaries.

## Maintained files

- `src/`: current derivative implementation.
- `upstream/`: original source, package metadata, README, assets and MIT license. Treat its usage and service descriptions as upstream material.
- `LICENSE`: derivative's retained MIT license.
- `package.json` and `tsconfig.host.json`: pinned dependency graph and compilation settings.
- [BUILD.md](BUILD.md): build and package reproduction.

Compare `upstream/*.ts` with `src/*.ts` to inspect the complete current source delta. `host.ts` and `provider-schema.ts` are derivative-only modules. No chronological patch chain is required to reconstruct the implementation.
