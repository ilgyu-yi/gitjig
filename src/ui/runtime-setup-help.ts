import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeDiscoveryInput } from '../execution/runtime-discovery.js';
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export function dockerConfigurationPreparation(directory = join(homedir(), '.docker')) {
    if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(directory))
        throw Error('Docker configuration preparation requires a printable single-line path');
    return { directory, command: `mkdir -p -m 700 ${quote(directory)}` };
}
const configuration = dockerConfigurationPreparation();
export const runtimePrerequisites = [
    'Runtime runs project commands and tests in an isolated Linux container. Account/settings operations do not need it.',
    'No Docker yet? Choose Interactive runtime installer here. It can use an existing Docker backend or prepare Colima on macOS/Linux. Automatic installation uses an existing working Homebrew to install Colima, Docker and Buildx. Review the selected profile and package actions before starting. Other existing compatible backends remain available.',
    'Return here and choose Suggest local Docker paths. It checks common executable locations and your home .docker directory without running Docker. Missing/custom paths can be entered with Edit runtime fields.',
    `Docker Engine can work without a configuration directory. Interactive runtime installer can create a private directory when you choose to do so. For advanced manual preparation, this command creates only that directory:\n\n${configuration.command}\n\nEnter ${configuration.directory} as Docker configuration directory. Existing custom contexts remain in their original directory; select that directory instead when needed.`,
    'Choose Docker context to select the connection to your running backend. Then Choose existing runtime image if you already prepared one with the gitjig helper and project tools. An ordinary Node image is not sufficient.',
    'No image yet? After staging your executable, configuration directory and context, select Prepare an execution image. Review the route, then choose Build execution image. Live output, elapsed time and Escape cancellation stay in this screen. A successful immutable ID is staged automatically. The interactive installer can prepare the backend first and build the same recipe.',
    'Review and save runtime, then Save and apply runtime. Open /ready to continue without restarting. Existing operations retain their captured runtime. Saving validates metadata; the first applicable execution checks the actual environment. Backend paths must share your project and application execution storage.',
].join('\n\n');
/** Owner-operated shell guidance only; this function never executes or builds. */
export function runtimeImageBuildHelp(input: RuntimeDiscoveryInput, recipe = fileURLToPath(new URL('../../runtime/', import.meta.url))) {
    if (!input.dockerContext || [recipe, input.dockerBinary, input.dockerConfigDirectory, input.dockerContext].some(value => /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)))
        throw Error('Build guidance requires printable single-line paths and an explicit context');
    return [
        'Prepare an execution image · run these commands in your own shell',
        'Use the same shell for both blocks. This copies only the three distributed recipe assets into a fresh context outside projects and gitjig storage. It does not copy project files or credentials. Your selected backend must already be running.',
        `gitjig_recipe=${quote(recipe)}\ngitjig_docker=${quote(input.dockerBinary)}\ngitjig_docker_config=${quote(input.dockerConfigDirectory)}\ngitjig_docker_context=${quote(input.dockerContext!)}\ngitjig_image_ready=no\nif gitjig_image_work=$(mktemp -d /tmp/gitjig-image.XXXXXX); then\n  gitjig_image_context="$gitjig_image_work/context"\n  gitjig_image_id="$gitjig_image_work/image-id"\n  mkdir "$gitjig_image_context" &&\n  cp "$gitjig_recipe/Dockerfile" "$gitjig_recipe/Dockerfile.dockerignore" \\\n    "$gitjig_recipe/io-helper.mjs" "$gitjig_image_context/" &&\n  gitjig_image_ready=yes\nfi`,
        'Stop if copying failed. Before building, edit the copied Dockerfile at $gitjig_image_context/Dockerfile if your project needs Python, Java, compilers or other tools. Add packages before USER node. Keep the Node executable, gitjig I/O helper and existing tools; keep the restrictive Dockerfile.dockerignore. The original installed recipe remains unchanged.',
        `if test "$gitjig_image_ready" = yes && test -n "$gitjig_image_context" && test -f "$gitjig_image_context/io-helper.mjs" &&\n  test -n "$gitjig_image_id" && test ! -e "$gitjig_image_id" &&\n  "$gitjig_docker" --config "$gitjig_docker_config" \\\n  --context "$gitjig_docker_context" build \\\n  --file "$gitjig_image_context/Dockerfile" \\\n  --iidfile "$gitjig_image_id" "$gitjig_image_context"; then\n  cat "$gitjig_image_id"\nelse\n  printf '%s\\n' 'No image selected. Fix the failure and restart with a fresh temporary context.' >&2\nfi`,
        'Only after successful build: copy the printed sha256: ID into Runtime image, or select Choose existing runtime image. Review and Save and apply runtime to use it for subsequent operations. Do not use latest or a stale ID file after failure. A rebuilt image does not change your saved selection automatically.',
        'The base image is pinned; package downloads can vary and this is not an offline build. Image build success alone does not establish backend isolation or complete project-tool compatibility.',
    ].join('\n\n');
}
