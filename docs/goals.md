# Goals

A goal keeps an objective, observable completion criteria and a finite turn allowance on one conversation. It survives restart and compaction. It does not grant access, extend delegated work budgets or bypass repository rules. A conversation can have one unfinished goal. Creation requires an idle conversation without pending input, one to 16 criteria and a turn allowance of 1 to 1000 (default 8). Completed and cancelled goals remain inspectable.

In the conversation UI, use `/goal create`. Enter the objective, one or more criteria and the allowance. Creation saves the goal without running a model. Select the conversation model with `/model`, then use `/goal start`. The goal runs in the background. You can switch to children, use split view and continue to read or give instructions. Each pane shows its own goal state, consumed turns and next action.

Use `/goal` to inspect the goal and choose an action. `/goal pause` stops and joins its current goal turn. `/goal resume` explicitly restarts a paused, interrupted or waiting goal after reconciliation. If owner input is pending, select the exact retained input. The input stays available when reconciliation fails. `/goal revise` changes the objective or criteria while the runner is quiescent. `/goal extend` adds turns with an owner reason. Revising the objective or criteria records pending findings as `owner-superseded` with the owner's reason, invalidates the old proposal and returns the goal to READY. This preserves the reported issues; it does not claim they were repaired. Neither operation resets consumed turns. `/goal cancel` stops goal coordination; delegated work retains its own lifecycle and explicit cancellation controls.

The `/goal` menu separates **Inspect goal and completion evidence** from actions. Running or dependency-waiting goals offer Pause before editing criteria or extending turns. When goal turns are exhausted, **Add goal turns** is available; it does not extend a child or work allowance. Completed and cancelled goals retain their details and can lead to a new goal when the conversation is idle. Cancelling through the menu explains its scope and defaults to Back. Choosing or closing inspection starts nothing; final execution and recovery checks still apply when an action is selected.

On the first Start in a fresh independent owner conversation, gitjig retains the accepted objective and criteria as the original owner input. Explicit startup integration/publication/merge grants apply through the usual owner-work admission; automatic continuations and goal review receive no new authority. If first admission fails, resume with the exact retained input and original grant configuration. Pause preserves that input. Revising or cancelling before any admission withdraws only that goal-owned queued input, keeps its original source and owner reason, and does not refund or dispatch anything. A revised goal needs a separate Start.

The `/goal` inspection shows criteria, plan, next action, attempt summaries, review conversation ID and the pending-finding count. For full finding IDs, descriptions, dispositions and retained attempt/event data, use `gitjig goal inspect --goal ID`. Use `/resume REVIEW_CONVERSATION_ID` to open the review conversation.

The allowance field starts empty: press Enter to use its displayed default, or type the entire number you want. It does not append your input to a prefilled default. Goal turn allowance uses whole numbers and counts admitted author and completion-review turns separately from original work/child allowances. If you enter an invalid number, correct that field without re-entering the objective or criteria; Cancel saves nothing. Extensions retain prior use and cannot take the goal above its hard total of 1000 turns. Changing the goal while a form is open requires reopening its current controls.

## Execution and completion

An author turn can plan, act through existing tools, verify, ask for input or propose completion. A prose progress reply continues within the allowance. If a turn depends on a child result, the goal waits for that result before continuing.

Start and Resume tell the author which objective, criteria and finite limit you explicitly continued. Automatic turns share that recorded decision. The author also receives current linked-task metadata separately from historical failures, so an older failure is not presented as a new execution failure. This context does not bypass task checks or guarantee a retry; a real missing prerequisite can still require your input. Older retained attempts without this attribution say it is unavailable. Large model-facing status responses explicitly identify omitted fields; full retained goal details remain available through goal inspection.

For a direct managed change, an existing authorized wait can deliver a recorded failure after its execution and cleanup settle. The same coordinator then inspects the original failure in another counted turn. The task and result retain their failed outcome; any retry uses the original task's admission and procedure checks. Cancellation, missing or stale results, uncertain cleanup and external-operation failures retain their original holds. Requesting a new wait on an already unavailable task instead returns its recovery guidance.

Completion requires a fresh, distinct reviewer conversation with read-only tools. Application-managed goals use the reviewer override, or the originating author baseline when no override is set. Explicit external profiles keep their original model route; see [role settings](usage.md#models-and-credentials). It receives current criteria and attributed evidence. It does not receive the author's full conversation. A rejected review creates retained findings. A later clean review must explicitly account for those findings. Pending or unavailable child work, stale evidence, unresolved governed checks/reviews and owner direction changes prevent completion. Goal review does not establish merge or publication authority.

The default allowance is eight admitted turns. Both author and completion-review turns count, including original WAIT continuations. An admitted turn is never refunded after cancellation, failure or restart. Each ordinary turn also has its existing provider-request bound. Child/work allowances are separate. A final author proposal without a remaining review turn produces budget exhaustion, not completion.

| State | Meaning |
| --- | --- |
| READY | Saved; explicit start required. |
| ACTIVE / REVIEWING | Author or independent completion review is running or scheduled. |
| PAUSED | The owner requested a pause. |
| WAITING_INPUT | Owner input or an explicit decision is required. |
| WAITING_DEPENDENCY | An original child dependency or a stated external dependency is pending. External waits do not poll automatically. |
| BLOCKED | Execution, cleanup or evidence needs diagnosis and reconciliation. |
| BUDGET_EXHAUSTED | No goal turns remain. Original work budgets may also need separate attention. |
| INTERRUPTED | The goal host ended. Opening the conversation does not dispatch work. |
| COMPLETED | Current evidence and a distinct settled review satisfied the criteria. |
| CANCELLED | Goal coordination ended without a completion claim. |

Normal close and crash recovery retain attempts, input, findings and consumed turns. Inspect the goal, repair any original cleanup/input problem, then explicitly resume. A project change requires finishing or cancelling the existing goal first.

## Command line

Use an existing conversation ID. A conversation created with the low-level `conversation create` command has no selected model; select one in its UI or supply its explicit `--model-profile` for execution.

```sh
gitjig goal create --conversation ID --objective 'Explain the observed failure' \
  --criteria '["Cause is supported by retained observations","Remedy is verified"]' \
  --turn-limit 8
gitjig goal inspect --goal GOAL_ID
gitjig goal run --goal GOAL_ID --revision REVISION
gitjig goal list
```

Use the revision returned by inspection for run/resume, pause/cancel, revise and extend. Run/resume uses the conversation's saved application model, including reviewer preferences. An explicitly selected external profile keeps its originating route. Project execution also requires the existing explicit runtime profile. For a fresh owner goal that assigns project work and integrates to an already registered local target, run/resume accepts `--delegate-projects P --max-assignments 2 --delegate-integrations P:TARGET_ID:1 --git-binary /absolute/trusted/git`. These remain finite original owner-entry permissions, not a grant issued by goal completion.

`goal resume --input INPUT_ID` acknowledges an exact pending owner input. `goal revise` takes `--objective`, `--criteria` and `--reason`. `goal extend` takes `--units` and `--reason`. `goal pause` and `goal cancel` take `--reason`. Management commands need no model or runtime and do not run pending work. Run/resume prints the final observed goal view: exit 0 means COMPLETED, exit 130 means interrupted by a signal, and exit 2 means another state, including a wait. Management commands return 0 when their requested operation succeeds.
