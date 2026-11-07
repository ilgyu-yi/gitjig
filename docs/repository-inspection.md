# Inspect repository requirements

Audience: repository administrators and developers who need current native observations before work. This operation needs no agent plan, model or execution engine. It does not apply configuration, approve work or authorize a merge.

## Select the provider and credential

`repo inspect` defaults to GitHub.com. Gitea and GitLab require an explicit HTTPS API base, including its API suffix. A self-hosted installation prefix is supported. Use the canonical URL without user information, query, fragment, encoded path aliases or dot segments. The API base receives the selected token; choose the intended trusted host.

Create an owner-only JSON file outside every registered project, using an existing access token:

```json
{"token":"YOUR_EXISTING_ACCESS_TOKEN"}
```

The file must have a canonical absolute path, one owner-owned regular file, private permissions and at most 16KiB. Duplicate keys and additional fields refuse. Tokens do not belong in command arguments, project files or URLs. Gitjig does not import ambient hosting CLI credentials. Gitea uses its access-token header; GitLab uses PRIVATE-TOKEN for access tokens. Browser cookies, job tokens, OAuth refresh and impersonation are not configured by this entry.

```sh
gitjig repo inspect --home /absolute/gitjig-home \
  --owner OWNER --repo REPOSITORY --credential-profile /absolute/private/token.json

gitjig repo inspect --home /absolute/gitjig-home --provider gitea \
  --api-base https://forge.example/api/v1 --owner OWNER --repo REPOSITORY \
  --credential-profile /absolute/private/token.json

gitjig repo inspect --home /absolute/gitjig-home --provider gitlab \
  --api-base https://gitlab.example/team/api/v4 --owner GROUP/SUBGROUP --repo REPOSITORY \
  --credential-profile /absolute/private/token.json
```

Add `--branch feature/name` to inspect an explicit existing branch. Otherwise the observed default branch is selected. Empty repositories or missing branches have unavailable branch observations. The Gitea owner is one namespace segment; GitLab supports nested group paths. GitHub remains fixed to GitHub.com and rejects a custom API base. Gitea/GitLab settings and explicit protection creation have a separate [configuration path](repository-configuration.md). Contribution and governed hosting effects retain their separately documented GitHub support scope.

TLS certificates must be trusted by Node. Configure an appropriate trusted CA for a self-hosted service when necessary; disabling TLS verification is not accepted. Requests use the selected origin and installation prefix. Redirects and server-supplied alternate origins are not followed. There is no automatic retry or credential fallback. Invalid saved model/runtime setup does not prevent inspection.

Registered targets also expose **Inspect current branch policy** in `/repo`. Choose the explicit branch and private credential-file path. This calls the registered-target guide, rechecks the actor/repository identity and displays the current typed observations and limits without creating work or applying settings. Pending configuration remains pending. Registration and inspection do not require observed administration; applying configuration has its own stricter preconditions.

## Read the result

Gitea and GitLab return selected actor/repository identity, branch and head, allowlisted native observations, request status/body digests, limitations and a next action. Raw user/repository/error bodies and clone tokens are not returned. Each field or endpoint is OBSERVED with a value, or UNAVAILABLE with a reason. False, zero, explicit null access selectors and empty lists retain their native values; a missing or malformed field receives no default.

| Provider | Observations | Interpretation limits |
| --- | --- | --- |
| GitHub.com | Existing repository/ruleset/effective branch/classic observations | Its existing observer has its own result shape and coverage limits. Configuration and governed effects use their separate native profiles. |
| Gitea | Merge settings, branch protection summary, visible protection inventory and the rule named effective by the native branch response | Older versions may omit effective-rule fields. Gitjig does not guess wildcard precedence. A missing, ambiguous or contradictory selected rule is unavailable. |
| GitLab | Project merge/pipeline/discussion settings, branch summary, visible protected-branch inventory, project approval rules and approval configuration | Inherited flags and hidden-group indicators are retained when present. Project inventories do not establish complete group, CODEOWNERS, request-specific or external-check coverage. Licensing and permissions can make individual endpoints unavailable. |

For Gitea/GitLab, exit 0 and OBSERVED mean the selected endpoints were observed, not that all fields or policies are known. Exit 1 and PARTIAL mean a requested endpoint or applicable Gitea effective-rule selection is unavailable; inspect the supplied reasons. Exit 2 means invalid input, mandatory identity/drift failure, exhausted operation bounds or cancellation. GitHub retains its existing successful-read result and exit behavior. HTTP 401/403/404 never means that a rule does not exist. Missing approval information is not zero required approvals.

Native can-push/can-merge booleans and access-level values are observations. They are not effective action permissions or agent standing. Ask the repository administrator about unavailable or inherited conditions and inspect the actual pull/merge request before integration. These reads do not replace independent review or actual account authority.

## Bounds and recovery

Gitea/GitLab inspection has a 30-second overall bound and default per-request limits of 5 seconds and 1MiB. The operation allows at most 100 requests,8MiB of response bytes and 10,000 collection items across all reads and rechecks. Response-byte accounting includes error and invalid-JSON bodies. Aggregate exhaustion stops further dispatch and produces no complete view.

Gitea protection inventory follows its native unpaginated contract: one bounded GET without `page` or `limit`, returning the complete visible array. Duplicate or malformed rule identities, unexpected continuation, or a declared total that differs from the returned count make the inventory unavailable. It never follows a collection link or probes another Gitea page. This matches the [Gitea endpoint contract](https://docs.gitea.com/api/operations/repo-list-branch-protection/) and [native implementation](https://github.com/go-gitea/gitea/blob/main/routers/api/v1/repo/branch.go).

GitLab pagination validates the selected origin, exact endpoint, query scope and consecutive page. Where its offset endpoints omit continuation headers or cap page sizes, it probes the next fixed page until an empty page. Contradictory terminal metadata, repeated identities, ignored pagination or later-page failure make the inventory unavailable; a successful prefix is not an empty or complete list. This can add one read beyond the last populated page.

Repository, actor and branch rechecks detect known identity drift. They do not make separate rule reads atomic. If a target changes, refresh deliberately after checking its current identity. For unavailable endpoints, verify token permissions, native version and feature availability without widening rights automatically. For request/size limits or unsupported schemas, inspect the native UI/API and retain the unavailable result rather than treating it as a pass.

The current Gitea/GitLab evidence covers actual source CLI and fresh npm-installed CLI/TUI boundaries against owned API fixtures with synthetic responses and tokens. The installed administrator-to-developer path customizes native settings through common fields, applies/readbacks/audits them, and observes their exact current values through registered-target guidance. Partial policy visibility and actor/repository identity refusal preserve work, allowances and native settings. This does not qualify a live Gitea/GitLab release, every configuration profile, hosted merge, immutable offline bundles or whole-workflow maturity. See [Capabilities and limits](capabilities.md).

A separate installed administrator-to-local-developer journey ties the observed branch/head to an actual owned bare repository and developer clone. After explicit manual guidance handoff, the developer uses a separate home and Git identity for selected local conventions, real isolated checks, a separately created native commit and historical MATCH/MISMATCH audit. Administrator plans and native settings stay unchanged. This is current npm installation coverage with owned synthetic hosting responses, not live hosting or merge authorization; see [local development](local-development.md#follow-repository-guidance).

API references: [Gitea branch observations](https://docs.gitea.com/api/operations/repo-get-branch/), [Gitea authentication/pagination](https://docs.gitea.com/development/api-usage/), [GitLab protected branches](https://docs.gitlab.com/api/protected_branches/), [GitLab approvals](https://docs.gitlab.com/api/merge_request_approvals/), and [GitLab REST pagination](https://docs.gitlab.com/api/rest/).
