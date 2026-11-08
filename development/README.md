# Contributor documentation

This directory explains how contributors develop and maintain gitjig. Users applying gitjig to another project should start with the [User guide](../docs/README.md).

Read [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, engineering practice and recordkeeping. [AGENTS.md](../AGENTS.md) directs coding agents working on this repository.

| Document | Responsibility |
| --- | --- |
| [Mission](../MISSION.md) | Product purpose, success and boundaries |
| [Principles](../PRINCIPLES.md) | Enduring constraints |
| [Design](../DESIGN.md) | Integrated structure and rationale |
| [Contracts](../CONTRACTS.md) | Observable obligations and acceptance conditions |
| [Verification reference](verification.md) | Focused commands, requirements and supported feedback boundaries |
| [Runtime ownership and recovery](runtime.md) | Container ownership, original create-refusal evidence and bounded cleanup recovery |
| [Provider maintenance](providers.md) | Internal ownership, SDK compatibility and adapter rationale |
| [Delivery boundaries](delivery.md) | Capability endpoints, composition, recovery and qualification responsibilities |
| [Interaction design](usability.md) | Interaction model, input ownership, readable evidence and verification boundaries |
| [Distribution](distribution.md) | Building and verifying the shipped application |
| [Assignment recovery](assignment-recovery.md) | Cancelled governed-assignment recovery and later owner-direction propagation boundary |
| [Bridge build](../third_party/pi-claude-bridge/BUILD.md) | Maintaining the derivative dependency |

The four normative documents stay at the repository root because the controller also loads them as versioned runtime criteria. Their presence in an installation does not turn them into setup instructions for adopting projects.

## Source entry points

| Area | Start here |
| --- | --- |
| Command-line routing and setup | [CLI entry](../src/cli/entry.ts), [route and option definitions](../src/cli/arguments.ts), [command execution](../src/cli/main.ts), and [application configuration](../src/app/startup.ts) |
| Terminal input and copy | [Conversation UI](../src/ui/index.ts), [command discovery and execution](../src/ui/host-commands.ts), and [English and Korean catalogue selection](../src/ui/i18n.ts) |
| Work and model sessions | [Controller](../src/controller/controller.ts), [role framing](../src/workflow/role-framing.ts), and [Pi session boundary](../src/pi/session.ts) |
| Verification and packaging | [Verification selection](verification.md), [installed payload and offline distribution](distribution.md) |

## Runtime control and model inputs

Gitjig CLI uses the official Pi SDK, not the stock Pi CLI UI. The controller owns workflow state and action admission. Role sessions propose plans, changes and judgments; they do not grant themselves completion or account authority.

```mermaid
flowchart TD
    UI["Gitjig CLI and conversation UI"] --> Controller["Gitjig controller<br/>State, scope, delegation and evidence"]
    Controller --> Ordinary["Ordinary conversation<br/>Owner input, history and captured project files"]
    Controller --> Bundle["Managed role input bundle<br/>Requirements, selected criteria, sources and stage context"]
    Criteria["Root criteria documents<br/>MISSION, PRINCIPLES, DESIGN and CONTRACTS"] --> Bundle
    Bundle --> Prompt["Workflow adapter<br/>Role instructions and judgment rules in TypeScript<br/>plus input bundle"]
    Ordinary --> Session["Owned Pi SDK session<br/>Explicit prompt, model and mediated tools"]
    Prompt --> Session
    Session --> Provider["Selected provider or Claude bridge"]
    Provider --> Output["Model messages, tool calls and role results"]
    Output --> Guards["Controller and executor checks<br/>Scope, protocol, versions and pending obligations"]
    Guards -->|Admitted transition or action| Controller
    Guards -->|Missing prerequisite or uncertain result| Hold["Hold or reconcile; retain evidence"]
```

The diagram combines the ordinary conversation and managed-role paths. Only the managed-role path receives the selected product criteria automatically. A model judgment remains fallible; passing controller checks does not prove its semantic correctness.

| Input or control | Implementation |
| --- | --- |
| Product criteria loading | [criteria.ts](../src/controller/criteria.ts): full Mission and Principles; Design D2/D4/D5/D6/D7/D10; Contracts C0/C1/C2/C3/C4/C8/C9/C10 |
| Product criteria delivery | [criteria-delivery.ts](../src/workflow/criteria-delivery.ts): declared operating profiles retain exact canonical current/prior definitions in owned Read records; captured recipes and exposure remain distinct from rendered reads |
| Role identities and response selection | [metadata-identities.ts](../src/workflow/metadata-identities.ts) and [subject-actions.ts](../src/workflow/subject-actions.ts): preserve original identities and claim bodies while sharing compact host-owned response selectors; retained inputs use their captured recipe |
| Role instructions and judgment rules | [role-framing.ts](../src/workflow/role-framing.ts): `roleSemantics` and `implementationCarrySemantics`; these prompts are code, not separate Markdown files |
| Role task prompt | [role-framing.ts](../src/workflow/role-framing.ts): `promptFor` combines requirements, criteria, stage context, source metadata and selected source text; [adapter.ts](../src/workflow/adapter.ts) binds execution and evidence reads |
| Ordinary conversation instructions | [ordinary.ts](../src/controller/ordinary.ts); investigation instructions also exist in [conversation.ts](../src/controller/conversation.ts) |
| Project document capture | [input-context.ts](../src/controller/input-context.ts): the connected project's root `AGENTS.md`, when present, and explicit `@file` references |
| Goal and independent completion-review instructions | [goals.ts](../src/controller/goals.ts) |
| Session and tool boundary | [session.ts](../src/pi/session.ts): explicit resources; ambient context files, skills and prompt templates are disabled |
| Workflow transitions and evidence checks | [change-core.ts](../src/controller/change-core.ts); external publication has further checks in [publication.ts](../src/controller/publication.ts) |

A reference in a document does not cause recursive loading of linked documents. Contributor instructions remain source-only; they are not runtime role prompts.

## Audience and record boundaries

`docs/` contains maintained product usage, operation and support limits for developers and repository administrators using gitjig. Do not put gitjig contributor test plans, SDK internals, release decisions or development histories there. Source installation is a user task and belongs in the user guide; constructing a release bundle is a contributor task.

Use this directory and CONTRIBUTING for implementation rationale and maintenance procedures. Keep third-party-specific instructions beside that dependency. Legal notices serve users and distributors, so their source/license attribution remains in THIRD_PARTY_NOTICES even when maintenance procedures move here. Keep issue/PR summaries concise; do not add review-round or execution logs to either document tree.

Managed role inputs capture their presentation recipe with the original launch. Narrow operating views and compact response selectors do not remove required claim bodies, current duties or access to complete current/prior criteria. Deferred rules must be read when the judgment depends on them. Dispatch, effect and historical readers validate the captured source and identities; retained inputs keep their original interpretation instead of inheriting the latest factory default. See [Provider maintenance](providers.md) for the supported codecs and compatibility boundaries.

Focused codec feedback uses `tests/workflow/{disposition-history,historical-plans,finding-body-presentation}.test.mjs`, `tests/controller/criteria-delivery.test.mjs` and `tests/workflow/adapter-native-format.test.mjs`; select related controller checks from the [verification reference](verification.md). These controlled checks do not establish live model comprehension, semantic correctness or final-stage capacity.
