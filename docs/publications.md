# Inspect, reconcile and send original publications

Open `/repo`, then **Retained publications**. Select an original operation, then **Inspect original publication facts**. The list covers all projects, including publications with no project. Use the older/newer actions to page through it. No credential, model or execution engine is needed to browse.

The detail keeps three facts separate:

- **Recorded phase** is the phase retained in the local journal.
- **Transport outcome** records whether an original send started and whether its response was confirmed or uncertain.
- **Observed outcome** records retained correspondence with a remote resource.

A confirmed phase or matching resource is not current permission, proof of causal transport success, or completed software work. Inspection does not refresh remote facts. It cannot prepare, send, retry or reconcile an operation. Sending is a separate explicit reviewed action, available for an unsent prepared original. Read-only reconciliation is also available as a separate explicit action in this browser.

The CLI provides the same management path:

```sh
gitjig publication list --home /absolute/gitjig-home --limit 25
gitjig publication list --home /absolute/gitjig-home --before OPERATION_ID
gitjig publication inspect --home /absolute/gitjig-home --operation OPERATION_ID
```

List and inspect skip saved execution/model/bridge startup and producer recovery. They work when saved startup needs repair and preserve pending original and unrelated producers, consumed/reserved allowance and recorded uncertainty. Opening a conversation normally remains a separate startup/recovery path.

The registry checks historical identity, captured grant lineage and payload correspondence, not current eligibility. A same-target grant from an unrelated work is unavailable; cancellation or a later epoch does not erase a valid captured relationship. It includes cancelled or superseded work. Malformed or contradictory records appear as **Unavailable retained operation** with their original IDs. An unrecognized operation family also stays visible rather than being silently discarded. Consistently recognized integration/configuration families belong to their separate registries.

Pages contain at most 100 rows. Discovery bounds operation JSON to 1 MiB, target JSON to 128 KiB and grant JSON to 64 KiB before transfer. Each related evidence collection is limited to 256 rows, 2 MiB total and 1 MiB per data field before the original inspector reads it. Exceeding these inspection limits makes the original explicitly unavailable; no record is deleted or replaced. The terminal shortens large valid detail with a notice; the CLI returns the full bounded inspection.

Keep the reported operation, work and target IDs when investigating an unavailable record. The browser does not repair it or resend a request. For an uncertain send, use the original operation's read-only reconciliation route; do not create a replacement operation to bypass uncertainty. See [Capabilities and limits](capabilities.md) for publication support scope.


## Reconcile an uncertain original

For a retained `UNKNOWN` or `INVOKING` publication, select **Reconcile original publication · read requests only**. Review the original operation/work/target/payload identity and its execution allowance: limit, consumed and reserved. Choose **Reconcile original with read requests**, then provide the canonical path to a private repository credential file. Opening the menu or cancelling any prompt sends no request.

The original controller performs native read requests and records the result under the same operation and work. One accepted attempt consumes the original execution allowance, including a cancelled or unavailable attempt. No POST resend, replacement operation, grant renewal, work revival or allowance reset occurs. An unsettled original producer must finish its original recovery/cleanup first. Exhausted allowance refuses without another request; inspect the original work's allowance recovery rather than replacing it.

A matching resource can move the recorded phase to `CONFIRMED` while the original transport outcome remains `uncertain`. A missing or ambiguous resource stays `UNKNOWN`. Historical cancelled work can be reconciled where the original controller permits it; the read does not revive that work. After an outcome, the list rereads the original facts. Closing aborts and joins an accepted native read; its consumed allowance and any already recorded outcome remain retained. Late navigation does not move the outcome to another conversation.

The corresponding CLI remains `gitjig publication reconcile --operation OPERATION_ID --credential-profile FILE --home PATH`. Its native account/deployment prerequisites still apply. Neither an inspected record nor successful reconciliation authorizes another send, merge or software-completion claim.


An ordinary agent can use `effect_reconcile` for its original uncertain publication while its own healthy conversation is running. This is a read action under captured scope. It retains the parent conversation and charges one publication-read attempt in addition to the conversation execution. Other unfinished producers, uncertain cleanup or exhausted allowance still block it. Cancelling the tool, stopping the parent or closing the application aborts and joins the read. The result retains the original transport uncertainty and never authorizes another send.


## Send an already prepared original

Select a `RESERVED` original, then **Review and send original prepared publication**. This sends a remote write and can notify people. The review shows the exact target, action, visibility, permitted mentions and the complete sealed carrier, including the generated operation marker. Check its byte length and hash. Characters that the terminal would remove are shown as JSON Unicode escapes. The review divides long content into bounded pages without shortening it. Use the scroll controls to inspect each page; closing a page opens the next one. Confirmation appears after all pages. Choose Back there to leave without sending.

The default choice is **Back without sending**. To send, choose **Send this original prepared publication**, then enter the private repository credential file path. Changing original bytes, authorization, source or allowance while the form is open refuses the stale form. The original controller rechecks native account/action capability and approved bytes before handoff. Other unfinished producers and exhausted allowance block admission.

One admitted attempt consumes the original execution allowance, including a preflight refusal or an uncertain outcome. Inspect the actual returned phase: `REFUSED` before handoff does not mean publication; `UNKNOWN` after possible handoff requires read-only reconciliation. The browser offers no send action for uncertain or confirmed originals. Closing joins accepted requests and preserves any possible remote effect; it cannot promise to undo a POST. Do not create another original to bypass uncertainty.

This entry sends an already prepared original. It does not prepare or edit publication content, grant new permissions, certify software completion or land a change. A separate [contribution action](repository-contributions.md#prepare-a-summary-publication) prepares a retained host summary. Other publication preparation retains its explicit CLI/agent paths and native profile restrictions. Source and fresh installed terminal journeys exercise this orchestration with synthetic native API responses, including an accepted POST followed by shutdown and explicit original read reconciliation. Live-service qualification remains separate.


## Resume refused owner-summary preparation

For an unsent owner contribution summary in `REFUSED`, choose **Resume original owner summary preparation · no send**. This route requires the original owner/source/grant relationship, unchanged target policy, healthy settled work and remaining allowance. It cannot revive cancelled or interrupted work. A possibly sent original requires read-only reconciliation instead.

Review every page of the previous and current local summary, including revision, membership, body/hash and original IDs. The current summary must be complete and address the same native parent. It may be a newer local revision. The default is **Back without preparing**. Choose **Prepare current summary on this original**, then supply the private credential file to authorize a fresh preflight. No POST occurs. One admitted attempt consumes remaining original allowance, including refusal or cancellation.

Recovery keeps the operation, work, target and grant. It retains previous authorization, catalogue proof and sealed bytes in the original history. If another original already addresses the current revision, inspect that reported original instead; recovery cannot create a second identity for it. Source, membership, policy or allowance drift refuses the stale form. Accepted outcomes remain under the original IDs if you navigate or close. Sending a recovered `RESERVED` original still requires its separate exact-carrier review.

Source terminal coverage includes recovery onto a newer complete summary. A fresh installed CLI/TUI journey also exercises a native scope refusal, inspection and default-Back cancellation without requests or spend, same-original preparation recovery with retained prior proof, and separate sending. Native service responses are synthetic; live-service qualification remains separate.
