# Native session queue preferences

During a response, the configured send key (Enter by default) adds steering input for the next eligible model turn. Alt+Enter queues a follow-up for after the current response. The composer shows the current send key, and pending-input labels distinguish these meanings; neither promises immediate delivery.

Escape cancels the send currently being prepared. This keeps the editor text and leaves an existing response running. Once send preparation has finished, Escape interrupts the starting or running response and waits for cleanup. Cancelling does not withdraw input already received; a late acknowledgement still preserves that original input. Use `/inputs` to inspect retained originals before retry or withdrawal. Sending a new draft from an idle conversation with retained input keeps that draft and opens no execution; the prompt points to `/inputs` instead of automatically retrying an earlier request. If autocomplete is open, the first Escape closes it.

Use `/settings steeringMode` and `/settings followUpMode` to select `all` or `one-at-a-time`. Both default to `one-at-a-time` before application or approved-project overrides. You can also supply the JSON value directly, for example:

```text
/settings steeringMode "all"
/settings followUpMode "one-at-a-time"
```

Gitjig stores these values in its application settings. An approved project's `.gitjig/settings.json` may override them; the settings command reports when that project override remains effective. Stock Pi settings do not supply these values.

For an application-managed model, Gitjig captures both effective values when resolving an eligible execution. The resulting original Pi session keeps that pair. Changing settings or using `/reload` does not change a session that already exists. Busy or queued work can prevent a global settings write; settle that work before retrying. Existing external model profiles keep the isolated Pi defaults unless an explicitly admitted execution supplies its own complete pair.

These preferences control the original Pi Agent's native queues. `all` selects all currently queued messages for the next eligible turn; `one-at-a-time` selects the first. Steering and follow-up are separate queues. Gitjig's controller still decides input ownership, admission and execution; these values do not grant authority or bypass pending obligations.

Changing a queue preference does not retry, recover or confirm delivery of pending input. If delivery is unresolved, inspect the conversation and follow the recovery guidance in [Project file context](file-context.md).
