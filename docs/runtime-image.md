# Prepare an execution image

Audience: users enabling isolated project execution. Account and settings operations do not need an image. Use `/setup runtime` and choose **Interactive runtime installer** to select an existing Docker backend or prepare Colima on macOS/Linux. Automatic packages require an existing working Homebrew and include Colima, Docker and Buildx. Review the named profile and package actions before starting. Existing backend installations remain available.

If your backend is already running, stage its trusted Docker executable, configuration directory and context, then choose **Prepare an execution image**. Review the route and select **Build execution image**. Logs and elapsed time remain visible; Escape cancels local execution. Successful builds stage the immutable image ID automatically. Choose **Review and save runtime**, then **Save and apply runtime** to use the selection for subsequent operations without restarting. Existing operations keep their captured runtime. A failed/cancelled build does not replace the staged image. Packages, a started VM or daemon-side build state may remain after cancellation; local cancellation does not certify rollback of those effects.

The application installer offers the same interactive preparation, and the shipped `runtime/setup.mjs` is a standalone terminal entry. See [Installation](installation.md). The manual instructions below are for custom recipes and advanced use; ordinary preparation does not require copying these commands.

The distributed `runtime` directory contains a self-contained recipe: `Dockerfile`, `Dockerfile.dockerignore` and `io-helper.mjs`. The recipe installs Node, Git, curl, util-linux and certificates. For Debian-packaged compilers, interpreters and test tools, choose **Extra image packages** in the runtime editor and enter package names before building. No recipe editing is needed for that path. Other project-specific tools can still be added to your copy. Preserve `/usr/local/bin/node`, `/opt/gitjig/io-helper.mjs` and the required tools; do not copy project credentials or application state into the image.

## Locate the recipe

| Installation | Recipe directory |
| --- | --- |
| Global npm installation | Run `npm root --global` with the installation's prefix, then append `/gitjig/runtime`. For a custom prefix, use `npm root --global --prefix /absolute/prefix`. |
| Source checkout | `/absolute/gitjig/runtime` |
| Prepared offline bundle | `/absolute/bundle/payload/runtime` from the selected bundle |

Use the recipe from the version you intend to run. Copy its three files to a new dedicated context outside projects and application state. Do not build with your home directory or project as the context. The recipe-specific ignore file excludes everything except those three files. If your customization needs additional files, explicitly allow only those files; do not remove the exclusion rule.

## Build explicitly

The following is an owner-operated build, separate from saving gitjig settings. Replace the recipe, executable, configuration and context values. It may download the pinned base image and package-manager dependencies, and writes an image into the selected engine. An offline gitjig bundle does not make this image build offline. The base digest is pinned; apt package versions are not pinned, so separate builds need not produce identical bytes.

```sh
gitjig_recipe="/absolute/selected/runtime"
gitjig_docker="/absolute/trusted/docker"
gitjig_docker_config="/absolute/docker-config"
gitjig_docker_context="explicit-context"
gitjig_image_work=$(mktemp -d /tmp/gitjig-image.XXXXXX)
gitjig_image_context="$gitjig_image_work/context"
gitjig_image_id="$gitjig_image_work/image-id"
mkdir "$gitjig_image_context"
cp "$gitjig_recipe/Dockerfile" "$gitjig_recipe/Dockerfile.dockerignore" \
  "$gitjig_recipe/io-helper.mjs" "$gitjig_image_context/"
```

If necessary, edit the copied Dockerfile to install your project tools before its `USER node` line. Keep the original distributed recipe unchanged. Use a fresh image-ID file for each attempt; do not use a stale file after a failed build:

```sh
if test ! -e "$gitjig_image_id" && \
  "$gitjig_docker" --config "$gitjig_docker_config" \
  --context "$gitjig_docker_context" build \
  --file "$gitjig_image_context/Dockerfile" \
  --iidfile "$gitjig_image_id" "$gitjig_image_context"; then
  cat "$gitjig_image_id"
else
  printf '%s\n' 'No image selected. Resolve the build failure and retry with a fresh image-ID file.' >&2
fi
```

After successful build, the file reports an immutable `sha256:` image ID. Open `/setup runtime` and enter the same trusted Docker executable, explicit context and configuration directory, plus that exact ID. Review the selection and choose **Save and apply runtime**; subsequent operations use it without restarting. A subsequent build does not update saved selection automatically. Never replace the ID with a mutable tag such as `latest`.

The build recipe is not sandbox certification. The selected backend must still enforce the [execution restrictions](requirements.md#execution-backend), and its shared paths must cover your registered project and gitjig's private execution paths. An image with missing tools or an incompatible backend can fail its first applicable check. Keep the original work and follow its reported recovery; a successful image build alone grants no model, workflow or repository authority. The host may run a different architecture from the backend; do not force a Docker platform without confirming your selected backend and project tools support it.
