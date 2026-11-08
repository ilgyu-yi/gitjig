import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeDiscoveryInput } from '../execution/runtime-discovery.js';
import { translator, type UiLocale } from './i18n.js';
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export function dockerConfigurationPreparation(directory = join(homedir(), '.docker')) {
    if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(directory))
        throw Error('Docker configuration preparation requires a printable single-line path');
    return { directory, command: `mkdir -p -m 700 ${quote(directory)}` };
}
export function runtimePrerequisites(directory?: string, locale: UiLocale = 'en') {
    const t = translator(locale);
    const configuration = dockerConfigurationPreparation(directory);
    return [
        t('runtime.helpIntro'),
        t('runtime.helpInstaller'),
        t('runtime.helpPaths'),
        t('runtime.helpConfig', configuration),
        t('runtime.helpExistingImage'),
        t('runtime.helpPrepareImage'),
    ].join('\n\n');
}
/** Owner-operated shell guidance only; this function never executes or builds. */
export function runtimeImageBuildHelp(input: RuntimeDiscoveryInput, recipe = fileURLToPath(new URL('../../runtime/', import.meta.url)), locale: UiLocale = 'en') {
    if (!input.dockerContext || [recipe, input.dockerBinary, input.dockerConfigDirectory, input.dockerContext].some(value => /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)))
        throw Error('Build guidance requires printable single-line paths and an explicit context');
    const t = translator(locale);
    return [
        t('runtime.helpManualBuild'),
        t('runtime.helpManualCopy'),
        `gitjig_recipe=${quote(recipe)}\ngitjig_docker=${quote(input.dockerBinary)}\ngitjig_docker_config=${quote(input.dockerConfigDirectory)}\ngitjig_docker_context=${quote(input.dockerContext!)}\ngitjig_image_ready=no\nif gitjig_image_work=$(mktemp -d /tmp/gitjig-image.XXXXXX); then\n  gitjig_image_context="$gitjig_image_work/context"\n  gitjig_image_id="$gitjig_image_work/image-id"\n  mkdir "$gitjig_image_context" &&\n  cp "$gitjig_recipe/Dockerfile" "$gitjig_recipe/Dockerfile.dockerignore" \\\n    "$gitjig_recipe/io-helper.mjs" "$gitjig_image_context/" &&\n  gitjig_image_ready=yes\nfi`,
        t('runtime.helpManualEdit'),
        `if test "$gitjig_image_ready" = yes && test -n "$gitjig_image_context" && test -f "$gitjig_image_context/io-helper.mjs" &&\n  test -n "$gitjig_image_id" && test ! -e "$gitjig_image_id" &&\n  "$gitjig_docker" --config "$gitjig_docker_config" \\\n  --context "$gitjig_docker_context" build \\\n  --file "$gitjig_image_context/Dockerfile" \\\n  --iidfile "$gitjig_image_id" "$gitjig_image_context"; then\n  cat "$gitjig_image_id"\nelse\n  printf '%s\\n' 'No image selected. Fix the failure and restart with a fresh temporary context.' >&2\nfi`,
        t('runtime.helpManualResult'),
        t('runtime.helpManualLimits'),
    ].join('\n\n');
}
