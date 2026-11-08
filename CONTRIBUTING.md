# Contributing to gitjig

This document is for people and coding agents changing gitjig itself. For using gitjig on another project, read the [User guide](docs/README.md). The [contributor index](development/README.md) maps the product requirements, internal architecture and distribution instructions.

Read Mission, Principles, Design and Contracts before changing behavior. Task plans are subordinate to them. Preserve the original requirement, challenge material alternatives, verify the changed boundary and obtain independent review. User communication may use the user's language; working specifications and review records use English. Apply ASD-STE100 to new English documentation where practical, without claiming full compliance or changing the required meaning.

## Setup and feedback

Use Node >=22.19.0; `.node-version` selects the reference development version. Exact runtime pins apply to reproducible offline bundles, not all source execution. Run `npm ci`, `npm run check` and `npm run build` from the repository root. Dependency versions and the local Claude bridge archive are locked. The build removes old `dist` and `.qualification` output, then compiles the product and external qualification tools separately. Source builds and ordinary feedback use the shared compatible Node policy; the offline runtime keeps its exact binary provenance. Keep private profiles and credentials outside the repository and registered projects. New model-free navigation fixtures use a canonical owner root under the system temporary directory; retain failed evidence there. Runtime/engine fixtures keep their explicit already-shared-root requirements. Do not place failed temporary evidence links inside a captured project or exclude them by weakening full capture.

Run the smallest check that reaches the behavior you changed. Inspect the changed-path plan with `npm run verify:changed -- --plan`, then use the [verification reference](development/verification.md#command-reference) for commands, prerequisites and focused checks.

Changed-path selection is a conservative owner map, not complete dependency analysis. Unknown impact requires broader verification. It never authorizes dropping a required check. Inspect the plan and its missing prerequisites before execution. Runtime groups use the exact declared qualification profile; see `tools/verify-changed.mjs` and the relevant fixture for environment variables.

The installed repository and local lanes rebuild and package current source through `install.mjs`; keep source/build inputs stable and do not run another installation or build concurrently. Each uses a disposable prefix/home outside the checkout to prevent dependency fallback. The no-engine local lane injects only explicit synthetic prior-check ledger fields; installed UI/CLI create all receipts and audit results. It cannot establish actual check execution or the complete engine-backed local journey. Select it for changes to the installed boundary. Failed runs retain their exact temporary root.

Do not use `node --test` over the entire repository as a cheap smoke test. Some suites exercise real engines or require an explicitly selected built installation. Do not run paid providers or repository mutations merely because an offline group passes.

## Engineering approach

### Start with a usable path

Define the actor, entry, required inputs, requested endpoint and recovery path before adding mechanisms. Walk through a realistic developer, repository administrator/contributor or agent task, as applicable. A collection of individually correct commands can still leave the user without a way to start or finish. Check integration seams as well as each feature, and make each tier useful without the others.

Distinguish plan readiness, component acceptance and whole-product maturity. For every completion claim, ask what user outcome the evidence actually demonstrates. Passing a narrow contract cannot substitute for the Mission's integrated success conditions.

### Keep verification resources outside project inputs

Use `temporaryDirectory` from `tests/helpers/temporary-directory.mjs` for ordinary host and model-free fixture roots. It creates a private directory under canonical system temporary storage and refuses a temporary parent inside this checkout. Callers retain responsibility for cleanup or explicit evidence retention; allocation does not prove process or engine cleanup. Do not fall back to personal configuration or create retained test data inside a captured project. Engine fixtures keep their explicitly configured backend-shared storage requirements.

Installed qualification modules are materialized in private host temporary storage or an existing harness directory outside the checkout. Their imports stay bound to the selected installed payload. Keep retained harness and module evidence outside registered projects.

The developer feedback runner records metadata observations of direct `.runtime-fixtures` entries around each command. A new or replaced retained entry fails the feedback run separately from the command result. Failed observations are unavailable, never clean. Original command failures and residue evidence are both retained outside the checkout; the runner does not delete resources. This check does not detect every nested mutation inside a preexisting fixture, establish native cleanup, or exclude files from project capture. Native Git projection and trust fixtures reject a temporary parent inside the checkout before creating data. The managed terminal, provider governed-role, observed case, interaction and governed CLI HTTP engine lanes require an existing canonical private shared root outside the checkout. Choose that root outside any registered project, including when running a separately copied installed QA tree. Existing fixture families are migrated by their actual storage and engine requirements.

### Challenge the solution before growing it

Compare the simplest sufficient solution, including existing Git/platform/Pi capabilities, before building another subsystem. Identify which conditions come from the user's requirement and which exist only because of the proposed design. Do not defend an unnecessary mechanism by adding more machinery around it. Include maintenance, verification time and operator effort in the cost comparison.

Use supported upstream APIs and keep product behavior separate from compatibility code. A provider-specific gap needs evidence and a bounded remedy; do not duplicate a facility already owned by Pi or silently widen a maintained fork. Preserve reproducible source and license provenance when a derivative is necessary.

### Test important failures at the right boundary

For each important behavior, state the required observation and a plausible failure that the test must detect. Reach the actual consumer with healthy and adverse inputs. Derive expectations from requirements, not merely from implementation structure or an agent's editable completion checklist.

Include skipped procedures, stale work or rules, interruption, partial effects and unknown outcomes where relevant. Simulations help find missing transitions, but do not prove actual runtime, hosting permission or installation behavior. A model is probabilistic: deterministic fixtures can validate boundary handling, but cannot establish universal semantic reliability.

Owned native fixtures must confirm that their recorded processes and groups have stopped before removing successful scratch directories. Sending a signal is not proof of cleanup; retain the directory and fail teardown if termination cannot be confirmed.

The model-free unit roster runs serially with a 60-second test-phase budget, including when combined with adapter feedback. Its build has a separate 60-second bound; these developer checks do not change product-operation or installed-entry budgets.

Separate frequent feedback from broader acceptance. Declare a practical time/resource budget before running expensive checks. If the budget is exceeded, diagnose the cause and revise the execution plan without omitting necessary verification. Changed-path selection is an optimization with an explicit scope, not proof that unrelated behavior cannot change.

### Keep review independent and finite

Use a distinct judgment-producing execution with the actual requirements and candidate. Preserve pending findings through replacement, restart and repair. A newer clean response cannot erase an earlier unresolved failure. Evaluate disputed findings by evidence; an author assertion is not a repair observation.

Separate required corrections from optional improvements. A nit may still be required. Carry a mechanical remedy forward only when its exact scope is fixed and the applicable contracts permit it; substantive changes need affected verification and independent review. Stop when agreed obligations are satisfied, and escalate exhausted or unresolved review rather than generating recursive review rounds.

### Keep authority and records at their proper level

Agent procedure establishes scoped representative eligibility; it does not create owner permissions or another account's approval. Keep repository acceptance rules configurable and explain their actual effect. Human local/repository workflows must not require internal agent ceremonies. State where enforcement is advisory, absent or limited, including equivalent action routes outside product control.

Retain lasting insights as current requirements, rationale, instructions and regression cases. Keep raw attempts with the task's execution evidence while needed for review or recovery. Publish concise issue/PR summaries of the problem, decision, validation and limits instead of copying those attempts into source. Removing old logs must not remove a known unresolved obligation or replace it with an unsupported success claim.

## Repository contents and records

Keep product source, portable verification consumers and their required helpers, licenses, reproducible dependency provenance and maintained documentation. Keep detailed execution output in scratch directories outside any project being captured. The feedback runner keeps its records in a canonical private system temporary directory and refuses a temporary parent inside the checkout before building. Model-free Git, HTTPS and source-capture fixtures also use system temporary directories; retained native journals remain historical evidence at their reported paths. Repository-local ignored `.runtime-fixtures` directories are suitable only when the checkout is not being captured: ignored files still participate in full capture, and retained FIFOs, sockets or unsupported source links can prevent requests from starting. Tests must create their own scratch directories and must not depend on prior development workspaces.

Record task intent, material decisions, meaningful verification, review disposition and acceptance rationale as concise issue/PR summaries. Include the candidate identity and any unavailable required verification. Do not commit transient plans, round-by-round reviews, experiment logs, historical receipts or copied installations. Extract lasting requirements, design decisions and regression cases into their maintained homes.

## Changes and review

Record the important failure and the simplest sufficient remedy. Reach the real consumer with healthy and adverse inputs. Preserve failed results and explain fixture or expectation corrections. Check current candidate identity and retained pending findings before accepting a new review.

Keep product files separate from local evidence, credentials and generated output. Include a license and complete source/build provenance for a maintained third-party derivative. Do not rewrite the pinned bridge archive in place without matching source and affected verification.
