# Installation and launch

See [Requirements](requirements.md) for compatible Node versions, platform limits and operation-specific dependencies. Application installation does not start a model or configure credentials. In an interactive terminal it offers a separate runtime preparation step; noninteractive installation installs only the application.

## Install a global command from source

Obtain the source checkout (or unpack its source archive), then run the terminal bootstrap:

```sh
bash install.sh
```

The bootstrap reuses compatible Node/npm. If they are missing, it offers Homebrew and the versioned `node@24` package, then continues the same application installer. It can also prepare missing Homebrew for optional Colima setup. Downloads and shared host changes require review. The official Homebrew installer runs in the original terminal, where it can request administrator access; gitjig does not capture that password. Its source revision and SHA256 are pinned and checked before execution. Host support and permissions still depend on Homebrew; a failed bootstrap reports partial effects and offers a fresh reviewed attempt or Finish. A retry downloads and verifies fresh bytes; corrupt cached code is never run. Missing host tools, unsupported platforms or unavailable administrator authority still require the named external prerequisite. Existing Node/npm and Docker installations, including Linux installations without Homebrew, remain usable. Noninteractive execution never installs these host prerequisites.

Homebrew's versioned Node is not linked over another Node installation. The bootstrap selects its exact executable for this installation; future terminals still need its bin directory on PATH. The installer prints an exact Node/entry launch command and can launch immediately without changing shell profiles.

With Node >=22.19.0 and npm already available, the direct entry also remains supported:

```sh
git clone https://github.com/ilgyu-yi/gitjig.git
cd gitjig
node install.mjs
gitjig --help
```

`node install.mjs` installs the locked build dependencies, builds a fresh runtime, packages it and registers `gitjig` through npm's global installation. It installs a packaged snapshot, so the command does not depend on keeping the source checkout. It uses your existing npm global prefix, does not run dependency lifecycle scripts, and does not use sudo or edit your shell profile.

At the end, choose whether to prepare the execution environment. The interactive helper can use an existing Docker backend or prepare a named Colima profile on macOS/Linux, then build the execution image and save runtime settings. Automatic package installation uses an existing working Homebrew and installs `colima`, `docker` and `docker-buildx`; other existing installations can also be used. Package commands are noninteractive and do not request administrator passwords. Missing Homebrew or package-manager permissions produce a diagnostic; they are not repaired automatically. `node install.mjs --setup-runtime` explicitly requests this step and requires a terminal. Declining or cancelling keeps the installed application. After a confirmed ordinary preparation failure, choose **Retry runtime preparation**, **Open gitjig to repair setup**, or **Finish installation**. The application is not reinstalled. Interruptions and unconfirmed cleanup stop with their diagnostic instead of offering unsafe retry.

You can also open `/setup runtime` and choose **Interactive runtime installer** later. The same workflow runs in the application, with logs and cancellation, then stages the resulting image for **Review and save runtime**. The in-app progress view retains a bounded output tail and marks when earlier output has been omitted. If preparation stops, choose **Open recovery actions** to see retry or correction choices. Esc returns to the runtime form with the previous settings. If the selected Docker context could not be verified, correct the context or configuration directory before trying to build again. If the context was verified but its engine did not respond, start or reconnect the engine and retry the connection check. For source or packaged command-line use, run `node runtime/setup.mjs` from that version's package directory after building/installing. You can also pass a symbolic link to that helper to `node`. It accepts `--home /absolute/application-home`. Before asking for build approval, the installer shows the resolved Docker executable and configuration directory with the selected context. A route that fails local validation can be corrected before any build starts. After an ordinary build failure, correct the route, retry only the approved build, or finish without saving. If a reviewed path is redirected, start a fresh review before building. Route correction asks for separate build consent and does not repeat package installation or VM startup. The helper asks for explicit Save and preserves the startup settings captured before preparation. Downloads, packages, VM and engine build data may remain after cancellation; saved runtime remains unchanged unless Save completed.

The installer checks its prefix, command and package directories before building. If the default prefix is not writable, an interactive terminal offers `~/.local`. An explicit custom prefix is never redirected. Noninteractive failures report the required prefix option without waiting for input. Permission changes during installation can still cause npm to fail. An ordinary npm phase failure offers an explicit retry of that phase after checking the original source, installation paths and any completed build/archive. Failed pack attempts get a fresh destination. Changed inputs, process signals and uncertain spawn outcomes refuse retry; partial package files are not reported as rolled back. You can select your own prefix:

```sh
node install.mjs --prefix "$HOME/.local"
```

If a dependency phase reports `ENOTCACHED`, use an npm cache prepared for the checkout you are installing. An offline cache needs the data for both `npm ci` and the later installation of the packaged application. If you already have a suitable cache in another directory, rerun the same installer command with `npm_config_cache` set to that directory. The terminal’s retry option repeats the failed phase with the existing environment.

The installer prints the actual command path and checks which executable `gitjig` resolves to on PATH. If the installed entry is missing or an earlier command shadows it, the terminal offers **Launch gitjig now** using the verified installed command and selected Node. For later terminals, add the required bin directories to PATH or use the printed exact Node launch command. Rerun the installer from the desired checkout to update. It installs and verifies a separate program version, then switches the active package link. Running sessions keep their selected version; new sessions use the updated version. The printed exact Node command selects the checked version; the global command follows the latest activation. No application settings, account or work-data migration is implied. Remove the command with `npm uninstall --global gitjig`; for a custom prefix, use `npm uninstall --global --prefix "$HOME/.local" gitjig`. This removes the command and active package link; version storage under the printed `PREFIX/lib/gitjig-versions` remains. Remove that storage only after all sessions using this prefix are stopped. Application data is stored separately and retained.

An older npm installation stored its program directly at `PREFIX/lib/node_modules/gitjig`. Its first conversion requires closing every session using that prefix and keeping them closed until migration finishes. The terminal asks for this confirmation; noninteractive migration requires `--migrate-legacy`. The flag confirms that precondition; it does not inspect or stop processes. The original package is retained in version storage. Later updates use the versioned route above.

If activation is interrupted, rerun the installer with the same prefix. It verifies the exact recorded candidate before finishing that transition, then installs the requested checkout. Changed candidate files, unknown command/package links, an unfinished namespace initialization or unresolved installer ownership refuse with the affected path. Preserve those records and the previous versions while inspecting the reported condition; the installer does not choose an arbitrary retained version or delete old versions automatically.

Open `gitjig` in an interactive terminal to start the UI. The default application home is `~/.gitjig`; `--home` overrides `GITJIG_HOME`, which overrides the default. Use an absolute home outside registered projects. The source/npm launcher selects that home's artifacts directory as TMPDIR before loading the CLI; no manual TMPDIR export is required.

## Run without a global installation

```sh
npm ci --include=dev --ignore-scripts
npm run build
node dist/cli/entry.js --help
node dist/cli/entry.js conversation ui --home /absolute/gitjig-home
```

Use `node dist/cli/entry.js` instead of `gitjig` in the other guides. `.node-version` selects a development reference; compatible Node versions can run the source entry. Installation state owned by a prepared bundle still requires that bundle's bound launcher.

## Use a prepared offline bundle

Prepared offline bundles currently contain an exact macOS ARM64 Node runtime. They provide a separate versioned installation with verified activation and recovery. The source/npm route above stages compatible-Node npm packages and switches the active link; it does not use the offline runtime or application-database activation protocol. Direct external npm replacement of the active package is outside this version-preserving update route.

A prepared bundle contains an `install` entry, payload and bootstrap runtime. There is no automatic binary download installer. Use canonical absolute bundle and home paths; keep the home outside projects and separate from a source/npm home:

```sh
/absolute/bundle/install stage --bundle /absolute/bundle --home /absolute/gitjig-home
/absolute/bundle/install activate --bundle /absolute/bundle --home /absolute/gitjig-home
/absolute/gitjig-home/gitjig --help
/absolute/gitjig-home/gitjig health
```

Staging validates and copies owned assets. Activation checks the selected entry and performs isolated scripted SDK health. It does not log into a provider or run your project. The installed launcher fixes its home, runtime and artifacts directory. The offline installer checks any existing private settings directory. On a fresh installation, saving settings creates that directory.

Stage and activate a compatible bundle to update. If activation reports that the pinned bootstrap differs, close gitjig, run the bundle's `install remove --home /absolute/gitjig-home`, and activate the new bundle at the same home. The removal and activation preserve the retained application data and reset backups. Inspect the activation result for confirmed completion. After an interrupted activation, run:

```sh
/absolute/bundle/install recover --home /absolute/gitjig-home
```

For a storage-capacity error, check free space for the installation and temporary files. If staging reports a full destination during the payload copy and gives the versions directory, free space on that filesystem and retry the original `stage` or `activate` command with the same operands. The reported payload size counts file data. Allow room for filesystem overhead and the separate activation step. SQLite can also reach a database size limit. For an I/O error, check that the filesystems are available and writable and inspect the system storage diagnostics. Keep the installation data and run recovery after addressing the storage issue. If recovery reports nothing pending, retry the original installation command. When the original worker cleanup was recorded but the installer could not save its output, recovery can roll back the activation. An UNKNOWN cleanup result retains the activation and its records for inspection.

Remove a managed installation with:

```sh
/absolute/bundle/install remove --home /absolute/gitjig-home
```

Removal preserves user data and unrelated or modified files. Do not delete retained state to manufacture recovery. `health --loaded` checks the actual loaded SDK; it does not grant workflow or repository authority. Use the applicable update/recovery route before resuming affected work.

## Reset local application data

Open **Reset local data** in `/settings`, or enter `/reset`. Choose settings or all local data, then choose **Keep a private backup** or **Permanently delete selected data** before closing. Press **Enter** in the scope review to open safe shutdown confirmation. **Escape** returns to the session. If you choose **Close safely and review reset**, gitjig joins its work before the terminal shows a fresh preview with the exact absolute paths. Confirm a backed-up reset with `RESET`. Confirm permanent deletion with `DELETE`. Any other response cancels. After the review ends, copy the printed command to reopen the same application home. If you kept the conversation, the command reopens the one selected at shutdown. After an all-data reset, the command starts with a fresh conversation.

- **Settings** resets the application's configuration, saved provider credentials and recovery backups under `config`. Sign in and configure startup again. Conversations, work and project registrations remain active.
- **All local data** also resets conversations, work, project registrations, inputs, artifacts and private Git clients, objects and command journals under `effects` in the selected application home.

Each selected file or directory includes all its current contents. Reset does not scan or count every nested file, and the preview does not claim a file count or total byte size. With **Keep a private backup**, the original data moves into a private `reset-backups` directory within that home. The preview shows that directory and the result identifies the exact backup. Saved credentials remain in that backup. With **Permanently delete selected data**, no backup of this reset is retained; deletion cannot be undone. Neither mode is secure erasure or uninstallation. Registered project source and project-local settings, installed binaries, shared Docker/Colima and external native-provider accounts remain in place. Previous reset backups are preserved by both modes.

Close other gitjig sessions using that home. Unsettled execution, unknown cleanup or an interrupted installation can block reset; follow the reported original recovery entry before retrying. Reset never removes a container or VM to bypass that hold.

For a terminal-only entry, run `gitjig reset --scope settings` or `gitjig reset --scope all`; it asks which data policy to use before preparing the preview. Add `--disposition backup` or `--disposition delete` to select that policy explicitly. Add `--home /absolute/gitjig-home` when using a separate home. For explicit noninteractive operation, run `gitjig reset preview --scope all --disposition backup`, review its selected paths, policy and fingerprint, then run `gitjig reset apply --scope all --disposition backup --confirm FINGERPRINT`. Noninteractive preview and apply default to `backup`. Permanent deletion requires `--disposition delete` on both commands. A different policy, changed selected path set or replaced application root refuses the operation. Consent covers all current contents within each selected root; nested file changes do not require another preview.

If the selected scope has no reset targets, the terminal reports that and skips confirmation. Opening a conversation or inspecting its readiness leaves an absent settings directory uncreated. A confirmed noninteractive empty preview returns `reset: false` with reason `nothing-to-reset`. This creates no backup or deletion transaction.

Standalone interactive reset uses the system interface language. After confirmation, the terminal shows which operation it is processing. On completion it reports the exact retained backup path or permanent deletion and how to restart.

If reset is interrupted, ordinary startup and installation staging, activation, recovery and removal remain blocked. When a confirmed reset stops and its recovery record remains, the terminal shows the failure and recovery command immediately. Run the displayed `reset recover` command to finish the already confirmed operation with its original policy. A bound installation shows its own launcher and application home, so the command works without a `gitjig` alias on your shell path. Replaced or contradictory source and destination roots remain held for inspection. Interrupted resets created by older versions retain their originally reviewed scope and recovery checks. Older all-data resets can leave private Git work data in place; review a new all-data reset to include it. Automatic backup restoration is not provided. When no reset is pending, `reset recover` reports `recovered: "nothing-pending"` and `reset: false`. This result describes the current recovery queue; it does not certify a previous reset outcome or finish a separate backup deletion.

To manage saved backups interactively, open `/reset` and choose **Manage saved reset backups**. Gitjig closes safely before listing backups. The list shows the ID and scope in order of receipt modification time, newest first. Choose one by number and review its exact path before entering `DELETE`. Press Enter without a number to leave.

For command-line backup management, first run `gitjig reset backups` and review the listed backup ID, original scope, paths and fingerprint. Then run `gitjig reset backup-delete --backup BACKUP_ID --confirm BACKUP_FINGERPRINT`. Add the same `--home` to both commands for a separate home. This permanently deletes only that selected saved backup, including any saved credentials it contains, and cannot be undone. Active data and other backups are kept. Listing does not scan nested contents or report their size. If deletion is interrupted, use the `gitjig reset backup-recover` command shown for the selected application home. It finishes the already confirmed deletion. If either recovery command fails while the same recovery record remains, its error shows the cause and command again. Resolve the reported cause before rerunning it.
