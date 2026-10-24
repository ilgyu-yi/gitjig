# Provider maintenance

Audience: contributors changing gitjig's provider integration. Application users should read [Accounts and providers](../docs/providers.md).

## Ownership and extension boundary

Pi owns catalogues, authentication resolution, token refresh and wire protocols. Gitjig owns admitted execution, original task tails, cancellation, idle proof and cleanup. Direct providers share one owned chat runtime. Claude Code-backed execution also needs a native process adapter. A trusted programmatic runtime is borrowed: its caller owns authentication and lifetime, so it cannot supply gitjig-owned idle proof.

Extend compatible direct providers with capability data and proportionate conformance checks. Do not copy the controller/runtime owner for each model or provider. A catalogue entry is not execution qualification. Keep application-managed and deliberately selected external credential modes distinct.

## Application model and credential binding

Model management, conversation UI and role selection share the application resolver. It creates an original owned Pi runtime for one admitted source/model, uses original codecs and closes it at settlement while retaining history. Config integrity hashes stay in private admission state; model/run evidence excludes credentials and those hashes. Per-provider account epochs invalidate old admitted sources before original account writes. Operator setup and the explicitly selected external-profile route are documented in [Accounts and providers](../docs/providers.md).

Configuration identity excludes credential values and key hashes. Run/launch identity remains distinct from stable configuration identity. For stored profiles, the public header transform preserves original authentication headers: caller additions must match the resolved subset, and an unknown added header or destructive callback refuses before transport.

Guided Claude connection is a Claude-specific application setup helper, not a provider registry or a second runtime owner. It receives the operator environment captured before private startup projection, discovers metadata without execution and uses the existing bounded native observation helper for explicit login checks. ApplicationStartup owns its serialization, cancellation/close and exact-byte save boundary. Opaque reviewed candidates bind the selected executable, login route, account organization and concrete app-owned prerequisite target; they do not authorize model dispatch or implicit model changes. Native account-status commands may refresh their selected native store. Credentials remain native-owned. Saved bridge changes still activate through normal relaunch; external advanced profiles remain supported separately.

## SDK compatibility surface

The finite compatibility names in `src/pi/sdk-metadata.ts` come from the MIT-licensed Pi coding-agent 1.3.0 `dist/core/provider-attribution.js`; the installed package.json declares MIT; this package does not ship a LICENSE file. Only seven metadata names are admitted, without copying SDK provider routing or header values. Original auth-header values remain protected. On upgrade compare this surface and run the managed original-codec consumer; new names fail visibly until reviewed. Managed sessions disable Pi install telemetry through the public SettingsManager preference. The CLI ignores PI_TELEMETRY once at startup, before sessions exist, because the original SDK gives it precedence over preferences. An embedding host must make its own explicit startup choice. Original provider session headers remain delegated to Pi.

The copied metadata names and their upstream source attribution are also recorded in the distributed [third-party notices](../THIRD_PARTY_NOTICES.md). Keep the attribution when moving or replacing this compatibility surface.

Integer operands that bind freshness, original recovery and exact target identity use public opaque integer schemas. Keep the native JSON schema unchanged while refusing lossy fractional conversion through Pi; exercise actual mutation boundaries as well as schema validation when upgrading the SDK. Existing canonical conversion of whole-number strings and booleans is separate from fractional truncation.

## Bounded conversation results

The Pi coordination tool preserves the scoped controller result read. Every summary or page calls that read again with only the result ID before formatting; a fingerprint is consistency evidence, never read authority. Results up to 8 KiB retain their existing JSON representation. Larger results, within the controller’s 128 KiB ceiling, return an explicitly marked summary with identity, outcome metadata, complete blocker entries that fit and omission counts. The summary never turns omitted evidence into success.

Detailed inspection uses the same `conversation_result` tool with its returned SHA-256 fingerprint and UTF-8 byte cursor. Each serialized content text, including JSON escaping and page metadata, stays within 8 KiB; the transport envelope adds its own overhead. Pages reconstruct the exact serialized result; changed content, invalid cursors and lost audience scope refuse. This also keeps ordinary failure and cleanup metadata visible when a large report cannot fit inline. Only the independent governed producer can supply missing source-fit judgments; the coordinator’s result inspection cannot adopt them.

New governed assignments publish `governed-work-observation/v1`: a compact immutable observation with selected identities, usage, blocker/action omissions and an exact `detailRef`. The rich original observation is retained as a closed-purpose JSON artifact, limited to 16 MiB with a five-second observed IO budget; every owned operation is joined before timeout is reported. Read its advertised `detailRead` operands with the same result ID. Each detail page repeats the original audience/root/project checks, validates the original artifact digest/length and returns at most 8 KiB. Later work or journal changes do not regenerate that snapshot. Missing, altered or unsafe artifacts refuse; a hash never grants access. This adds no general host-file read, provider/bridge permission or model execution.

Legacy publications keep their original bytes and paging. This stage does not relax C5's 64 KiB metadata bound or add large legacy cancelled-assignment recovery. Human `/result` and `/work` continue to inspect the selected current work; they are distinct from the immutable historical snapshot exposed by the native result reader.

Verify the pure formatter, scoped controller/Pi consumer and original public SDK/MCP gate separately. A scripted native transport proves message handling and permission coherence, not actual native spill thresholds or live model comprehension.

## Maintained bridge choice

The current derivative adds fixed launch policy, scoped native ownership and cleanup, admitted tools, bounded summaries, typed terminal validation, text ownership and finite schema metadata. See its [current changes](../third_party/pi-claude-bridge/README.md) and [build instructions](../third_party/pi-claude-bridge/BUILD.md).

Assess an unchanged upstream bridge against these actual boundaries before adding or retaining a patch. A worker alternative must account for command/event/tool forwarding, live Pi session/UI coordination, callback reconciliation and process recovery. A launcher can constrain startup, but distinguishing a successful typed result from text and clean EOF requires a consumer that sees the result protocol. Count the full maintenance cost, not only visible patch lines.

The selected native account route uses one metadata assertion for setup and synchronous birth checks. Run it before the SDK host invokes its process-capable callback for every provider and summary. A sealed preflight refusal records no birth; attempted callback counts and all returned launch settlements still govern cleanup. Credential contents and inode identity are not frozen across native account refresh. The native callback retains the original metadata error. The existing compaction hook cancels failed summaries to prevent unsafe native fallback; Pi can report a generic compaction-cancelled error. Check the callback error, absent new birth and settled ownership rather than requiring that outer message to preserve the metadata reason.

Native tool request streaming is not permission evidence. Keep provider execution behind the exact captured SDK MCP invocation, including its tool-use identity, role name and arguments; native policy may refuse or rewrite a streamed request. Retain per-query pending admission across Pi stream resets and return approved serial results without waiting for later calls. Default SDK permission callbacks are finite role admissions, never persistent rules or general bypass. Permission-denied/terminal paths must demonstrate zero unapproved controller mutation through the original Pi plus SDK/MCP transport, including source/policy changes and owner closure. Native policy hooks retain their documented host-side limits.

Exact native INIT observation is the selected witness, not a requirement for every future adapter. The current derivative is a selected baseline, not a proven global minimum. On upgrades, inspect actual query births, tool/terminal/callback ownership and native cleanup with the selected SDK. Public upstream facilities are preferred when they are shipped and sufficient. Past controls cannot qualify a different version or live account.
