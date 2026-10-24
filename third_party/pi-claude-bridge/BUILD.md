# Build the maintained Claude bridge

## Inputs

The upstream baseline is `pi-claude-bridge`0.9.0 from [elidickinson/pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge). `upstream/` retains its original source, manifest, README, assets and MIT license. The current derivative is `src/`; [README.md](README.md) explains its differences and limits.

Use the root `.node-version`, root lockfile and TypeScript6.0.3. The derivative manifest pins its runtime dependencies and Pi peer versions. Pi and the Anthropic SDK are unmodified dependencies. The root lockfile supplies the installed graph used for compilation.

## Rebuild and pack

From the gitjig repository root:

```sh
npm ci --ignore-scripts
node node_modules/typescript/bin/tsc -p third_party/pi-claude-bridge/tsconfig.host.json
npm pack ./third_party/pi-claude-bridge --ignore-scripts --pack-destination vendor
```

Compilation writes the ignored `third_party/pi-claude-bridge/dist/` directory. The package includes this emission, current source, original upstream content, licenses and current build instructions. It excludes obsolete patch chains and development records. No global npm alias, personal account, engine or live model call is part of this build.

When changing the dependency, use a new derivative version and archive filename; update the root file dependency and lockfile together. Never overwrite an existing versioned archive in place. Check the packed source/emission against the maintained tree and exercise affected consumers after a fresh install. For a packaging-only change, compare runtime JS, declarations and source maps with the prior archive; a package label alone cannot establish equivalence.

After a source change, independently review the actual delta and run relevant Pi/bridge checks from CONTRIBUTING.md. Live service, restricted engine and installed-entry behavior have separate prerequisites and qualification scopes.
