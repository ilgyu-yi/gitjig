# Gitjig keybindings

Gitjig uses its own `config/keybindings.json` inside the selected application home (`~/.gitjig` by default). Pi and other Pi-based applications do not supply this file. Project settings cannot override shortcuts. Use `/hotkeys` to see the actual current bindings and application file path.

Edit the private application file, then run `/reload` in an ordinary conversation editor. For example:

```json
{
  "tui.editor.deleteToLineStart": "ctrl+t",
  "tui.select.down": "ctrl+n"
}
```

The first shortcut deletes text before the cursor in the native editor and supported text inputs. The second moves down in selectors, including the Ctrl+G command menu. `/reload` updates existing editors and new selectors together. Reopening Gitjig reads the same application file. Keep the file readable and writable only by its owner (mode 0600 on the currently qualified platform).

Supported overrides are the connected `tui.editor.*`, `tui.input.*` and `tui.select.*` actions shown by the native registry. Unknown action names are rejected. Values are a key string or an array of at most eight keys. An empty array disables an optional action; submit, confirm and cancel must keep a key. Key identifiers use the public Pi vocabulary, such as `left`, `ctrl+t`, `alt+left` or `shift+tab`. Modifier order and `esc`/`return` spelling are normalized. Some terminal protocols cannot distinguish control-key aliases. Gitjig conservatively rejects conflicting or intercepted assignments. Grammar acceptance does not guarantee every terminal transports every chord.

Ctrl+G opens Gitjig commands by default. `--command-key ctrl+q` or `--command-key ctrl+p` changes that invocation's command key; `ctrl+g` remains the default, not an additional simultaneous binding. Hierarchy Shift+Up/Down, Alt+Enter follow-up, F2–F8, account cancellation/leave, interrupt, exit, tool expansion and transcript controls remain fixed in this profile. Their actions are not configurable through this file. Menu letters also keep their command meanings. Image paste is unavailable. `/hotkeys` shows fixed controls alongside resolved native keys.

Invalid files stop startup with the application path and a repair instruction before entering the full-screen terminal. Invalid reload keeps previous bindings and presentation. A missing file uses product defaults. Reload refuses while a dialog or text selection owns the interaction; finish or clear it first. Changing shortcuts does not submit model input, change the selected model or grant execution authority.

Modified shortcuts accept English and Korean Dubeolsik key positions in either interface language: Ctrl+ㅎ invokes Ctrl+G, and native editor controls use the same correspondence. Inside the Ctrl+G menu, letter commands also accept Korean jamo (for example, J/ㅓ opens projects). Public SDK key matching takes precedence when the terminal provides physical base-layout information. Encoded Korean Ctrl/Alt/Super events without that information use the same shared input normalization for menus, editors and dialogs. Ordinary Korean text and pasted text remain unchanged. Slash command names accept Dubeolsik input, including composed Hangul; completion resolves them to the English command name. Arguments, paths, searches and conversation text are not translated. Other layouts need terminal-provided key information; a plain text terminal cannot expose physical keys while an IME is still composing text. Shift modifiers keep their separate meaning.

Ctrl+G then E opens error details without submitting or replacing the editor text. The detail view accepts the configured selector Up/Down, PageUp/PageDown, confirm and cancel bindings. It does not repeat the failed operation.

Ctrl+G then T opens setup and next actions. Product forms place the cursor after a printable single-line default. The configured delete-to-line-start action (Ctrl+U by default) can replace that default. Enter keeps an unchanged default; Escape cancels. Defaults containing control characters or line breaks require the explicit CLI or advanced configuration path. Initial values use the public Pi paste behavior; Undo can remove that initial insertion.
