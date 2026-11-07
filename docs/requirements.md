# Requirements and platform compatibility

Requirements depend on the operation. Installing gitjig or managing accounts does not require the project execution environment.

| Operation | Requirements |
| --- | --- |
| Source/npm installation | Compatible Node >=22.19.0 and npm, or the source `bash install.sh` terminal bootstrap to prepare them after review; a source checkout includes the locked bridge archive. First installation needs access to dependencies or a populated npm cache. |
| CLI, accounts, settings and model-free UI | Compatible Node with `node:sqlite`, the installed dependencies and a writable private application home. No Docker daemon or model credentials are needed for these operations. |
| Model turns | A configured model/account and its provider-specific prerequisites. Claude Code-backed models additionally need the explicit bridge setup. |
| Project execution | A trusted Docker CLI, an explicit context and immutable Linux runtime image. The backend must enforce the scope restrictions below. |
| Git and hosting operations | Git for operations that use Git transport; applicable credentials, repository rules and explicit delegation for external actions. |

Use a maintained Node release that meets the minimum. Patch and minor versions are not required to match the development reference in `.node-version`. `gitjig doctor` checks local application prerequisites. Add `--docker-context NAME` for a basic engine reachability probe using `docker` from PATH and the surrounding Docker configuration/environment. This probe does not load saved runtime setup or verify its trusted client, image or isolation. Its `projectExecutionReady` field reports application prerequisites plus daemon reachability, not managed-work eligibility or repository authority. Use `/setup inspect` and `/ready` for the application's selected setup.

## Hosts and architectures

The source/npm path targets macOS and Linux, using the host's compatible Node and dependency packages. It has no macOS-only or ARM64-only entry check. Platform-specific dependencies must be available for the selected host and architecture.

Native Windows is incomplete: native provider ownership currently needs POSIX process groups, and private filesystem ownership rules also assume POSIX behavior. Use a Linux environment such as WSL with Linux Node/npm. WSL is a compatibility route, not a separately verified environment.

Prepared offline bundles are different artifacts: the current builder includes an exact Node 24.22.0 macOS ARM64 binary and verifies its hashes. Such a bundle cannot be moved to another OS or architecture. This artifact restriction does not apply to source/npm installation.

The current integrated verification environment is macOS ARM64 with a Colima Linux ARM64 backend. Other hosts, architectures and backends have not received equivalent integrated verification. This states the evidence available; it does not impose that environment on every user. Node compatibility checks and source test coverage are separate from complete platform qualification.

Current Node checks on macOS ARM64 cover the following scopes. This is not equivalent to full workflow qualification on each Node release.

| Node | Verified scope |
| --- | --- |
| 22.19.0 minimum | Global install/update/removal, source CLI/controller, original SDK codecs, native process ownership and SQLite backup/state gates |
| 24.22.0 reference | Global installation lifecycle, UI/terminal controls, developer/installation guards and reproducible offline bundle construction |
| 26.7.0 | Source CLI/controller and SQLite backup/state gates |

## Execution backend

A Docker-compatible backend can be used when it provides the required Linux execution behavior. Colima is not mandatory. The selected backend must enforce read-only inputs and root filesystem, bounded writable work/scratch mounts, protected paths, network and capability restrictions, resource limits, and container cleanup. Required host paths must be shared with the backend. The runtime image must include the required executor helper and project tools; see [Prepare an execution image](runtime-image.md) and [Startup setup](startup.md).

Keep executable trust checks, immutable image identity and required isolation enabled. A reachable daemon or accepted configuration does not prove these guarantees. If the backend cannot provide them, project execution is unavailable; account and settings operations remain usable. Gitjig does not silently fall back to unrestricted host execution.
