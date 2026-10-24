# Application startup setup

Gitjig owns its settings. Pi CLI settings do not supply startup authority.

The terminal opens with a prompt to start at `/ready`. The footer keeps `/ready setup` visible as a setup entry after other notices replace the initial prompt.

The first `/ready` row recommends the next step for the selected conversation: choose a project, connect the applicable account, select a model, prepare execution, relaunch or review a task for explicit start. A saved default model can be selected for the current conversation without choosing it again. **Getting started** explains the sequence and defaults. The reply-language row shows automatic mode or the saved conversation language and opens `/language`; this optional choice never blocks first use. Future model defaults, role overrides, display tuning and hosting setup are optional for a first local task. An existing managed task opens its original work instead of starting a replacement. For an unconfigured conversation, **Connect your model account** offers the native Claude Code subscription route (`/bridge`) and Pi-managed provider accounts (`/login`) as separate choices. A configured current model does not need that account-selection detour.

Project changes require a settled conversation scope. A delegated task with no accepted result can keep its parent waiting even after its producer stops. A held project change names that task; open `/error`, inspect its original work, and choose explicit resume or cancellation there. Cancelling the original assigned work also cancels its unfinished assignment wait, while preserving parent and sibling work, history, spent allowance and cleanup obligations. Then select the project again. If the parent itself still has an authorized continuation, child cancellation does not discard that waiting intent. Send a new owner instruction to replace it, review cancellation/recovery of the parent work, or open `/new root` for an independent context. To keep the old task, use `/new root` for an independent conversation and choose another project there.

If your selected model is no longer available, `/ready` offers model selection rather than Start. Unavailable model/account files open `/model-repair`, which identifies their exact private paths. Review a reset before applying it. The selected file's original bytes are saved in an owner-private recovery backup; model reset restores built-in providers and removes custom endpoints/models/embedded keys, while account reset clears stored credentials and requires login again. Unselected files, work and model choices remain unchanged. Changed files, changed configuration directories, unsafe permissions, navigation or shutdown refuse an unfinished repair.

Use `gitjig setup inspect` to inspect saved setup. Use `gitjig setup save --file /absolute/private/setup.json` to save a version 1 object. Use `gitjig setup clear` to remove its future selections. These commands do not recover work or start an engine, model or account login. They can repair invalid setup while retained work remains unchanged. In the UI, use `/setup` for the same operations. These whole-object setup changes affect the next launch. Close normally, then relaunch and resume retained work. The runtime-specific field editor below can save and apply execution settings without restarting.

In the UI, `/setup save` opens the advanced whole-object JSON editor. Cancel preserves the saved file. Save and `/setup clear` refuse if the source conversation or original setup changes while the action is pending; reopen `/setup` to retry. Duplicate JSON keys are rejected. Explicit repair can replace invalid JSON, but it cannot bypass file ownership or permission requirements. If invalid saved setup prevents opening the UI, use the model-free `gitjig setup save --file ...` or `gitjig setup clear` command above.

For a keyboard-only overview, open `/ready` or Ctrl+G then T. It shows project selection, stored account metadata, the current conversation model, the future application default, the active runtime and the saved runtime. Select a row to open its existing command. After a successful action, the overview reads the new state. Catalogue/configuration facts do not establish account entitlement, engine availability or workflow eligibility. Inspection does not start or resume work.

Use `/setup runtime` to edit the Docker executable, context, immutable image and optional Docker configuration directory in separate fields. The editor preserves existing bridge settings and optional runtime resource limits. Choose **Edit runtime fields**, then **Review and save runtime** and the explicit **Save and apply runtime** action. Validation errors retain staged values for correction. Cancelling a field discards that partial edit and returns to the menu with the previous staged set; **Back without saving** returns from review, and **Cancel** exits without saving. Clearing the Docker configuration directory explicitly unsets it; a saved bridge still requires that directory. If another save occurs while the form is open, reopen the editor instead of overwriting it. Invalid saved setup requires explicit repair with `/setup save JSON` or `/setup clear`; ordinary field editing cannot silently drop it. Use `/setup bridge` to edit existing bridge prerequisites with plain fields. Advanced resource settings retain the explicit JSON path below. Runtime Save persists the selection and applies it to subsequent operations immediately, including when this process started with an explicit runtime override. Existing operations retain their captured runtime. Saved bridge changes remain unapplied until relaunch. Saving does not inspect an engine or validate its image contents.

Each runtime input shows its meaning, example values and how to find a value on your computer. Examples are guidance, not prefilled selections. **Runtime setup help** explains the execution environment, image preparation and save/apply steps without changing settings or contacting Docker.

Docker Engine can work before a `.docker` directory exists. Runtime setup help shows an explicit, quoted `mkdir` command for that missing directory. The interactive runtime installer can create it directly; the shell command is an advanced alternative. Return to **Suggest local Docker paths** afterward; the program does not create a Docker configuration or start a backend merely by showing guidance.

**Suggest local Docker paths** checks common executable paths and your home `.docker` directory using local metadata only. Review and choose **Use these paths** to fill empty fields; existing values remain unchanged. Choose **Interactive runtime installer** to prepare missing prerequisites in the application: select existing Docker or a named Colima profile on macOS/Linux. Automatic package installation needs existing Homebrew and includes Colima, Docker and Buildx. The installer shows the package/profile actions before execution. After staging a trusted client, configuration directory and context, **Prepare an execution image** opens route review and an explicit **Build execution image** action. Live bounded logs, elapsed time and Escape cancellation remain on screen. A successful immutable image ID is staged automatically; **Review and save runtime** remains separate. For project-specific tools, see the advanced recipe customization in [execution images](runtime-image.md).

**Check runtime connection and image** contacts the exact staged Docker route and inspects the selected immutable image. Review before running; output, elapsed time and cancellation use the normal preparation view. This action creates no container, runs no project code/model and changes no saved settings. It verifies connection and image presence only; shared paths, restrictions and project tools still need actual execution evidence. If a build fails in the interactive installer, you can retry only that build with its prepared route, without repeating package or VM steps. Cancellation, changed source/route and uncertain cleanup do not enter that retry.

After an ordinary runtime preparation, build or metadata-check failure, the error remains available and **Choose a recovery action** offers the relevant editor actions directly. You can retry the reviewed operation, correct fields/context, choose an existing image, adjust packages or open the interactive installer, as applicable. **Back to runtime setup** preserves your staged values. Unknown cleanup stops instead of offering retry; stale setup/source requires a fresh editor.

The interactive installer can switch from unavailable Colima prerequisites to an existing Docker route. A confirmed failed package-install or profile-start command offers its own retry or return to route choices. Retrying a profile start does not reinstall packages. All trusted executable/configuration/storage paths are checked again after the choice. Host/package/profile effects may remain after failure or cancellation.

**Extra image packages** is optional. Enter literal Debian package names such as `python3 build-essential` before **Prepare an execution image** or **Interactive runtime installer**. The next build installs them inside the image. Blank keeps the standard recipe. Invalid input stays available for correction, cancellation keeps the previous choice, and the image ID is staged only after a successful build. This choice lasts for the current form; the resulting immutable image retains its installed packages. Custom recipes remain available for tools or installation methods that Debian packages do not cover.

To choose existing values, select **Choose Docker context** or **Choose existing runtime image** in `/setup runtime`. Enter the trusted Docker executable and an existing Docker configuration directory. Discovery requires that explicit directory and ignores ambient Docker route variables. Context listing reads that configuration. Image listing uses the context you enter and may connect and authenticate to its engine endpoint. The picker shows image references and full immutable IDs. Selecting a candidate only stages values; use the normal review and Save actions afterward. Cancelling or a failed query preserves your previous staged values. Empty inventories are reported explicitly.

Discovery uses the trusted native client; it is not sandboxed agent execution. It requests no engine start, pull, build or configuration change. A listed image may lack required tools or isolation properties; selecting it does not qualify it for gitjig. Manual fields remain available for a large inventory or unsupported native output. The queries use the public Docker [context list](https://docs.docker.com/reference/cli/docker/context/ls/) and [image list](https://docs.docker.com/reference/cli/docker/image/ls/) commands.

Closing the UI aborts and joins an active discovery. If termination cannot be confirmed, exit reports `RUNTIME_DISCOVERY_CLEANUP_UNKNOWN` and the owned native process group. Inspect that specific group on the host before retrying. A failed cleanup is not reported as a clean exit.

An execution-only example:

```json
{
  "version": 1,
  "runtime": {
    "dockerBinary": "/canonical/path/to/docker",
    "dockerContext": "selected-context",
    "dockerConfigDirectory": "/canonical/path/to/docker-config",
    "image": "sha256:REPLACE_WITH_64_HEX_DIGITS"
  }
}
```

Colima, Docker Desktop and Docker Engine are possible providers of the Docker API; a backend must enforce the restrictions in [Requirements](requirements.md). Backend brand alone does not establish isolation.

Select a trusted Docker executable, a context configuration directory and an immutable image ID or digest. [Prepare an execution image](runtime-image.md) describes direct building and advanced project-tool customization. Metadata editing, discovery and Save do not provision a backend. The separate interactive installer can install packages/start the selected Colima profile, and Build may download images/dependencies. Those effects can remain after cancellation; existing startup settings stay unchanged until explicit Save. At launch, complete invocation runtime options override the whole saved runtime. A later explicit **Save and apply runtime** action supersedes that current selection. Do not supply a partial invocation override.

For the maintained Claude Code route, open `/bridge` or select **Next-launch bridge** in `/ready`. Choose a detected native Claude Code client and the intended native login source, then explicitly choose **Check native login**. The check runs the selected native client's version/authentication-status commands, without a model request. Its normal account store may refresh. The check may prepare a private gitjig setup directory and fixed policy so the checked route matches later native execution; those files can remain after cancellation. Startup settings are saved only after reviewed Connect. Gitjig does not read or copy credentials. Inspect the reported email, organization, plan and authentication source before proceeding. A missing client gives installation guidance. A missing login shows the exact selected-client sign-in command, including its HOME/configuration-directory route, to run outside gitjig before retrying the check. No API billing fallback is selected.

Choose **Review connection**, inspect the concrete client, login route and prepared private bridge paths, then explicitly choose **Connect · save for next launch**. Gitjig pins the selected client and prepares its own private bridge directories and fixed policy, preserving existing runtime settings and limits. You do not need to enter a SHA256 pin or create policy files for this guided route. If the selected account directory needs private permissions, a separate review lists the exact metadata changes before confirmation; contents are not read and permissions are not changed recursively. Check the login again after repair.

A successful save keeps the current active bridge and model unchanged. Close gitjig normally and use the displayed restart command to return to the same conversation. Then open `/model` to choose the desired Claude Code model. `/ready` distinguishes saved and active bridge settings. A native login check does not establish account entitlement, successful model execution or project isolation for native organization-policy hooks.

`/setup bridge` remains the advanced editor for existing bridge paths and an explicit executable SHA256 pin. Its directories and fixed policy must already exist; that editor does not create prerequisites, refresh a mismatched pin or start a native client. **Choose native default-home login** selects an existing native HOME and its `.claude` directory, separately from an explicit configuration-directory login. The two routes can select different accounts even when they name the same account directory. **Remove bridge for next launch** preserves runtime settings and the active process until close. Invalid saved setup requires explicit repair before ordinary advanced field editing.

For advanced file-based setup, add a `bridge` object:

```json
{
  "profile": {
    "kind": "installed-claude-bridge",
    "cwd": "/private/bridge/host",
    "agentDir": "/private/bridge/agent",
    "executable": {
      "file": "/canonical/path/to/the/pinned/claude-executable",
      "sha256": "REPLACE_WITH_64_HEX_DIGITS"
    }
  },
  "nativeAccountDirectory": "/explicit/claude-code/account-directory"
}
```

The host, agent, agent/home and native account directories must exist, be canonical and be private to their owner. Keep them outside registered projects and application work/state roots. The executable must match its pinned hash. Gitjig does not read or copy account contents during setup. The selected external Claude Code account remains distinct from Gitjig's direct Pi credentials; normal external authentication refresh can write to that selected account store.

For the default-home route, also set `"nativeAccountHome": "/existing/native-home"` and set `nativeAccountDirectory` to exactly `/existing/native-home/.claude`. That home must be canonical, owned by you and not writable by other users; it need not be private or disjoint from unrelated project folders. Its `.claude` directory and `.claude.json` settings path remain outside registered projects and application execution state. If `.claude.json` exists it must be an owner-private regular file without links. Only the native Claude child receives this declared `HOME` and omits `CLAUDE_CONFIG_DIR`; the Pi process keeps its isolated `agentDir/home`. Native login/refresh may write to the shared native account and `.claude.json`. Setup validates metadata without reading or copying credentials, creating account files or performing login. The account directory and declared default-home metadata are checked again before each native request or summary starts. A changed permission or symlink refuses that launch without creating a client. Restore the canonical private account directory, then explicitly retry; the account contents are not copied or rolled back. A failed automatic summary can appear as a generic “Compaction cancelled” message; that message alone does not identify the underlying cause.

Create `agentDir/claude-bridge.json` with this fixed configuration:

```json
{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}
```

An optional host `.pi/claude-bridge.json` must have the same fixed policy. No helper, plugin, arbitrary environment or executable extension selection belongs in startup setup. A saved bridge plus execution runtime requires an explicit Docker configuration directory, so the private bridge HOME cannot redirect Docker discovery.

The installed launcher fixes TMPDIR to the owned application artifacts directory before startup. The normal source/npm entry also selects that directory automatically; a low-level embedding host must establish it before loading a session. A running process cannot switch this context. An incompatible source entry reports a relaunch requirement. Explicit legacy `--model-profile` remains a separate execution route; it does not convert captured application work.

Login/logout, direct model configuration and account inspection work before execution setup. Invalid saved bridge setup leaves compatible direct model management available with a repair diagnostic. Catalogue availability does not establish provider entitlement. Normal execution still needs its applicable workflow and delegation conditions.

Use `/setup inspect` for scrollable saved/effective startup values and their sources. Use `/settings inspect`, or **Inspect effective values and sources** in `/settings`, to compare application and approved project preferences without editing. Omitted preferences use product defaults. Role-model edits refuse if the original conversation or role preferences change during selection; reopen `/role-model` to review the current values.

An explicit runtime invocation takes precedence at launch; its difference from saved settings does not itself require a restart. An explicit runtime field Save can replace that selection in the running process and persist the new selection. Passing the original invocation options again on a later launch still applies those explicit options. An external model profile keeps its own account/model route. Unrelated application model/account diagnostics remain available for inspection and future defaults, but do not replace the next action for that external profile.
