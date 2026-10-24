# Distribution maintenance

Audience: contributors building and verifying gitjig bundles. Users installing or updating an existing bundle should read [Installation](../docs/installation.md).

## Source/npm installation

`node install.mjs [--prefix ABSOLUTE]` uses the caller's compatible Node/npm and checks the selected npm destinations before building. A terminal can choose a user prefix when the default is not writable. It installs locked build dependencies without lifecycle scripts, removes generated dist, builds, packs, installs the archive globally without lifecycle scripts and checks the new command's application/SDK identity. It hashes source inputs across compilation/packaging and checks emitted bytes across packing; drift stops before global mutation. Explicit phase retries revalidate source, paths and any completed build/archive. npm runs through the admitted Node executable.

Application installation itself does not edit shell startup files or initialize account/application state. After installation, a genuine terminal can separately choose runtime preparation or immediate launch through the verified installed entry. The shared helper can provision a named Colima profile, build an image and explicitly save settings in its owned application home; this optional phase has its own review, cancellation and retained-effect limits. Noninteractive installation remains application-only. A missing or shadowed PATH entry has an exact-Node launch alternative without profile edits; a symbolic link that resolves to the installed entry remains valid. The small source `install.sh` bootstrap can prepare missing host prerequisites before invoking this same Node installer; it is not a shipped runtime payload or another installation store. See the user [installation guide](../docs/installation.md) for the choices.

The package `files` allowlist ships compiled runtime, user docs, criteria and licenses. All direct runtime dependencies are npm bundled dependencies. npm cannot resolve the maintained bridge's relative `file:vendor/...` archive while extracting a global package; bundling the complete direct set also preserves its shared Pi peer dependencies. Keep the vendor archive for the source lock and include the runtime dependency closure in the package. Verify actual archive contents and a real disposable-prefix install, update and uninstall; a pack dry run alone does not establish global installation.

The source/npm launcher binds its temporary directory to the selected application home before loading the CLI. It uses the common Node minimum, not the exact offline runtime pin. Source/npm installs do not implement the versioned bundle's activation, rollback or loaded-asset health protocol. They cannot open a home bound to another installed payload; the existing installation gate still applies. Use separate homes or the bound installation's launcher.

## Build inputs and entry

The trusted build-host API is `buildBundle` in `src/installation/bundle.ts`. It accepts canonical `sourceRoot`, `productionRoot` and `destination` paths, the exact pinned `nodeBinary`, and its matching `nodeLicense`. It is not a download installer or an adopter startup requirement.

Build current source with the root lockfile and pinned compiler. Stage the locked production closure separately using package/lock/vendor inputs and `npm ci --omit=dev --ignore-scripts`. The builder verifies lock equality, the production-only graph, Pi versions, required assets and pinned Node/license hashes. Use a new destination; do not overwrite an immutable bundle.

The retained CLI/goal build fixtures accept explicit verified dependency bundles and compile source to a fresh output directory. They do not reuse a historical development dist tree. See CONTRIBUTING for their exact operands and qualification limits.

## Qualification boundary

`npm run build` clears generated product and qualification output before compiling. Product JavaScript goes to `dist/`; personal acceptance setup, synthetic Git bootstrap and internal controller test adapters go to `.qualification/` from `qualification/`. These external tools are not package assets. The product retains opaque context membership and lifetime checks, and fixed optional sidecar loading; it exposes no public activation option or context registrar.

The Node compatibility policy is plain JavaScript in `src/app/runtime-requirements.js`, shared by the product, build and feedback commands. It does not require native TypeScript loading. Exact offline runtime and license hashes remain artifact-specific.

Installed acceptance fixtures materialize external sidecars with imports bound to the selected installed payload. Their hashes and narrow test-only resolver bindings are recorded outside the immutable payload. This establishes the installed product consumer under an external fixture; the fixture itself is not a shipped capability.

## Publication contents

Ship user documentation from `docs/`, legal notices, locked runtime assets and the four controller criteria documents. Contributor instructions and `development/` are source-only. The README's contributor entry points explicitly to the source repository. Root criteria are runtime inputs; do not move or remove them merely because contributors also read them.

The build and bundle builder reject stale qualification paths in product output. Keep `requiredPayload`, the builder, bundle-stage assertions and `tools/verify-changed.mjs` shipping inventory consistent when changing the distributed files. A file in a source snapshot is not necessarily a runtime payload asset. Source-bound verification must reject stale shipped source/emission, dependency or criteria inputs without requiring nonshipped contributor documents in the payload.

## Verification and readiness

Follow CONTRIBUTING to select focused checks. An actual bundle check must inspect the payload, exact loaded dependencies and source binding; a passing source test does not establish a fresh installed entry. Lifecycle verification uses separate disposable homes and explicit inputs rather than a personal installation.

`npm run test:install:repo` builds and installs the current npm snapshot in a disposable prefix outside the checkout. It verifies loaded launcher/dependency paths and packaged criteria/user documents, then follows native Gitea/GitLab creation through original installed commands. Gitea reaches audit and current guidance. GitLab accepts creation and loses the response; the installed bare UI discovers and inspects the original UNKNOWN plan without changing its retained operation/work/run/source/budget/receipt/delegation records or sending requests, then explicitly reconciles it without a second POST. Original identity, native rule ID and consumed allowance remain bound. The runtime cwd and installed dependency ancestry cannot fall back to source `node_modules`.

These are model-free owner-configuration journeys against owned synthetic HTTPS APIs. The lane does not establish actual model quality, live hosting compatibility, immutable offline-bundle qualification, zero possible unowned network execution or whole-product maturity. The installed process uses no source import hook; do not attribute the source UI's loader tripwires to this installed test.

Report the candidate, observed endpoints, meaningful adverse inputs, limitations and review disposition in its issue or PR. Keep raw execution evidence outside source. Component acceptance, release readiness, whole-product maturity and dogfooding readiness are different decisions. The current Mission still requires complete independent local, repository and agent paths; existing local/repository gaps prevent a whole-product maturity claim. Apply the explicit development/dogfooding prerequisites before product-governed self-development.
