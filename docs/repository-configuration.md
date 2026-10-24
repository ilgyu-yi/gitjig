# Configure native repository settings

Audience: repository administrators using Gitea or GitLab. The source CLI and `/repo` terminal command use no model or execution engine. GitHub has a separate configuration profile described in [Usage](usage.md). These native configuration paths have owned HTTP/TLS fixture coverage. A fresh npm installation also exercises recommendation fields and customization through separate preview, default Back, explicit application, native readback/audit and developer guidance. GitLab original-plan reconciliation preserves a repository-setting change and a protection creation whose response was lost. Live server compatibility, immutable offline bundles and other installed combinations remain separately unverified.

## Use the terminal interface

Open `/repo` in an ordinary or unbound conversation, or select Repository management from `/ready`. Repository targets are global owner configuration records, independent of the conversation's selected project. Inspect the displayed provider, API base, repository and actor; choosing a conversation does not retarget an existing plan.

An empty target list offers **Register repository** directly. Preview and outcome screens show the recorded status, next menu action and selected before → intended values first. Audit screens distinguish fresh matching, conflicting or unavailable observations from the historical operation status. Scroll to **Original observation · details** for the captured record. Native setting names and explicit false, zero and empty values remain intact; an unavailable field never means an unrestricted policy.

- **Register repository** asks for provider, explicit native API base, owner/namespace, repository and the canonical path to a private credential file. It observes identity without a model turn or policy write. Enter the file path, never token text.
- **Registered targets** offers identity inspection, **Inspect current branch policy**, a new configuration preview and plans for that exact target. **Retained configuration plans** finds original work without typing internal IDs. Opening either list does not recover work, consume allowance or contact a hosting service.
- **New configuration preview** can start from editable recommendation fields or import an existing private desired-profile file. The field editor stages changes in memory. Invalid field values or an invalid preview show the reason and return to the staged editor for correction. `Leave unmanaged` omits a setting; `false`, zero and an empty status-context list are explicit values. Cancelling does not change native policy or a retained plan. GitHub exposes common review/merge fields; use private profile import for its advanced patterns, status-check/bypass selections and other supported profile structure. Native recommendations first ask whether to update an existing rule or create a new one; update is the default. Creation exposes initial priority or role choices in the same editor. Native field scope is listed below.
- Using a staged profile displays it before asking for credentials and admitting the preview. A preview retains its original plan/work and never applies automatically. The outcome is inspectable even when a request fails after admission.
- A plan offers inspection, read-only reconciliation/audit and **Review changes for application**. Review shows the exact target, original plan/work/revision, selected before/intended values, preservation and native limitations. It then offers Back by default and a separate explicit Apply action. Entering through inspection cannot apply settings. The action rechecks source and original plan after every form/credential read; it refuses a stale selection.

**Inspect current branch policy** asks for an explicit existing branch and the private credential-file path, then uses the same registered-target observations as `repo guide`. The scrollable result identifies the provider/base, registered target and branch. It preserves native OBSERVED/UNAVAILABLE values and visibility limits; it is not complete applicable policy or an action-permission decision. Reading needs no model, execution engine or write authority and does not settle pending configuration writes, create work or consume its allowance. Opening the menu or cancelling sends no request. A changed source or selected target refuses; late navigation cannot show the original result in another conversation. Closing joins the owned read. Use [Repository inspection](repository-inspection.md) to interpret provider-specific fields.

One terminal configuration action owns its credential session until its original request settles; a competing action refuses instead of replacing it. Credential files are read transiently and are not saved as conversation input or history. Completed or uncertain requests retain their original IDs. Navigation cannot redirect accepted work. Normal shutdown aborts and joins owned requests before disposing the UI; a post-handoff interruption can remain UNKNOWN and must use original-plan reconciliation. Closing the screen is not rollback. File-read failures do not echo file contents or mistaken secret input.

Revised previews and GitHub created-rule ownership continuations still use their existing CLI/API options (`--continuation-plan` and `--owned-creation-operation`). The terminal does not silently allocate a replacement plan to resolve uncertain work.

The terminal journey has actual source UI coverage against an owned HTTPS API with synthetic responses and process/model tripwires. It includes missing-rule creation with typed initial role choices. A fresh npm-installed terminal also customizes Gitea approvals/priority and GitLab initial roles while retaining its selected pipeline/discussion settings. Developer guidance observes those actual applied values without new work or allowance use. Missing or denied policy observations remain unavailable; hidden approval-group metadata is retained, and a different actor or repository refuses. After a lost GitLab creation response, discovery and read-only reconciliation retain the original plan and both setting/protection steps without replay. This does not qualify a live server, every installed combination or an immutable offline bundle, establish agent standing or certify a complete agent workflow.

## Choose the target and profile

Use an existing administrator access token in a private credential file as described in [Repository inspection](repository-inspection.md). All target, desired-profile and credential files must be private, owner-owned regular files outside registered projects. Do not put tokens in arguments or URLs. The selected canonical HTTPS API base receives the token.

The usual entry observes the authenticated actor and repository IDs for you, without a target file:

```sh
gitjig repo register-target --home /absolute/gitjig-home --provider gitea \
  --api-base https://forge.example/api/v1 --owner team --repo service \
  --credential-profile /absolute/private/token.json
```

For GitLab, select `--provider gitlab`, its `/api/v4` base and full group/subgroup namespace. Registration makes four identity GETs, rechecks the actor and repository, and stores the exact observed target. It does not read policy inventories, require administration merely to register, or establish write permission. GitLab rechecks by numeric project ID. No model, work, run or effect grant is created. Actor/path/identity drift refuses registration. Repeating the same identity returns the same target; a different identity becomes a separate target and cannot rebind an old plan.

Alternatively, a Gitea target file contains exactly these fields:

```json
{"provider":"gitea","apiBase":"https://forge.example/api/v1","repositoryId":9,"owner":"team","repository":"service","actorUserId":7}
```

For GitLab, use `"provider":"gitlab"`, its API base ending in `/api/v4`, the numeric project ID and the complete namespace, such as `"owner":"group/subgroup"`. Obtain actual IDs from the native service; these example IDs are placeholders. The current credential's actor, repository ID and namespace must match the target. Configuration preview/apply require observed repository administration on Gitea, or observed project/group Maintainer or Owner access on GitLab. These observations do not prove token write scopes or authority to merge; the native endpoint makes its own permission decision.

Generate an editable starting profile without creating an installation home:

```sh
gitjig repo recommend --provider gitea --branch main
# Or: gitjig repo recommend --provider gitlab --branch main
```

Save the edited JSON privately. Recommendations default to updating an existing named protection rule. Use `--mode create` for an explicit new-rule profile. A small Gitea profile is:

```json
{"provider":"gitea","version":"team-policy/v1","repository":{"allow_merge_commits":false},"protection":{"name":"main","fields":{"required_approvals":1,"dismiss_stale_approvals":true}}}
```

A GitLab profile can select project merge settings and existing project-owned protection fields:

```json
{"provider":"gitlab","version":"team-policy/v1","repository":{"only_allow_merge_if_pipeline_succeeds":true,"only_allow_merge_if_all_discussions_are_resolved":true},"protection":{"name":"main","fields":{"allow_force_push":false}}}
```

Either group can be omitted. Select only fields you intend to manage. Unsupported keys, duplicate keys, invalid types and missing selected native fields refuse. Inherited or unknown-ownership GitLab rules refuse. Deletion, rename and edits to existing principal/access-level arrays are not supported by this path. Use the native administration UI/API for those operations; full repository adoption remains incomplete.

## Create a missing protection rule

Generate a creation profile with `gitjig repo recommend --provider gitea --branch main --mode create`, or select `gitlab`. In the terminal editor, select **Create new rule**. Preview and Apply use the same retained plan lifecycle as updates. Creation is never inferred from a missing rule during an update.

A small Gitea creation profile is:

```json
{"provider":"gitea","version":"team-policy/v1","protection":{"name":"main","mode":"create","initial":{"priority":1},"fields":{"enable_push":false,"block_admin_merge_override":false,"required_approvals":1,"dismiss_stale_approvals":true}}}
```

Gitea requires initial priority from 1 to 100 and explicit `enable_push` and `block_admin_merge_override`. Creation also sends and verifies inactive push, merge, approvals, force-push and bypass allowlists. Other omitted native fields use server defaults and are not certified. The recommendation supplies the supported protection fields explicitly; inspect them before applying. Priority and overlapping rules can affect effective policy beyond the selected rule.

A GitLab creation profile is:

```json
{"provider":"gitlab","version":"team-policy/v1","protection":{"name":"main","mode":"create","initial":{"push_access_level":0,"merge_access_level":40,"unprotect_access_level":40},"fields":{"allow_force_push":false,"code_owner_approval_required":false}}}
```

GitLab requires all three initial role levels: push and merge accept 0 (no access), 30 (Developer) or 40 (Maintainer); unprotect accepts 30 or 40. The recommendation uses 0/40/40. Initial grants are role-only. Readback checks each complete access array, including absence of additional user, group, deploy-key or member-role grants. Custom principals, role 60 and inherited rules remain outside this scope. Licensing can make code-owner settings unavailable; an unobservable selected field cannot confirm success.

Both providers accept literal creation rule names, not wildcard patterns. Preview requires a complete visible inventory that lacks the exact name, with another check before handoff. A denied lookup, 404 or partial inventory cannot establish absence. Creation uses POST and never updates a same-name rival rule. Another administrator can still create or change a rule after preflight; the endpoint decides the outcome, which can remain UNKNOWN.

GitLab's validated returned rule ID is retained even if subsequent readback fails. Later audit and reconciliation pin that ID and refuse a replacement with the same name. After a lost response, a first validated read can record the currently observed identity. Matching names and values account for current configuration; they do not prove that gitjig created or owns the rule. Gitea's name-based resource path cannot distinguish same-name recreation. Never replay an uncertain POST or delete a rule to compensate. Use original-plan read-only reconciliation.

## Supported profile fields

| Provider/group | Fields and types |
| --- | --- |
| Gitea repository | Boolean `allow_merge_commits`, `allow_rebase`, `allow_rebase_explicit`, `allow_squash_merge` |
| Gitea protection | Integer `required_approvals` from 0 to 100; distinct `status_check_contexts` strings (at most 100, each at most 256 bytes); boolean `enable_status_check`, `dismiss_stale_approvals`, `ignore_stale_approvals`, `block_admin_merge_override`, `block_on_rejected_reviews`, `block_on_outdated_branch`, `block_on_official_review_requests`, `block_on_codeowner_reviews`, `require_signed_commits`, `enable_force_push`, `enable_push` |
| GitLab repository | `merge_method`: `merge`, `rebase_merge`, or `ff`; `squash_option`: `never`, `always`, `default_on`, or `default_off`; boolean `only_allow_merge_if_pipeline_succeeds`, `allow_merge_on_skipped_pipeline`, `only_allow_merge_if_all_discussions_are_resolved` |
| GitLab protection | Boolean `allow_force_push`, `code_owner_approval_required` |

Native versions, licensing and permissions can make selected fields unavailable. Omission is not a default value or successful enforcement. Gitjig refuses a selected field it cannot observe with the required type.

## Preview, apply and audit

```sh
gitjig repo register-target --home /absolute/gitjig-home \
  --target-profile /absolute/private/target.json

gitjig repo preview --home /absolute/gitjig-home --target TARGET_ID \
  --profile /absolute/private/desired.json \
  --credential-profile /absolute/private/token.json

gitjig repo apply --home /absolute/gitjig-home --plan PLAN_ID \
  --credential-profile /absolute/private/token.json

gitjig repo audit --home /absolute/gitjig-home --plan PLAN_ID \
  --credential-profile /absolute/private/token.json
```

Registration returns TARGET_ID; preview returns PLAN_ID and the original work ID. Inspect selected before/intended values, sparse request payload, preserved settings and limitations before applying. The existing controller journal retains the operation, work, finite execution allowance and per-field observations across commands. `repo plan --home /absolute/gitjig-home --plan PLAN_ID` reads that retained plan without credentials or dispatch. Invalid saved model/runtime setup does not block these commands.

Requests omit unselected native fields. They do not claim atomic compare-and-swap: another administrator can change settings between preflight and update, and a Gitea rule recreated with the same name cannot be distinguished atomically. Known relevant drift refuses the old plan. Readback reports current selected values; it does not prove causation or complete effective policy. Native HTTP rejection, lost response or incomplete readback after handoff retains UNKNOWN rather than claiming no effect.

## Find retained targets and plans

```sh
gitjig repo targets --home /absolute/gitjig-home
gitjig repo plans --home /absolute/gitjig-home --target TARGET_ID
```

These commands read the existing ledger without credentials, model/runtime setup, network calls or recovery. Use the returned target ID to preview and the original plan ID to inspect, audit or reconcile. Each plan lists its original work, recorded phase/revision, target identity and saved next action. These are retained records, not refreshed policy or permission observations. Incomplete or contradictory recognized records are UNAVAILABLE.

Both lists default to 50 entries. Select `--limit 1..100`; pass the returned `nextCursor` as `--before` on the same list and target filter. Newer records do not reorder older pages. An invalid or out-of-scope cursor refuses rather than silently restarting. Listing a pending operation never settles its allowance or transmits its request. The `/repo` terminal command uses the same paged records and supports common field edits; these CLI commands remain available for automation.

## Recover without replay

```sh
gitjig repo reconcile --home /absolute/gitjig-home --plan PLAN_ID \
  --credential-profile /absolute/private/token.json
```

Reconciliation only reads the exact original resource. Matching current fields can confirm the original step. If that resolves all uncertainty, a later explicit apply can perform remaining unstarted steps; it never resends an uncertain original request. Partial or unavailable observations remain UNKNOWN. A pending native intent blocks other writes and no-op confirmation for the same provider, API base and repository ID, including operations opened with another actor target. A revised native preview cannot clear that uncertainty. Inspect the original observations with the administrator through the native UI/API when necessary. Gitjig does not automatically widen rights, retry writes or roll back intervening edits.

Use [repository inspection](repository-inspection.md) for visible effective requirements and their coverage limits. `repo guide --home HOME --target TARGET_ID --branch BRANCH --credential-profile FILE` binds those native observations to the registered actor and repository IDs; another actor or replacement repository refuses rather than silently rebinding the target. Updating configuration does not approve agent work, establish independent platform review or authorize a merge.
