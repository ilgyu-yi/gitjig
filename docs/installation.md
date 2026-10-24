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

You can also open `/setup runtime` and choose **Interactive runtime installer** later. The same workflow runs in the application, with logs and cancellation, then stages the resulting image for **Review and save runtime**. For source or packaged command-line use, run `node runtime/setup.mjs` from that version's package directory after building/installing. It accepts `--home /absolute/application-home`. If image building fails, choose whether to correct the retained Docker route, retry only the build, or finish without saving. Route correction asks for separate build consent and does not repeat package installation or VM startup. The helper asks for explicit Save and preserves the startup settings captured before preparation. Downloads, packages, VM and engine build data may remain after cancellation; saved runtime remains unchanged unless Save completed.

The installer checks its prefix, command and package directories before building. If the default prefix is not writable, an interactive terminal offers `~/.local`. An explicit custom prefix is never redirected. Noninteractive failures report the required prefix option without waiting for input. Permission changes during installation can still cause npm to fail. An ordinary npm phase failure offers an explicit retry of that phase after checking the original source, installation paths and any completed build/archive. Failed pack attempts get a fresh destination. Changed inputs, process signals and uncertain spawn outcomes refuse retry; partial package files are not reported as rolled back. You can select your own prefix:

```sh
node install.mjs --prefix "$HOME/.local"
```

The installer prints the actual command path and checks which executable `gitjig` resolves to on PATH. If the installed entry is missing or an earlier command shadows it, the terminal offers **Launch gitjig now** using the verified installed command and selected Node. For later terminals, add the required bin directories to PATH or use the printed exact Node launch command. Close running gitjig sessions before an npm update; npm replaces package files without the offline bundle activation protocol. Rerun the installer from the desired checkout to update. Remove the command with `npm uninstall --global gitjig`; for a custom prefix, use `npm uninstall --global --prefix "$HOME/.local" gitjig`. Application data is stored separately and retained.

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

Prepared offline bundles currently contain an exact macOS ARM64 Node runtime. They provide a separate versioned installation with verified activation and recovery. The source/npm route above uses npm update/removal and does not provide this activation protocol.

A prepared bundle contains an `install` entry, payload and bootstrap runtime. There is no automatic binary download installer. Use canonical absolute bundle and home paths; keep the home outside projects and separate from a source/npm home:

```sh
/absolute/bundle/install stage --bundle /absolute/bundle --home /absolute/gitjig-home
/absolute/bundle/install activate --bundle /absolute/bundle --home /absolute/gitjig-home
/absolute/gitjig-home/gitjig --help
/absolute/gitjig-home/gitjig health
```

Staging validates and copies owned assets. Activation checks the selected entry and performs isolated scripted SDK health. It does not log into a provider or run your project. The installed launcher fixes its home, runtime and artifacts directory.

Stage and activate a compatible bundle to update. Inspect the result; a partial or unknown result is not successful activation. After an interrupted activation, run:

```sh
/absolute/bundle/install recover --home /absolute/gitjig-home
```

Remove a managed installation with:

```sh
/absolute/bundle/install remove --home /absolute/gitjig-home
```

Removal preserves user data and unrelated or modified files. Do not delete retained state to manufacture recovery. `health --loaded` checks the actual loaded SDK; it does not grant workflow or repository authority. Use the applicable update/recovery route before resuming affected work.

## Reset local application data

Open **Reset local data** in `/settings`, or enter `/reset`. Choose settings or all local data, then choose **Keep a private backup** or **Permanently delete selected data** before closing. Gitjig closes the current session and joins its work before the terminal shows a fresh preview. Confirm a backed-up reset with `RESET`; confirm permanent deletion with `DELETE`. Any other response cancels.

- **Settings** resets the application's configuration, saved provider credentials and recovery backups under `config`. Sign in and configure startup again. Conversations, work and project registrations remain active.
- **All local data** also resets conversations, work, project registrations, inputs and artifacts in the selected application home.

Each selected file or directory includes all its current contents. Reset does not scan or count every nested file, and the preview does not claim a file count or total byte size. With **Keep a private backup**, the original data moves into a private `reset-backups` directory within that home. The preview shows that directory and the result identifies the exact backup. Saved credentials remain in that backup. With **Permanently delete selected data**, no backup of this reset is retained; deletion cannot be undone. Neither mode is secure erasure or uninstallation. Registered project source and project-local settings, installed binaries, shared Docker/Colima and external native-provider accounts remain in place. Previous reset backups are preserved by both modes.

Close other gitjig sessions using that home. Unsettled execution, unknown cleanup or an interrupted installation can block reset; follow the reported original recovery entry before retrying. Reset never removes a container or VM to bypass that hold.

For a terminal-only entry, run `gitjig reset --scope settings` or `gitjig reset --scope all`; it asks which data policy to use before preparing the preview. Add `--disposition backup` or `--disposition delete` to select that policy explicitly. Add `--home /absolute/gitjig-home` when using a separate home. For explicit noninteractive operation, run `gitjig reset preview --scope all --disposition backup`, review its selected paths, policy and fingerprint, then run `gitjig reset apply --scope all --disposition backup --confirm FINGERPRINT`. Noninteractive preview and apply default to `backup`. Permanent deletion requires `--disposition delete` on both commands. A different policy, changed selected path set or replaced application root refuses the operation. Consent covers all current contents within each selected root; nested file changes do not require another preview.

If reset is interrupted, ordinary startup and installation staging, activation, recovery and removal remain blocked. Run `gitjig reset recover --home /absolute/gitjig-home` to finish the already confirmed operation with its original policy. Replaced or contradictory source and destination roots remain held for inspection. Interrupted resets created by older versions retain their original recovery checks. Automatic backup restoration is not provided.

To remove a saved reset backup, first run `gitjig reset backups` and review the listed backup ID, original scope, paths and fingerprint. Then run `gitjig reset backup-delete --backup BACKUP_ID --confirm BACKUP_FINGERPRINT`. Add the same `--home` to both commands for a separate home. This permanently deletes only that selected saved backup, including any saved credentials it contains, and cannot be undone. Active data and other backups are kept. Listing does not scan nested contents or report their size. If deletion is interrupted, run `gitjig reset backup-recover --home /absolute/gitjig-home` to finish the already confirmed deletion; this does not restore the backup.
