# Accounts and providers

Choose application-managed accounts/models or an explicitly selected external profile. These routes keep separate credential sources. A missing selected credential does not trigger an automatic account or provider fallback.

## Application models and accounts

The source CLI now provides `auth status`, terminal `auth login --provider ID --method api_key|oauth`, `auth logout --provider ID`, and `models list/default/scope/configure`. These use the selected gitjig home's private config files and original Pi auth APIs. Status reports stored/configured state, not verified entitlement. Logout removes the stored credential; an explicitly configured literal key in models.json remains configured and is reported as such. No account is imported from stock Pi automatically.

Model management, conversation UI and role selection use the same saved application choices. New work captures its selected account/model; changing a preference does not silently retarget existing work. Account changes can invalidate a pending selection and require a fresh execution. History remains available. For Claude Code, open `/bridge`, select the native client/login source, explicitly check the reported account, and review Connect. The guided [startup setup](startup.md) pins the client and prepares private bridge settings; close and relaunch before selecting the registered model. You do not need a legacy profile on every launch.

For retained project work, the first-screen guidance and `/ready` inspect the original work's next stage and its role-model choices. A configured conversation model does not repair a missing account for that work. `/ready` identifies the missing provider or configuration and explains the recovery path. Existing work or conversation obligations can hold account and role-setting changes; follow the displayed inspection and cancellation guidance before changing settings. Cancellation does not undo prior effects or reset spent allowance. After repair, explicitly resume the same work with `/change resume ID`. Work using an explicit external profile instead needs that original profile on reopening. These inspections report local prerequisites, not verified service entitlement.

In `/model` and `/model-default`, choose **Inspect model routes and application scope** to inspect connection-route diagnostics, future application defaults and cycling patterns. The screen reports configuration facts, not account entitlement or a successful request. Approved project overrides can differ; use `/settings` to inspect their effective sources. You can select catalogue models before login. `/model` changes the current conversation, `/model-default` changes future defaults, and `/thinking` changes only the current conversation. Navigation or close during an unfinished selection refuses a stale write and preserves the original choice and draft.

Managed sessions disable Pi installation telemetry. The CLI ignores `PI_TELEMETRY` at startup; ordinary provider request headers remain managed by Pi.

## Supported scope

[Current capabilities and limits](capabilities.md) describes the supported environment. Catalogue presence does not establish account entitlement or successful execution. The bridge graph uses upstream 0.9.0 / gitjig derivative 0.9.0-gitjig.11 with Claude SDK 0.3.284; Pi is official 1.3.0.

The Claude bridge preserves the native client's required built-in security policy for subscription organizations. Optional authoring and user plugins are excluded; the original role-filtered tool and MCP checks still apply. Native organization policy can run its configured hooks outside the project executor. Native process ownership and cleanup apply to that route; project isolation does not certify those policy actions.

Provider availability, account entitlement and billing terms depend on the selected external service. Support for one model does not establish support for every catalogue model. No configured path silently replaces a subscription with API billing.

## Explicit external stored-credential profiles

This section applies to an explicitly selected `--model-profile` with `native.kind:pi-stored`. It is an opt-in external credential route. Normal application-managed models use Gitjig account/configuration files and the shared resolver described above. The external profile table and its header policy do not define the whole managed catalogue.

Keep the model profile and credential file outside registered projects. Use canonical absolute paths and owner-private regular files. On POSIX, use mode 0600. The source must have one link and be at most 128KiB. gitjig rejects symlink aliases, project-owned sources and unsupported fields.

For example, a model profile can contain:

```json
{
  "provider": "openrouter",
  "modelId": "openai/gpt-4.1-mini",
  "native": {
    "kind": "pi-stored",
    "credentialType": "api_key",
    "authPath": "/absolute/private/auth.json"
  }
}
```

Use the intended credential already stored through the selected Pi configuration. gitjig does not log in, inspect an account or migrate credentials during profile selection. Do not place a key in this model profile. The selected Pi credential record must contain only its supported type and nonempty literal key for the initial API-key paths. Helper expressions, environment substitutions and provider-env fields are unavailable in this profile.

| Provider | Credential type | Admitted chat API | Protocol policy |
|---|---|---|---|
| openai-codex | oauth | openai-codex-responses | SSE; zero implicit retries |
| openai | api_key | openai-responses | Original Pi transport; zero implicit retries |
| openrouter | api_key | openai-completions | Original Pi transport; zero implicit retries |

Select a model that the pinned Pi catalogue maps to the admitted API. The common factory has no fixed model ID. An unknown model, provider, auth type or API refuses before generation. OpenRouter's other APIs, images, classifiers and virtual routing do not inherit this scope.

An execution privately retains its selected API key. Later requests check that the selected credential is still valid. Formatting and unrelated records do not change it. A removed, empty or changed selected key refuses with a recovery message. Start a fresh execution with the intended valid source to use a rotated key; the conversation can retain its native history. An already dispatched request is not atomically revoked by a later file edit. Credential values and key hashes are not shown in model/run evidence.

OAuth continues through Pi's original authPath store and serialized refresh/persistence. Normal token rotation stays owned through completion, including after caller cancellation. It does not count as an API-key snapshot change. Pi summaries can forward already resolved auth only when it still matches the selected source; another key or environment override is refused.

Stored profiles preserve the authentication headers selected by Pi. Overrides that change authentication or add unsupported headers are refused before transport. The normal Pi OpenRouter attribution callback can add its three documented metadata headers (HTTP-Referer, X-OpenRouter-Title and X-OpenRouter-Categories). Other header customization is outside this finite profile.

Pi's availability refresh can inspect ambient metadata for other builtins. This is distinct from generation fallback. A missing selected credential never grants permission to dispatch through another account/source.

## Existing selections

- `native.kind:pi-oauth` remains the exact legacy openai-codex/gpt-6.1-sol shorthand. Use an explicit pi-stored OAuth profile to select another admitted catalogue model on that same route.
- `native.kind:installed-claude-bridge` retains its selected Claude Code-backed route and pinned native identity. It is not converted to direct Anthropic API/OAuth.
- An explicit literal `definition` retains its declared model, endpoint and original Pi compatibility adapter. It can describe controlled/custom routes, but its existence does not qualify every provider or helper.

OAuth login attempts to open the provider sign-in URL in the default browser on macOS/Linux. Device-code login also keeps the code visible. Automatic opening is best-effort: the URL remains visible for manual opening if the helper is missing, fails or a headless environment has no browser. Cancellation stops the opening helper and the login operation; successful browser launch alone does not establish authentication.
