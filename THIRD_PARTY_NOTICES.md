# Third-party components

The root MIT license applies to gitjig. Dependencies retain their own licenses.

## Official Pi SDK

The official `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` packages are pinned to 1.3.0 in the lockfile. Their sources are not vendored or modified here. Each declares the MIT license in its package metadata; none of the three ships a separate LICENSE file. Preserve their package metadata when distributing an installation.

The seven compatibility metadata names in gitjig's `src/pi/sdk-metadata.ts` come from Pi coding-agent 1.3.0 `dist/core/provider-attribution.js`, under the package's declared MIT license. The copied surface consists of names, not provider routing or authentication-header values.

## Claude bridge derivative

The source/build links in this section refer to the [source repository](https://github.com/ilgyu-yi/gitjig). Installed bundles retain the derivative's package license and matching compiled dependency; they do not require a source checkout.

`@gitjig/pi-claude-bridge-host` 0.9.0-gitjig.11 derives from `pi-claude-bridge` 0.9.0. The local archive is a normal npm file dependency, not a downloaded copy of Pi.

- [Original MIT license](https://github.com/ilgyu-yi/gitjig/blob/main/third_party/pi-claude-bridge/upstream/LICENSE)
- [Derivative license](https://github.com/ilgyu-yi/gitjig/blob/main/third_party/pi-claude-bridge/LICENSE)
- [Full retained upstream source](https://github.com/ilgyu-yi/gitjig/tree/main/third_party/pi-claude-bridge/upstream)
- [Current derivative source](https://github.com/ilgyu-yi/gitjig/tree/main/third_party/pi-claude-bridge/src)
- [Build recipe and current changes](https://github.com/ilgyu-yi/gitjig/blob/main/third_party/pi-claude-bridge/BUILD.md)

Changes add owned native-query lifecycle, exact tool/MCP admission, owned summary execution and terminal-result checks, a duplicate-text correction, and bounded provider-schema compatibility. Pi and the Anthropic SDK are unchanged. This derivative is an explicit maintenance dependency.

The archive includes the compiled host. Its source and all upstream notices are retained alongside it. Do not replace it with an older experiment archive or an unreviewed upstream version without affected verification.

## Runtime and transitive dependencies

The installer can bundle the pinned Node runtime and production dependency closure. It retains Node's `NODE-LICENSE` and dependency license files. The lockfile records exact package versions and integrity. Claude SDK native executables and other transitive components retain their package terms; the root MIT license does not relicense them.

## Claude Agent SDK

The bridge depends on `@anthropic-ai/claude-agent-sdk` (0.3.284 in the lockfile) and its platform-specific native package, which are included in the production dependency closure and in bundles. They are not open source: their package `LICENSE.md` reads "© Anthropic PBC. All rights reserved" and makes use subject to Anthropic's legal agreements linked there. Retain that file with the package, and confirm those terms permit any redistribution you perform.
