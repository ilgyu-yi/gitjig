# Runtime ownership and recovery

Audience: contributors maintaining the execution boundary. Users should follow [runtime setup and recovery](../docs/usage.md) and [capabilities and limits](../docs/capabilities.md). Design D10 and the runtime contracts remain authoritative.

## Ownership and retained outcomes

The executor owns its native client, container scope and cleanup journal through settlement. A result does not discharge cleanup; uncertain native execution or cleanup remains held. Original work/run identity, retained observations and charged allowance survive interruption and recovery. Reopening does not manufacture a successful check or retry an owner request.

[Container scope](../src/execution/container-scope.ts) distinguishes original settlement evidence:

- A known full container ID can use its previously committed original-daemon binding and complete bounded native inventory after inspection fails. This observes absence on the original route; current daemon access cannot supply a missing historical binding. Legacy and name-only uncertainty remain held.
- A complete original Docker refusal for a nonexistent bind source establishes a preallocation rejection. This is an original outcome, not an inference from a later empty inventory. New creates retain the exact native result. Legacy owner recovery must bind its retained controller failure observation to the same work, run, journal and captured mount path.

- An original selected create executable that fails to start has separate admission evidence. Only the same asynchronous spawn error and closed child, with exact command operands and no spawn/PID/output/competing termination, can produce it. A failed exec can involve a transient OS child; the receipt claims that the selected executable never started. Persist this evidence before marking its original scope removed. Plain thrown errors and launched clients, including exit127, remain uncertain. No legacy reconstruction from a name, later inventory or old error string is supported.

A failure before publishing the receipt leaves the original creating journal held. A directory sync failure after rename preserves the original spawn and persistence errors and does not establish durable commit. A later exact read may consume the complete visible positive receipt; if a crash loses that rename, the older creating journal remains uncertain. Do not invent native-process uncertainty or a rollback marker to hide storage-commit uncertainty.

Valid terminal removed journals need no new executable/configuration probe or write; retained `nativeCleanupUnknown` still overrides removal. Nonterminal scopes continue to require their exact trusted runtime. Failure to start a later inspect/exec/remove command never settles an existing container.

## Cancellation during scope admission

An in-flight create retains its original bounded reply so cleanup can use the full container ID. The existing cancellation fences then prevent project execution. A start client already has that durable identity and receives the original cancellation signal through the native owner. Join its process/pipe lifetime before reporting an ordinary abort; an unjoined native checkpoint remains uncertain even if the known container was removed. Cleanup runs independently of the canceled request, using its original bounds and exact owned ID.

## Native provider owner receipts

[Native owner records](../src/pi/native-owner-records.ts) keep outstanding scopes in `runtime/native-owners/v1/<nonce>` under the private application state root. Admission inspects at most 1024 directories within a one-second IO budget and reserves capacity for a new owner. These bounds apply to the outstanding census, not the lifetime number of native queries.

A validated physical recovery receipt moves its entire directory, without changing any receipt bytes, to `runtime/native-owners/archive-v1/<first-two-nonce-characters>/<nonce>/records`. Admission validates the original binding, birth and settlement correspondence before archival and never probes acknowledged historical process IDs. Local active owners remain in the census. Unresolved scopes, malformed records and unsafe directory paths still refuse admission; historical archival neither replays a request nor changes its outcome.

Archival reserves a private nonce slot, atomically renames the receipt directory and synchronizes the destination ancestry and source directory. An interrupted empty reservation can resume; a nonempty destination refuses replacement. Existing large histories migrate within the same bounded census. If the count or IO limit interrupts migration, completed moves remain preserved and another explicit attempt continues with the remaining census. Archived receipts are retained without automatic deletion and are not rescanned on ordinary admission.

The [retention regression](../tests/pi/native-owner-retention.test.mjs) exercises more than 1024 settled lifetime owners, migration of a full old census, byte preservation, active capacity, malformed and unresolved refusal, interrupted reservation recovery, and unsafe archive destinations. The original SDK, native guardian death and shared-owner auxiliary tests cover the actual producer and archived history readers without paid providers or an engine.

## Bind-source create-refusal protocol

[Create rejection](../src/execution/create-rejection.ts) recognizes only a complete normal CLI exit 1, empty stdout, no timeout/abort/output-limit termination, and the exact daemon error for a selected canonical absolute bind source. An adapter signal fallback or a partial/error-looking string cannot establish nonallocation. The evidence stores its native result or its exact legacy controller-observation source and is revalidated when consumed.

The protocol references are released Moby [29.5.3 create ordering](https://raw.githubusercontent.com/moby/moby/docker-v29.5.3/daemon/create.go) and [bind-mount validation](https://raw.githubusercontent.com/moby/moby/docker-v29.5.3/daemon/volume/mounts/linux_parser.go), with the same ordering examined in [28.5.1 create](https://raw.githubusercontent.com/moby/moby/docker-v28.5.1/daemon/create.go) and [mount validation](https://raw.githubusercontent.com/moby/moby/docker-v28.5.1/daemon/volume/mounts/linux_parser.go). Mount validation rejects a missing bind source before container allocation on this supported path. A current daemon version does not prove the behavior of a historical create; other outcomes remain uncertain unless their own original evidence establishes cleanup.

## Owner-reviewed legacy recovery

[Startup cleanup recovery](../src/controller/startup-cleanup-recovery.ts) accepts only an idle independent original ordinary startup that completed capture but never reached native execution. Delegated/context/governed work, native history, dependent work, goals, external-operation obligations and other unsettled producers keep their existing recovery routes. Bounded owner-private journal reads and the complete journal census bind the reviewed snapshot; synchronous final correspondence checks reject drift or duplicate same-run scopes.

The controller records the original observation and journal hashes, settles only that run and its scoped quarantined capacity, and preserves spent allowance and input identity. It dispatches nothing. A durable create-rejection receipt can complete an interrupted state commit on reopening without an engine. Safe input retry or withdrawal remains a separate explicit owner action.

## Focused verification

After the current build, run the focused command in [CONTRIBUTING](../CONTRIBUTING.md#setup-and-feedback). The maintained consumers are [native rejection classification](../tests/runtime/create-rejection.test.mjs), [controller recovery](../tests/controller/startup-cleanup-recovery.test.mjs) and [terminal recovery/withdrawal](../tests/ui/startup-cleanup-pty.test.mjs). They use owned controlled native responses and private controller state, not a live engine or provider. They cover exact refusal versus ambiguous output, original identity/provenance, stale or contradictory state, bounded snapshots, finite accounting, interrupted commit and explicit no-dispatch recovery. Actual engine and installed-path claims require their separately declared prerequisites and evidence.
