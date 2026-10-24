# Interaction design and verification

This document describes the CLI/TUI design responsibilities used when changing gitjig. [Mission](../MISSION.md), [Principles](../PRINCIPLES.md), [Design](../DESIGN.md) and [Contracts](../CONTRACTS.md) remain authoritative. User instructions and current support limits belong in [docs/](../docs/README.md); contributor checks and their prerequisites belong in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Information and action model

Use the user's project, request, progress, result and next action as the primary concepts. Conversation IDs, work epochs, role launches, receipts and native operands remain exact and inspectable when they affect a decision. They do not need to occupy the first screen of every inspection.

Each primary view should make the following facts clear:

1. The project or repository being observed and the destination of new input.
2. The action available now, or the missing prerequisite and an applicable recovery route.
3. The current activity, responsible execution and known reason for waiting.
4. The effect of an offered action, including its cancellation and continuation scope.
5. The outcome actually established and the next useful step.

Readiness for a model request, a finished response, review-ready work, completed goal coordination and a confirmed external operation are different states. Preserve those distinctions in labels and action availability. A recorded success does not establish present eligibility, and an unavailable observation does not mean an unrestricted policy.

## Reachable journeys

| Journey | Interaction responsibilities |
| --- | --- |
| Entry and setup | Open model-free settings and inspection independently. Recommend missing prerequisites progressively. Distinguish the current model and runtime from future defaults or saved-next-launch settings. Preserve staged fields and requests through cancellation and restart. |
| Requests and progress | Show preparation before admission, queued input, native response or tool activity, and settlement near the editor. Navigation and background updates must not retarget input, steal focus or overwrite a newer draft. Silence alone is not failure. |
| Results and recovery | Lead with meaningful output, checks, attributed review, blockers and next actions. Find retained originals through project-scoped lists. Carry a selected recovery intention to its original owner, then perform the existing guarded review there. Opening a record starts no execution. |
| Goals and limits | Explain objective, criteria, continuation state and independent completion review. Keep goal turns separate from provider requests and work/child allowances. Pause, cancellation, revival and allowance extension retain their distinct effects. |
| Local development | Connect Git inspection, explicit conventions, preparation, isolated checks, current correspondence, retained candidates and historical commit audit. Human work needs no agent transcript. Native Git owns staging, commits, hooks and signing. |
| Repository administration | Show the exact provider/repository/rule, desired changes, preserved settings and native observations. Separate preview, default-Back application, audit and read-only reconciliation. Report provider-specific unknowns without inventing effective permission. |
| Repeat use and maintenance | Reuse valid selections within their actual scope. Make Back, Close and return destinations predictable. Preserve original identities and spent allowances across reopening. State external update and operator prerequisites explicitly. |

The [delivery boundaries](delivery.md) explain how these independently useful journeys compose. The user guides cover [setup](../docs/startup.md), [local development](../docs/local-development.md), [repository configuration](../docs/repository-configuration.md), [goals](../docs/goals.md) and [integration](../docs/integrations.md).

## Whole-product acceptance standard

A high usability claim applies to complete journeys, not the number of commands or isolated passing components. Evaluate these journeys independently and at their composition seams:

| Journey | Observable completion |
| --- | --- |
| Fresh setup | The user reaches the intended project, account, model and runtime through visible applicable actions, with original launch context and staged inputs preserved. |
| Requested delivery | A reviewed result leads to the requested supported endpoint through contextual existing controls; review-ready, branch delivery, publication and PR merge remain distinct. |
| Interruption and recovery | A named failure or interruption has a reachable original recovery action; reopen and resume preserve drafts, findings, identities, spent allowances and uncertain effects. |
| Repeat development | A second change starts from the delivered state and reaches its endpoint without undocumented policy choreography or discarded evidence. |
| Independent local work | A developer inspects rules, runs meaningful checks, records a candidate and audits a native commit without an internal agent transcript. |
| Repository administration | An administrator customizes, previews, applies and inspects supported policy, and a separate developer can follow the resulting guidance without administrator credentials. |

For every journey, observe the visible current scope, activity or reason for waiting, available next action, exact produced artifact and remaining limits. Exercise healthy and adverse paths through fresh original terminal and installed consumers. Count mandatory decisions, repeated data entry, waiting, model/check spend and recovery actions against a declared baseline. A cancellation or refusal must lead somewhere useful without disguising pending or unknown outcomes as completion.

Current support limits and synthetic acceptance remain evidence of their stated scope. They cannot shrink Mission or substitute for real-model engineering judgment, recurring endpoint operation or an independent human's comprehension. Record unresolved qualification obligations outside the repository with the current task; maintain supported behavior and limits in the authoritative requirements and user guide. Do not claim a comparative product standard from a scripted terminal trace alone.

## Implementation boundaries

Context-specific producer obligations must appear in the producer's instructions, output shape and original response validation. Planning adjudication with held source inputs uses one captured list of input identities and revisions across these boundaries; the controller still owns independent source-fit acceptance. A generic optional field cannot hide a field that is mandatory for the actual supplied context. Preserve the raw incomplete response and refuse standing instead of filling in a judgment.

Distinguish requesting a new wait on a failed task from receiving a failure through an already authorized wait. The latter reuses the original continuation, publication and accounting path. For the supported settled direct managed-change failure, an inspection turn must preserve the failed records and consume the normal allowance. Unknown cleanup, stale or absent publication and cancelled tasks retain their holds. Historical failures remain completion evidence even when they no longer describe the currently awaited operation.

Use public Pi input, focus, layout and session facilities. The [UI host](../src/ui/index.ts) owns command interactions and their asynchronous tails; the controller owns admission, durable state and authority. Read-only presentation functions format supplied observations rather than introducing another workflow, configuration store or authority journal.

Hold input ownership for an entire interaction, including asynchronous gaps between dialogs. A waiting view must not look like an editable composer. Recheck the captured source, project, model, language and relevant record identity after asynchronous decisions. Release ownership and join owned work before shutdown completes. Save the exact draft before reporting successful exit.

Keep consequential review separate from optional inspection. A review must display every operand that the subsequent decision authorizes, or refuse before confirmation and dispatch. Read-only summaries may omit whole entries with explicit counts and a route to complete observations. Quote opaque identities losslessly; terminal sanitization must not turn one path or ID into another. Bound every section so later scope and recovery information remain visible.

Presentation does not manufacture fresh evidence. Distinguish historical procedure records from current source correspondence, current native observations and actual send causality. Unknown external outcomes permit their original read-only reconciliation, not an implicit replay. Credentials remain private inputs outside registered projects and conversation history.

## Verification responsibilities

Select focused checks from [CONTRIBUTING.md](../CONTRIBUTING.md) and the changed-path feedback tool. Declare runtime, installation, provider and native-tool prerequisites before using those lanes. A test total or an old build is not evidence for the current changed boundary.

| Boundary | Required observation |
| --- | --- |
| Focus and input ownership | The final rendered frame and actual input target agree during nested dialogs, delayed reads, background completion and navigation. |
| Persistence and freshness | Cancellation, refusal and late acknowledgement preserve exact drafts, original identities, retained obligations and consumed allowances. Stale decisions refuse before mutation. |
| Outcome presentation | Healthy, failed, stale, unavailable and uncertain records remain distinguishable. Oversized or control-bearing values cannot hide consequential operands or imply empty results. |
| Execution and cleanup | Exercise the real changed consumer where the claim concerns native execution. Confirm owned process groups, scopes and accounting settle; a sent signal alone does not establish cleanup. |
| Installation and composition | Use a current immutable payload and its public entry for installation claims. Exercise the declared endpoint and relevant interruption/reopen/repeat seams, with source and payload correspondence retained. |
| Human comprehension | Give an independent operator task intent and public affordances rather than source code or an internal command recipe. Compare predicted effects with observed outcomes and fix unexplained consequential behavior. |

Controlled procedure records and scripted providers are useful for deterministic boundary checks. They do not establish semantic judgment, live-account rights, live-host enforcement or human comparative usability. Describe agent-operated usability checks as proxies. Current qualification and recovery limits remain in [Capabilities and limits](../docs/capabilities.md); an unsupported combination cannot silently narrow a product requirement.

Keep task plans, review rounds and raw observations in ignored scratch storage or the task's issue/PR. Maintain these design responsibilities, user instructions, meaningful regressions and support limits in source. Do not accumulate historical acceptance receipts here.
