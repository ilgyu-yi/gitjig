# Find retained repository contributions

Audience: users tracking and inspecting existing GitHub issues and pull requests. Contribution tracking currently uses GitHub.com. Gitea/GitLab repository configuration and policy inspection do not provide their issue/PR contribution tracking.

## Track an existing issue or pull request

In `/repo`, register a GitHub repository through **Register repository**, then choose it from **Registered targets**. Select **Track existing issue or pull request**, choose the kind and enter its existing positive issue/PR number. The scope view shows the exact repository IDs and resource request. Enter the canonical path to a private credential file when asked; never enter token text in a normal field. No repository profile file or internal resource ID is needed.

This action sends read requests to GitHub.com and stores local observations. It does not create a remote issue or PR, edit policy, publish or merge. The native reader rechecks repository/resource identities. It uses the supplied credential for read access; it does not authenticate the registered target's actor or certify that actor's authority. An already tracked resource is refreshed under its original ID, rather than registered again.

Gitea/GitLab targets do not offer this GitHub-only action. Cancelling any field or credential prompt sends no contribution request. Changed target/source before dispatch refuses. Once a request is accepted, its original local result may remain even if you navigate away or close; find it through the retained list. Shutdown aborts and joins owned requests and does not claim rollback of completed observations.

## Open the retained list

Open `/repo`, then **Tracked issues and pull requests**. The list shows repository, issue/PR number, retained merge observation, missing-facet count and original resource ID. It is independent of the selected conversation project. You do not need a model, execution engine, credential file or remembered internal ID to browse it.

**Inspect retained observations** opens the original stored identity and attributed observations. This does not contact GitHub, refresh facts, recover pending work, settle allowance or grant review/merge authority. A merge observation is historical; it is not a current permission or whole-workflow acceptance decision. Empty means no resources are tracked in this home, not that the repository has no contributions. Contradictory identities or unavailable registration provenance appear as **Unavailable retained resource**; inspection does not repair or replace them.

The registry covers the existing limit of 16 tracked resources per home. An inventory above that limit refuses rather than silently dropping entries. The CLI provides the same bounded management read:

```sh
gitjig repo resources --home /absolute/gitjig-home
gitjig repo contributions --resource RESOURCE_ID --home /absolute/gitjig-home
```

These CLI management operations bypass saved model/bridge/runtime setup and can inspect retained records when that setup needs repair. They preserve pending original producers and their consumed/reserved allowance. Repair startup through `setup inspect/save/clear` before entering an execution path; listing does not activate the broken setup.

## Prepare a local summary

Choose **Prepare local summary revision · no publication** for an explicit local operation over the current retained contribution projection. It can include merged tracked descendants routed through the existing summary-parent links. The result identifies its exact resource, revision, membership fingerprint, body, completeness and missing facets. Repeating preparation for the same fingerprint returns the same revision.

Preparation can add local summary-revision/member records. It performs no remote refresh, publication, model turn or agent work and changes no original observation, work or budget. It prepares the current retained projection; an earlier inspected view is not a frozen approval of that projection. Source or selected-resource changes while an action menu is open refuse the stale selection.

The corresponding CLI is:

```sh
gitjig repo summary --resource RESOURCE_ID --home /absolute/gitjig-home
```

`complete: true` means the declared summary facets were observed within their native endpoint scope. It does not establish test adequacy, independent review, historical authority, current workflow acceptance or publication. `publication: not-prepared` remains explicit. No merged contribution or missing facets produce an incomplete result; the CLI returns exit 2 while retaining that local revision. The terminal shortens very large detail with an explicit notice; use the original CLI command for full JSON.

## Refresh explicitly

Choose **Refresh selected native observations · read requests** on an original retained resource, then provide its private credential-file path. This is an explicit one-resource read, not a background collector. The result distinguishes `observed` from `unavailable` and preserves missing-facet diagnostics. `observed` can still have missing facets; command settlement alone does not establish successful or complete observation. A failed refresh retains the original resource/native identity and previous observations. It does not reset work or allowance, allocate replacement tracking or publish a summary. After the outcome, the list rereads the changed retained facts.

Contribution and repository-configuration UI requests share a credential-session lease. A competing request refuses while the first owns that session. Target/resource/source are rechecked after credential reading and immediately before dispatch. Menu inspection and cancelled credential entry neither configure a reader nor send requests.

Opening the list does not begin collection. Existing explicit network operations remain separate: `repo track --repository-profile FILE --kind issue|pull-request --number N --credential-profile FILE`, `repo refresh --resources RESOURCE_ID --credential-profile FILE`, and `repo parent --resource CHILD_ID --parent PARENT_ID --revision N --credential-profile FILE`. All accept `--home /absolute/gitjig-home`. Parent changes re-observe endpoint identities; refresh updates selected retained facts and can record missing observations. They require the applicable private GitHub credential and native access, but no model or execution engine. A private repository profile contains the exact `owner`, `repository`, `repositoryId` and `repositoryNodeId` obtained from GitHub; credentials and profiles remain outside registered projects.

## Change a summary parent

On a retained issue or PR, choose **Edit summary parent · local routing**. Select another tracked issue/PR in the same base repository, or **Remove current summary parent**. The menu shows the current parent and link revision. An unavailable current parent remains visible and can be removed; an existing unlinked record keeps its revision. Unavailable resources, the selected child and resources in another native repository are not offered as new parents.

Review the child, prior/next parent and expected revision. Choose **Save summary routing**, then provide the private credential-file path. Cancelling any step sends no parent request. The original reader rechecks native endpoint identities before recording the local owner link. Revision, cycle or changed-identity failures refuse the link. Opening the editor performs no network request.

This link changes membership in future contribution summaries. It does not change hosting issue relationships, agent or conversation ancestry, review authority, or earlier summary revisions. No summary is prepared or published automatically. After saving, return to the parent resource and explicitly prepare a summary if needed. Accepted outcomes keep the original child ID through navigation; closing aborts and joins a pending read without claiming rollback of completed links.

The CLI remains available as `repo parent --resource CHILD_ID --parent PARENT_ID --revision N --credential-profile FILE`; omit `--parent` to unlink. Publication preparation and sending are separate explicit actions described below. Use [Publication records](publications.md) to find and inspect already prepared original operations. Other providers' contribution tracking, complete contribution delivery and live-service qualification remain separate work. Do not treat this retained browser as complete repository adoption or contribution delivery; see [Capabilities and limits](capabilities.md).


## Prepare a summary publication

First use **Prepare local summary revision · no publication**. To prepare that retained revision, select **Prepare publication from current local summary · no send**. An absent, incomplete or stale local summary refuses preparation; refresh observations and prepare the current local revision first.

Choose an existing publication target for the exact same GitHub repository. Its actor, visibility and carrier policy remain in effect. Alternatively, choose **Register default-policy target from retained repository identity**, then select a matching registered GitHub identity. This explicitly creates a new target with no allowed mentions and no configured private literals; it does not copy another target's custom policy or grant repository permissions. Register the repository through `/repo` first if no matching identity exists.

Review all pages of the host-generated summary, its original revision/membership and target. The body cannot be edited under that proof. The default is **Back without preparing**. Choose **Prepare this exact summary publication**, then supply the private repository credential file. Registration occurs only after credential acceptance. Preparation can create the original work, scoped grant and finite allowance, then consume one attempt for native preflight reads. It sends no POST. Closing joins the reads and retains admitted records and spend.

Inspect the actual returned phase and original IDs. Repeating a successful preparation reuses its original operation and usage. An uncertain earlier send blocks a replacement for the same resource lineage, including a newer summary. A refused preparation remains retained and is not a sent summary. For an unsent owner summary, use its [explicit original preparation recovery](publications.md#resume-refused-owner-summary-preparation), preserving original identity and remaining allowance. To send a `RESERVED` original, return to **Retained publications** and use its separate [exact-carrier review and send](publications.md#send-an-already-prepared-original).

Source and fresh installed terminal journeys cover this path with synthetic native API responses. Live-host qualification, arbitrary publication composition and complete repository delivery remain separate.
