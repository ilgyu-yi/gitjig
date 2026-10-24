#!/usr/bin/env node
import { captureClaudeOperatorEnvironment } from '../app/bridge-connection.js';
import { isAbsolute, resolve } from 'node:path';
import { parseInvocation, required, nonnegativeInteger, UsageError, usage } from './arguments.js';
import { resolveApplicationHome } from '../app/home.js';
import { initializeApplicationEnvironment } from '../app/environment.js';
import { assertCompatibleNode } from '../app/runtime-requirements.js';
import type { CommandKey } from '../ui/command-key.js';
import type { RuntimeProfile, ObservationResult } from '../controller/types.js';
import type { ChangeView } from '../controller/change-types.js';
import type { EffectsProfile, EffectView, EffectDelegationConfig } from '../controller/effect-types.js';
import type { RepositoryConfigurationView, RepositoryConfigurationAudit } from '../controller/configuration-types.js';
import type { PublicationView } from '../controller/publication-types.js';
async function githubCredential(file: string, projectRoots: readonly string[], label = 'GitHub credential profile'): Promise<{
    token: string;
}> {
    return (await import('../app/repository-credential.js')).readRepositoryCredential(file, projectRoots, label);
}
function runtimeProfile(options: ReadonlyMap<string, string>): RuntimeProfile | undefined {
    const names = ['docker-binary', 'docker-context', 'image', 'docker-config-directory'];
    if (!names.some(name => options.has(name)))
        return undefined;
    const dockerBinary = required(options, 'docker-binary');
    if (!isAbsolute(dockerBinary))
        throw new UsageError('--docker-binary must be absolute');
    return { dockerBinary, dockerContext: required(options, 'docker-context'), image: required(options, 'image'), ...(options.has('docker-config-directory') ? { dockerConfigDirectory: required(options, 'docker-config-directory') } : {}) };
}
function boundedOption(options: ReadonlyMap<string, string>, key: string): number | undefined {
    if (!options.has(key))
        return undefined;
    const value = nonnegativeInteger(required(options, key), key);
    if (value < 1 || value > 1000)
        throw new UsageError(`--${key} must be between 1 and 1000`);
    return value;
}
function observationExit(result: ObservationResult): number {
    return result.status === 'succeeded' || result.status === 'delivered' ? 0 : result.status === 'failed' ? 1 : 2;
}
function effectsProfile(options: ReadonlyMap<string, string>): EffectsProfile | undefined {
    if (!['git-binary', 'git-timeout-ms', 'git-output-bytes'].some(name => options.has(name)))
        return undefined;
    const gitBinary = required(options, 'git-binary');
    if (!isAbsolute(gitBinary))
        throw new UsageError('--git-binary must be absolute');
    const commandTimeoutMs = options.has('git-timeout-ms') ? nonnegativeInteger(required(options, 'git-timeout-ms'), 'git-timeout-ms') : 10000;
    const maxOutputBytes = options.has('git-output-bytes') ? nonnegativeInteger(required(options, 'git-output-bytes'), 'git-output-bytes') : 1024 * 1024;
    if (commandTimeoutMs < 1 || commandTimeoutMs > 120000)
        throw new UsageError('--git-timeout-ms must be between 1 and 120000');
    if (maxOutputBytes < 1 || maxOutputBytes > 16 * 1024 * 1024)
        throw new UsageError('--git-output-bytes must be between 1 and 16777216');
    return { gitBinary, commandTimeoutMs, maxOutputBytes };
}
function integrationGrants(value: string | undefined): readonly EffectDelegationConfig[] | undefined {
    if (value === undefined)
        return undefined;
    const grants = value.split(',').map(part => {
        const pieces = part.split(':');
        if (pieces.length !== 3 || !/^[A-Za-z0-9_-]{1,100}$/.test(pieces[0]!) || !/^[A-Za-z0-9_-]{1,100}$/.test(pieces[1]!)) {
            throw new UsageError('--delegate-integrations requires PROJECT:TARGET:LIMIT triples');
        }
        const operationLimit = nonnegativeInteger(pieces[2]!, 'delegate-integrations');
        if (operationLimit < 1 || operationLimit > 100)
            throw new UsageError('Integration limits must be between 1 and 100');
        return { projectId: pieces[0]!, targetId: pieces[1]!, operationLimit };
    });
    if (grants.length > 100 || new Set(grants.map(grant => `${grant.projectId}:${grant.targetId}`)).size !== grants.length) {
        throw new UsageError('Integration grants require at most100 distinct project/target pairs');
    }
    return grants;
}
async function main(args: readonly string[]): Promise<number> {
    const initialDirectory = process.cwd();
    const operatorClaude = captureClaudeOperatorEnvironment();
    initializeApplicationEnvironment();
    if (args.length === 1 && args[0] === '--version') {
        const { applicationIdentity } = await import('../app/identity.js');
        console.log(JSON.stringify(applicationIdentity()));
        return 0;
    }
    if (!args.length && process.stdin.isTTY && process.stdout.isTTY)
        args = ['conversation', 'ui'];
    if (!args.length || (args.length === 1 && args[0] === '--help')) {
        console.log(usage);
        return 0;
    }
    const { command, options } = parseInvocation(args);
    // Retain explicit launch choices before bridge startup changes cwd/HOME.
    const restartArguments = command === 'conversation ui' ? [...options].filter(([key]) => !['home', 'project', 'conversation'].includes(key))
        .flatMap(([key, value]) => ['--' + key, ['model-profile', 'credential-profile'].includes(key) ? resolve(value) : value]) : [];
    if (command === 'doctor') {
        const { diagnose } = await import('./doctor.js');
        const result = await diagnose(options.get('docker-context'));
        console.log(JSON.stringify(result.report, null, 2));
        return result.exitCode;
    }
    assertCompatibleNode();
    if (command === 'repo recommend') {
        const { recommendedConfiguration } = await import('./configuration-recommendation.js');
        console.log(JSON.stringify(recommendedConfiguration(required(options, 'branch'), (options.get('provider') ?? 'github') as 'github' | 'gitea' | 'gitlab', (options.get('mode') ?? 'update') as 'update' | 'create'), null, 2));
        return 0;
    }
    if (command === 'local recommend') {
        const { recommendedLocalConventions } = await import('../app/local-conventions.js');
        console.log(JSON.stringify(recommendedLocalConventions(), null, 2));
        return 0;
    }
    const installationHome = resolveApplicationHome(options.get('home'));
    if (!isAbsolute(installationHome))
        throw new UsageError('--home must be absolute');
    if (command === 'reset' || command.startsWith('reset ')) {
        if (command === 'reset backups' || command === 'reset backup-delete' || command === 'reset backup-recover') {
            const backups = await import('../app/reset-backups.js');
            const result = command === 'reset backups' ? await backups.listResetBackups(installationHome)
                : command === 'reset backup-delete' ? await backups.deleteResetBackup(installationHome, required(options, 'backup'), required(options, 'confirm'))
                : await backups.recoverResetBackupDeletion(installationHome);
            console.log(JSON.stringify(result, null, 2));
            return 0;
        }
        const reset = await import('../app/reset.js');
        // Only the interactive entry defaults to all; noninteractive preview/apply name their scope explicitly.
        const scope = command === 'reset preview' || command === 'reset apply' ? required(options, 'scope') : options.get('scope') ?? 'all';
        if (scope !== 'settings' && scope !== 'all')
            throw new UsageError('--scope must be settings or all');
        const disposition = options.get('disposition');
        if (disposition !== undefined && disposition !== 'backup' && disposition !== 'delete')
            throw new UsageError('--disposition must be backup or delete');
        if (command === 'reset') {
            await (await import('./reset.js')).interactiveReset(installationHome, scope, 'en', disposition);
            return 0;
        }
        const result = command === 'reset preview' ? await reset.prepareApplicationReset(installationHome, scope, disposition ?? 'backup') : command === 'reset apply' ? await reset.applyApplicationReset(installationHome, scope, required(options, 'confirm'), disposition ?? 'backup') : await reset.recoverApplicationReset(installationHome);
        console.log(JSON.stringify(result, null, 2));
        return 0;
    }
    // Complete syntax checks before opening state or taking its writer lock.
    if (command === 'auth login') {
        required(options, 'provider');
        if (!['api_key', 'oauth'].includes(required(options, 'method')))
            throw new UsageError('--method must be api_key or oauth');
        if (!process.stdin.isTTY || !process.stderr.isTTY)
            throw new UsageError('Login requires an interactive terminal');
    }
    if (command === 'auth logout' || command === 'models default')
        required(options, 'provider');
    if (command === 'models default')
        required(options, 'model');
    if (command === 'models role-set' || command === 'models role-reset') {
        const { applicationModelRoles } = await import('../app/model-roles.js');
        if (!(applicationModelRoles as readonly string[]).includes(required(options, 'role')))
            throw new UsageError('Unknown workflow role');
    }
    if (command === 'models role-set') {
        required(options, 'provider');
        required(options, 'model');
    }
    if (options.has('thinking') && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(required(options, 'thinking')))
        throw new UsageError('Invalid thinking level');
    if (command === 'change start' || command === 'change prepare') {
        if (options.has('provider') !== options.has('model') || options.has('thinking') && !options.has('model'))
            throw new UsageError('Application model selection requires paired --provider and --model');
        if (options.has('model-profile') && options.has('provider'))
            throw new UsageError('Choose an application model or --model-profile');
        if (command === 'change prepare' && (options.has('model-source') && options.get('model-source') !== 'application' || options.has('provider') && options.get('model-source') !== 'application'))
            throw new UsageError('Use --model-source application for application preparation');
    }
    if (command === 'models scope')
        required(options, 'patterns');
    if ((command === 'models configure' || command === 'setup save') && !isAbsolute(required(options, 'file')))
        throw new UsageError('--file must be an absolute owner-only JSON file');
    if (command === 'settings set') {
        required(options, 'key');
        required(options, 'value');
    }
    if (command === 'settings approve-project')
        required(options, 'project');
    if (command === 'project register') {
        required(options, 'id');
        required(options, 'root');
    }
    if (command.startsWith('goal ') && !['goal create', 'goal list'].includes(command))
        required(options, 'goal');
    if (['goal run', 'goal resume', 'goal pause', 'goal cancel', 'goal revise', 'goal extend'].includes(command))
        nonnegativeInteger(required(options, 'revision'), 'revision');
    if (['goal pause', 'goal cancel', 'goal revise', 'goal extend'].includes(command))
        required(options, 'reason');
    if (command === 'goal create')
        required(options, 'conversation');
    if (['goal create', 'goal revise'].includes(command)) {
        required(options, 'objective');
        let values: unknown;
        try {
            values = JSON.parse(required(options, 'criteria'));
        }
        catch {
            throw new UsageError('--criteria requires a non-empty JSON array of strings');
        }
        if (!Array.isArray(values) || !values.length || !values.every(x => typeof x === 'string' && x.trim()))
            throw new UsageError('--criteria requires an explicit nonempty JSON string array');
    }
    if (command === 'goal extend')
        nonnegativeInteger(required(options, 'units'), 'units');
    if (options.has('turn-limit'))
        nonnegativeInteger(required(options, 'turn-limit'), 'turn-limit');
    const repositoryProvider = options.get('provider') ?? 'github';
    if (command === 'repo inspect') {
        required(options, 'owner');
        required(options, 'repo');
        required(options, 'credential-profile');
        if (!['github', 'gitea', 'gitlab'].includes(repositoryProvider))
            throw new UsageError('--provider must be github, gitea or gitlab');
        if (repositoryProvider === 'github') {
            if (options.has('api-base'))
                throw new UsageError('GitHub inspection uses fixed GitHub.com; --api-base belongs to Gitea/GitLab only');
        }
        else {
            const base = required(options, 'api-base'), { repositoryApiBase } = await import('../platform/repository-inspect-transport.js'), { validateRepositoryInspectionTarget } = await import('../platform/repository-inspect.js');
            try {
                repositoryApiBase(repositoryProvider as 'gitea' | 'gitlab', base);
                validateRepositoryInspectionTarget(repositoryProvider as 'gitea' | 'gitlab', required(options, 'owner'), required(options, 'repo'), options.get('branch'));
            }
            catch (error) {
                throw new UsageError(error instanceof Error ? error.message : 'Invalid repository inspection target');
            }
        }
    }
    const configurationNetwork = ['repo preview', 'repo apply', 'repo reconcile', 'repo audit', 'repo guide'].includes(command);
    if (command === 'merge register-target') {
        for (const field of ['resource', 'source-target', 'base', 'credential-profile'])
            required(options, field);
        try {
            (await import('../platform/github-merge-protocol.js')).mergeBranchName(required(options, 'base'));
        }
        catch {
            throw new UsageError('--base requires one literal Git branch name');
        }
    }
    const mergeRegistrationRequest = command === 'merge register-target' ? Object.freeze({ resourceId: required(options, 'resource'), sourceBranchTargetId: required(options, 'source-target'), baseRef: required(options, 'base') }) : undefined;
    const contributionNetwork = ['repo track', 'repo parent', 'repo refresh'].includes(command);
    if (contributionNetwork)
        required(options, 'credential-profile');
    if (command === 'repo track') {
        required(options, 'repository-profile');
        const kind = required(options, 'kind');
        if (kind !== 'issue' && kind !== 'pull-request')
            throw new UsageError('--kind must be issue or pull-request');
    }
    const contributionNumber = command === 'repo track' ? nonnegativeInteger(required(options, 'number'), 'number') : undefined;
    if (contributionNumber !== undefined && contributionNumber < 1)
        throw new UsageError('--number must be positive');
    if (['repo parent', 'repo contributions', 'repo summary'].includes(command))
        required(options, 'resource');
    const contributionRevision = command === 'repo parent' ? nonnegativeInteger(required(options, 'revision'), 'revision') : command === 'repo summary' && options.has('revision') ? nonnegativeInteger(required(options, 'revision'), 'revision') : undefined;
    const resourceIds = command === 'repo refresh' && options.has('resources') ? required(options, 'resources').split(',') : undefined;
    if (resourceIds && (resourceIds.length > 4 || new Set(resourceIds).size !== resourceIds.length || resourceIds.some(id => !id || !/^[A-Za-z0-9_-]{1,100}$/.test(id))))
        throw new UsageError('--resources requires one to four distinct resource IDs');
    const observedRegistration = command === 'repo register-target' && !options.has('target-profile');
    if (command === 'repo register-target') {
        if (!observedRegistration) {
            required(options, 'target-profile');
            if (['provider', 'api-base', 'owner', 'repo', 'credential-profile'].some(k => options.has(k)))
                throw new UsageError('Choose --target-profile or observed provider registration, not both');
        }
        else {
            const provider = required(options, 'provider');
            required(options, 'owner');
            required(options, 'repo');
            required(options, 'credential-profile');
            const { validateGitHubConfigurationPath, validateRepositoryIdentityPath } = await import('../platform/repository-identity.js');
            try {
                if (provider === 'github') {
                    if (options.has('api-base'))
                        throw Error('GitHub registration uses fixed GitHub.com; no --api-base');
                    validateGitHubConfigurationPath(required(options, 'owner'), required(options, 'repo'));
                }
                else if (provider === 'gitea' || provider === 'gitlab') {
                    const { repositoryApiBase } = await import('../platform/repository-inspect-transport.js');
                    repositoryApiBase(provider, required(options, 'api-base'));
                    validateRepositoryIdentityPath(provider, required(options, 'owner'), required(options, 'repo'));
                }
                else
                    throw Error('--provider must be github, gitea or gitlab');
            }
            catch (error) {
                throw new UsageError(error instanceof Error ? error.message : 'Invalid registration target');
            }
        }
    }
    const configurationListLimit = ['repo targets', 'repo plans'].includes(command) && options.has('limit') ? nonnegativeInteger(required(options, 'limit'), 'limit') : undefined;
    if (configurationListLimit !== undefined && (configurationListLimit < 1 || configurationListLimit > 100))
        throw new UsageError('--limit must be between 1 and 100');
    if (configurationNetwork)
        required(options, 'credential-profile');
    if (command === 'repo preview') {
        required(options, 'target');
        required(options, 'profile');
    }
    if (['repo apply', 'repo reconcile', 'repo audit', 'repo plan'].includes(command))
        required(options, 'plan');
    if (command === 'repo guide') {
        required(options, 'target');
        required(options, 'branch');
    }
    if (command === 'publication register-target')
        required(options, 'target-profile');
    if (command === 'publication delegate') {
        required(options, 'work');
        required(options, 'target');
        required(options, 'grant-profile');
    }
    if (command === 'publication prepare') {
        required(options, 'target');
        required(options, 'payload-file');
    }
    if (command === 'publication prepare-contribution-summary') {
        required(options, 'resource');
        required(options, 'revision-id');
        required(options, 'target');
    }
    if (['publication dispatch', 'publication reconcile', 'publication inspect'].includes(command))
        required(options, 'operation');
    if (['publication dispatch', 'publication reconcile'].includes(command))
        required(options, 'credential-profile');
    const nativeLocal = ['local git', 'local prepare', 'local evidence', 'local candidate', 'local audit'].includes(command);
    const effectProfile = nativeLocal ? undefined : effectsProfile(options);
    if (nativeLocal && !isAbsolute(required(options, 'git-binary')))
        throw new UsageError('--git-binary must be an absolute trusted executable');
    const effectDelegations = integrationGrants(options.get('delegate-integrations'));
    if (effectDelegations && !effectProfile)
        throw new UsageError('Integration grants require an explicit Git profile');
    if (command === 'effect register-target')
        required(options, 'target-profile');
    if (['effect delegate-integration', 'effect prepare-integration'].includes(command)) {
        required(options, 'work');
        required(options, 'target');
    }
    if (['effect dispatch', 'effect reconcile', 'effect inspect', 'merge inspect'].includes(command))
        required(options, 'operation');
    if (['effect register-target', 'effect prepare-integration', 'effect dispatch', 'effect reconcile'].includes(command) && !effectProfile)
        throw new UsageError('Native effect entry requires explicit GIT options; use --help');
    const effectLimit = ['effect delegate-integration', 'publication delegate'].includes(command) ? nonnegativeInteger(required(options, 'operation-limit'), 'operation-limit') : undefined;
    if (effectLimit !== undefined && (effectLimit < 1 || effectLimit > 100))
        throw new UsageError('--operation-limit must be between 1 and 100');
    const effectScope = options.get('scope');
    if (effectScope !== undefined && effectScope !== 'work' && effectScope !== 'delegation-lineage')
        throw new UsageError('--scope must be work or delegation-lineage');
    const effectMode = options.get('mode') ?? 'ordinary';
    if (effectMode !== 'ordinary' && effectMode !== 'owner-override')
        throw new UsageError('--mode must be ordinary or owner-override');
    if (command.startsWith('work '))
        required(options, 'work');
    if (command === 'change prepare' || command === 'change start') {
        required(options, 'project');
        required(options, 'message');
    }
    if (['change activate', 'change inspect', 'change run', 'change resume', 'change replan', 'change extend-resolution', 'change refresh-criteria'].includes(command))
        required(options, 'work');
    if (command === 'change activate') {
        required(options, 'epoch');
        if (options.has('resume-cancelled') && !['true', 'false'].includes(required(options, 'resume-cancelled')))
            throw new UsageError('--resume-cancelled must be true or false');
    }
    if (command === 'change refresh-criteria')
        required(options, 'reason');
    const resolutionLimit = boundedOption(options, 'resolution-limit');
    const executionLimit = boundedOption(options, 'execution-limit');
    const maximumSteps = boundedOption(options, 'maximum-steps');
    if (command === 'local check') {
        required(options, 'project');
        required(options, 'command');
    }
    if (['local inspect', 'local protection', 'local protect', 'local git', 'local conventions', 'local configure', 'local prepare', 'local evidence', 'local candidate', 'local audit', 'local candidates'].includes(command))
        required(options, 'project');
    if (['local evidence', 'local candidate'].includes(command))
        required(options, 'work');
    if (command === 'local audit') {
        required(options, 'candidate');
        required(options, 'commit');
    }
    const localRevision = command === 'local configure' ? nonnegativeInteger(required(options, 'revision'), 'revision') : undefined;
    if (command === 'local configure' && !isAbsolute(required(options, 'profile')))
        throw new UsageError('--profile must be an absolute private JSON file');
    if (['local prepare', 'local candidate'].includes(command) && !isAbsolute(required(options, 'message-file')))
        throw new UsageError('--message-file must be an absolute text file');
    const protectionRevision = command === 'local protect' ? nonnegativeInteger(required(options, 'revision'), 'revision') : undefined;
    if (command === 'local protect')
        required(options, 'policy-profile');
    if (command === 'conversation start') {
        required(options, 'project');
        required(options, 'message');
    }
    if (['conversation inspect', 'conversation parent', 'conversation project', 'conversation archive', 'conversation restore', 'conversation reclaim', 'conversation delete'].includes(command))
        required(options, 'conversation');
    const relationRevision = command === 'conversation parent' ? nonnegativeInteger(required(options, 'revision'), 'revision') : undefined;
    const scopeGeneration = command === 'conversation project' ? nonnegativeInteger(required(options, 'generation'), 'generation') : undefined;
    if (command === 'conversation project')
        required(options, 'project');
    const lifecycleGeneration = ['conversation archive', 'conversation restore', 'conversation reclaim', 'conversation delete'].includes(command) ? nonnegativeInteger(required(options, 'generation'), 'generation') : undefined;
    const resourceMode = options.get('completed-resource-mode') ?? 'immediate';
    if (!['immediate', 'finite'].includes(resourceMode))
        throw new UsageError('completed-resource-mode must be immediate or finite');
    const resourceIdleMs = options.has('completed-resource-idle-ms') ? nonnegativeInteger(required(options, 'completed-resource-idle-ms'), 'completed-resource-idle-ms') : 0;
    const resourceLimit = options.has('completed-resource-limit') ? nonnegativeInteger(required(options, 'completed-resource-limit'), 'completed-resource-limit') : 0;
    if (resourceIdleMs > 86400000 || resourceLimit > 16)
        throw new UsageError('completed-resource-idle-ms requires0..86400000 and limit0..16');
    const delegatedProjects = options.has('delegate-projects') ? required(options, 'delegate-projects').split(',') : undefined;
    if (delegatedProjects && (delegatedProjects.some(id => !/^[A-Za-z0-9_-]{1,100}$/.test(id)) || new Set(delegatedProjects).size !== delegatedProjects.length))
        throw new UsageError('--delegate-projects requires distinct registered IDs separated by commas');
    const maxAssignments = options.has('max-assignments') ? nonnegativeInteger(required(options, 'max-assignments'), 'max-assignments') : undefined;
    if (maxAssignments !== undefined && (maxAssignments < 1 || maxAssignments > 100))
        throw new UsageError('--max-assignments must be between 1 and 100');
    const completedViewLimit = options.has('completed-view-limit') ? nonnegativeInteger(required(options, 'completed-view-limit'), 'completed-view-limit') : 2;
    const viewIdleGraceMs = options.has('view-idle-grace-ms') ? nonnegativeInteger(required(options, 'view-idle-grace-ms'), 'view-idle-grace-ms') : 60000;
    if (completedViewLimit > 100)
        throw new UsageError('--completed-view-limit must be between 0 and 100');
    if (viewIdleGraceMs > 86400000)
        throw new UsageError('--view-idle-grace-ms must be between 0 and 86400000');
    if (command === 'conversation ui') {
        if (options.has('project') && options.has('conversation'))
            throw new UsageError('Select an existing --conversation or create with --project');
        if (!process.stdin.isTTY || !process.stdout.isTTY)
            throw new UsageError('Interactive conversation entry requires a terminal on stdin and stdout');
    }
    const cwd = options.get('cwd');
    if (cwd !== undefined && cwd !== 'work' && cwd !== 'scratch')
        throw new UsageError('--cwd must be work or scratch');
    const epoch = options.has('epoch') ? nonnegativeInteger(required(options, 'epoch'), 'epoch') : undefined;
    const isExtension = command === 'work extend' || command === 'change extend-resolution';
    const additional = isExtension ? nonnegativeInteger(required(options, 'units'), 'units') : undefined;
    if (isExtension) {
        required(options, 'reason');
        if (!additional || additional > 100)
            throw new UsageError('--units must be between 1 and 100');
    }
    if (command === 'work resume' && options.has('command') && options.has('message'))
        throw new UsageError('Resume accepts either --command or --message');
    if (command === 'work resume' && options.has('command') && options.has('model-profile'))
        throw new UsageError('A command resume does not accept a model profile');
    const changeListLimit = command === 'change list' && options.has('limit') ? nonnegativeInteger(required(options, 'limit'), 'limit') : undefined;
    if (changeListLimit !== undefined && (changeListLimit < 1 || changeListLimit > 100))
        throw new UsageError('--limit must be between 1 and 100');
    let profile = runtimeProfile(options);
    const localManagement = ['local git', 'local conventions', 'local configure', 'local prepare', 'local evidence', 'local candidate', 'local audit', 'local candidates'].includes(command);
    const contributionManagement = contributionNetwork || ['repo resources', 'repo contributions', 'repo summary'].includes(command);
    const mergeManagement = ['merge register-target', 'merge list', 'merge inspect', 'merge targets', 'merge target-inspect'].includes(command);
    const mergeListLimit = ['merge list', 'merge targets'].includes(command) && options.has('limit') ? nonnegativeInteger(required(options, 'limit'), 'limit') : undefined;
    if (mergeListLimit !== undefined && (mergeListLimit < 1 || mergeListLimit > 100))
        throw new UsageError('--limit must be between 1 and 100');
    const integrationManagement = ['effect list', 'effect inspect', 'effect targets', 'effect target-inspect'].includes(command);
    const integrationListLimit = ['effect list', 'effect targets'].includes(command) && options.has('limit') ? nonnegativeInteger(required(options, 'limit'), 'limit') : undefined;
    if (integrationListLimit !== undefined && (integrationListLimit < 1 || integrationListLimit > 100))
        throw new UsageError('--limit must be between1 and100');
    const publicationManagement = ['publication list', 'publication inspect'].includes(command);
    const publicationListLimit = command === 'publication list' && options.has('limit') ? nonnegativeInteger(required(options, 'limit'), 'limit') : undefined;
    if (publicationListLimit !== undefined && (publicationListLimit < 1 || publicationListLimit > 100))
        throw new UsageError('--limit must be between1 and100');
    const invocationRuntime = profile, managementOnly = mergeManagement || integrationManagement || publicationManagement || contributionManagement || ['change list', 'change activate', 'repo inspect', 'repo targets', 'repo plans', 'repo register-target', 'repo preview', 'repo apply', 'repo reconcile', 'repo audit', 'repo guide', 'repo plan'].includes(command) || localManagement || /^(auth|models|settings|setup) /u.test(command) || command.startsWith('goal ') && !['goal run', 'goal resume'].includes(command);
    let preparedStartup: import('../app/startup.js').PreparedStartup | undefined, startupDiagnostic: string | undefined;
    const { openController, ControllerError } = await import('../controller/index.js');
    const controller = await openController({ installationHome, completedResources: { mode: resourceMode as 'immediate' | 'finite', idleMs: resourceIdleMs, maxRetained: resourceLimit }, ...(profile ? { runtimeProfile: profile } : {}),
        ...(effectProfile ? { effectsProfile: effectProfile } : {}), ...(effectDelegations ? { effectDelegations } : {}),
        ...(delegatedProjects !== undefined || maxAssignments !== undefined ? { interactionDelegation: {
                ...(delegatedProjects === undefined ? {} : { projectIds: delegatedProjects }), ...(maxAssignments === undefined ? {} : { maxAssignments }),
            } } : {}),
    }, { managementOnly, prepareStartup: async (context) => {
            if (mergeManagement || integrationManagement || publicationManagement || contributionManagement || ['change list', 'change activate', 'repo inspect', 'repo targets', 'repo plans', 'repo register-target', 'repo preview', 'repo apply', 'repo reconcile', 'repo audit', 'repo guide', 'repo plan'].includes(command) || localManagement || /^(auth|settings|setup) /u.test(command) || command.startsWith('goal ') && managementOnly)
                return {};
            const { prepareApplicationStartup } = await import('../app/startup.js');
            const { applyApplicationStartup } = await import('./application-startup.js');
            try {
                preparedStartup = await prepareApplicationStartup(context.installationHome, context.projectRoots, { ...(invocationRuntime ? { runtime: invocationRuntime } : {}), bridge: !options.has('model-profile'), ignoreRuntime: managementOnly });
                await applyApplicationStartup(preparedStartup, context.installationHome);
                return preparedStartup.configuration.runtime ? { runtimeProfile: preparedStartup.configuration.runtime } : {};
            }
            catch (error) {
                if (!managementOnly)
                    throw error;
                preparedStartup = undefined;
                startupDiagnostic = 'Saved startup is unavailable; inspect or repair with setup commands';
                return {};
            }
        } });
    profile = controller.options.runtimeProfile;
    const abort = new AbortController();
    const onSignal = () => abort.abort();
    // SDK dependencies may re-send a signal when no application handler remains.
    // Keep the handler throughout async teardown, including repeated signals.
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    try {
        if (['local check', 'conversation start', 'work resume', 'change start', 'change run', 'change resume', 'change replan', 'effect prepare-integration'].includes(command) && !profile)
            throw new UsageError('Execution requires saved setup or complete RUNTIME options; use setup inspect or --help.');
        const { adoptApplicationStartup } = await import('./application-startup.js');
        await adoptApplicationStartup(preparedStartup, controller);
        let mergeRegistrationFingerprint: string | undefined;
        const freshMergeRegistration = () => { abort.signal.throwIfAborted(); if (!mergeRegistrationRequest || controller.inspectMergeRegistration(mergeRegistrationRequest).fingerprint !== mergeRegistrationFingerprint)
            throw Error('Original PR registration operands changed; inspect their current retained identities before retrying'); };
        if (mergeRegistrationRequest) {
            mergeRegistrationFingerprint = controller.inspectMergeRegistration(mergeRegistrationRequest).fingerprint;
            const credential = await githubCredential(required(options, 'credential-profile'), controller.listProjects().map(project => project.sourceRoot));
            freshMergeRegistration();
            controller.configureMergeCredential(credential);
            freshMergeRegistration();
        }
        if (contributionNetwork)
            controller.configureContributionReader(await githubCredential(required(options, 'credential-profile'), controller.listProjects().map(project => project.sourceRoot)));
        if (configurationNetwork) {
            await controller.configureRepositoryConfigurationCredential(await githubCredential(required(options, 'credential-profile'), controller.listProjects().map(project => project.sourceRoot)));
        }
        if ((command.startsWith('publication ') || command === 'conversation ui') && options.has('credential-profile')) {
            const credential = await githubCredential(required(options, 'credential-profile'), controller.listProjects().map(project => project.sourceRoot));
            await controller.configurePublicationCredential(credential);
            if (command === 'conversation ui') {
                if (effectProfile)
                    controller.configureHostedIntegrationCredential(credential);
                controller.configureContributionReader(credential);
                controller.startContributionRefresh();
            }
        }
        if (['effect register-target', 'effect prepare-integration', 'effect dispatch', 'effect reconcile'].includes(command) && options.has('credential-profile')) {
            controller.configureHostedIntegrationCredential(await githubCredential(required(options, 'credential-profile'), controller.listProjects().map(project => project.sourceRoot)));
        }
        if (['conversation ui', 'change activate'].includes(command) && options.has('delegate-publications')) {
            const { readPublicationDelegations } = await import('./publication-profile.js');
            await controller.configurePublicationDelegations(await readPublicationDelegations(required(options, 'delegate-publications'), controller.listProjects().map(project => project.sourceRoot)));
        }
        const { ApplicationStartup } = await import('../app/startup.js');
        const startup = ApplicationStartup.open(controller, preparedStartup);
        let result: unknown;
        let applicationModels: import('../app/models.js').ApplicationModels | undefined;
        const appModels = async () => {
            if (!applicationModels) {
                const { ApplicationModels } = await import('../app/models.js');
                applicationModels = new ApplicationModels(controller);
                if (!managementOnly)
                    applicationModels.install();
            }
            return applicationModels;
        };
        const newApplicationBaseline = async (project: string) => {
            const models = await appModels();
            const explicit = options.has('provider') ? await models.choice(required(options, 'provider'), required(options, 'model'), options.get('thinking') as import('@earendil-works/pi-ai').ModelThinkingLevel | undefined, project) : undefined;
            return models.baseline(project, explicit);
        };
        const retainedChangeOperation = async (workId: string): Promise<import('../controller/change-types.js').ChangeOperation> => {
            // Inspect durable mode BEFORE reading an external profile or resolving credentials.
            const baseline = controller.getWorkApplicationModelBaseline(workId);
            if (baseline) {
                if (options.has('model-profile'))
                    throw new UsageError('Application work keeps its captured model baseline; omit --model-profile');
                const operation = (await appModels()).workOperation(workId);
                return controller.retainedWorkModelOperation(workId, undefined, operation.sessionPreferences);
            }
            if (!options.has('model-profile'))
                throw new UsageError('This work requires its explicit --model-profile; application defaults cannot convert retained work');
            const { selectControllerModel } = await import('./selected-model.js');
            return controller.retainedWorkModelOperation(workId, await selectControllerModel(required(options, 'model-profile'), controller));
        };
        switch (command) {
            case 'goal list':
                result = controller.listGoals();
                break;
            case 'goal inspect':
                result = controller.inspectGoal(required(options, 'goal'));
                break;
            case 'goal create':
                result = controller.createGoal({ conversationId: required(options, 'conversation'), objective: required(options, 'objective'), criteria: JSON.parse(required(options, 'criteria')), ...(options.has('turn-limit') ? { turnLimit: nonnegativeInteger(required(options, 'turn-limit'), 'turn-limit') } : {}) });
                break;
            case 'goal revise':
                result = controller.reviseGoal({ goalId: required(options, 'goal'), expectedRevision: nonnegativeInteger(required(options, 'revision'), 'revision'), objective: required(options, 'objective'), criteria: JSON.parse(required(options, 'criteria')), reason: required(options, 'reason') });
                break;
            case 'goal extend':
                result = controller.extendGoal({ goalId: required(options, 'goal'), expectedRevision: nonnegativeInteger(required(options, 'revision'), 'revision'), units: nonnegativeInteger(required(options, 'units'), 'units'), reason: required(options, 'reason') });
                break;
            case 'goal pause':
            case 'goal cancel':
                result = await controller.pauseGoal({ goalId: required(options, 'goal'), expectedRevision: nonnegativeInteger(required(options, 'revision'), 'revision'), reason: required(options, 'reason'), cancel: command === 'goal cancel' });
                break;
            case 'goal run':
            case 'goal resume': {
                const goal = controller.inspectGoal(required(options, 'goal'));
                const models = await appModels();
                const request = options.has('model-profile') ? { model: await (await import('./selected-model.js')).selectControllerModel(required(options, 'model-profile'), controller) } : models.conversationOperation(goal.conversationId);
                const started = controller.startGoal({ goalId: goal.goalId, expectedRevision: nonnegativeInteger(required(options, 'revision'), 'revision'), ...request, ...(options.has('input') ? { reconcileInputId: required(options, 'input') } : {}) });
                // A failed interrupt ends the wait through the ordinary error path so close() still quiesces; never an unhandled rejection.
                let interruptFailed: (error: unknown) => void = () => { };
                const failed = new Promise<never>((_, reject) => { interruptFailed = reject; });
                failed.catch(() => { });
                const interrupt = () => { controller.interruptGoal(started.goalId).catch(interruptFailed); };
                abort.signal.addEventListener('abort', interrupt, { once: true });
                if (abort.signal.aborted)
                    interrupt();
                try {
                    result = await Promise.race([controller.waitGoal(started.goalId), failed]);
                }
                finally {
                    abort.signal.removeEventListener('abort', interrupt);
                }
                break;
            }
            case 'setup inspect':
                result = await startup.inspect();
                break;
            case 'setup clear':
                result = await startup.clear();
                break;
            case 'setup save': {
                const { readOwnerJson } = await import('../app/owner-json.js');
                result = await startup.save(await readOwnerJson(required(options, 'file'), controller.listProjects().map(project => project.sourceRoot), 'Startup setup', 128 * 1024));
                break;
            }
            case 'models roles':
            case 'models role-set':
            case 'models role-reset': {
                const { ApplicationModels, applicationModelRoles } = await import('../app/models.js');
                const models = new ApplicationModels(controller);
                if (command !== 'models roles') {
                    const role = required(options, 'role') as import('../app/models.js').ApplicationModelRole;
                    const thinking = options.get('thinking') as import('@earendil-works/pi-ai').ModelThinkingLevel | undefined;
                    await models.setRole(role, command === 'models role-reset' ? null : await models.choice(required(options, 'provider'), required(options, 'model'), thinking));
                }
                const preferences = models.rolePreferences();
                result = applicationModelRoles.map(role => ({ role, selection: preferences[role] ?? { kind: 'inherited-work-baseline' } }));
                break;
            }
            case 'auth status':
            case 'auth login':
            case 'auth logout':
            case 'models list':
            case 'models default':
            case 'models scope':
            case 'models configure': {
                const { ApplicationAccounts } = await import('../app/accounts.js');
                const accounts = ApplicationAccounts.open(controller);
                if (command === 'auth status')
                    result = await accounts.status();
                else if (command === 'auth logout')
                    result = await accounts.logout(required(options, 'provider'), abort.signal);
                else if (command === 'auth login') {
                    const { terminalAccountInteraction } = await import('./account-interaction.js');
                    const terminal = terminalAccountInteraction(abort.signal);
                    try {
                        result = await accounts.login(required(options, 'provider'), required(options, 'method') as 'api_key' | 'oauth', terminal.interaction);
                    }
                    finally {
                        terminal.close();
                    }
                }
                else if (command === 'models list')
                    result = await accounts.models(options.get('search'));
                else if (command === 'models default')
                    result = await accounts.setDefault(required(options, 'provider'), required(options, 'model'));
                else if (command === 'models scope') {
                    let patterns: unknown;
                    try {
                        patterns = JSON.parse(required(options, 'patterns'));
                    }
                    catch {
                        throw new UsageError('--patterns requires a JSON array of model patterns');
                    }
                    if (!Array.isArray(patterns) || !patterns.every(pattern => typeof pattern === 'string'))
                        throw new UsageError('--patterns requires a JSON array of model patterns');
                    result = await accounts.setScope(patterns);
                }
                else {
                    const { readObject } = await import('../app/settings.js');
                    result = await accounts.configure(readObject(required(options, 'file'), true));
                }
                break;
            }
            case 'settings inspect':
            case 'settings set':
            case 'settings approve-project': {
                const { ApplicationSettings } = await import('../app/settings.js');
                const settings = ApplicationSettings.open(controller);
                if (command === 'settings approve-project')
                    settings.approveProject(required(options, 'project'));
                if (command === 'settings set') {
                    let value: unknown;
                    try {
                        value = JSON.parse(required(options, 'value'));
                    }
                    catch {
                        throw new UsageError('Preference value must be JSON (quote a string value)');
                    }
                    result = { savedScope: 'application', activeExecutionChanged: false, settings: await settings.setPreference(required(options, 'key'), value) };
                }
                else
                    result = settings.inspect(options.get('project'));
                break;
            }
            case 'repo track': {
                const { readContributionRepository } = await import('./contribution-profile.js');
                result = await controller.trackRepositoryResource({ repository: await readContributionRepository(required(options, 'repository-profile'), controller.listProjects().map(project => project.sourceRoot)), kind: required(options, 'kind') as 'issue' | 'pull-request', number: contributionNumber! }, abort.signal);
                break;
            }
            case 'repo parent':
                result = await controller.setResourceSummaryParent({ childId: required(options, 'resource'), parentId: options.has('parent') ? required(options, 'parent') : null, expectedRevision: contributionRevision! }, abort.signal);
                break;
            case 'repo refresh':
                result = await controller.refreshContributions({ ...resourceIds ? { resourceIds } : {}, signal: abort.signal });
                break;
            case 'repo resources':
                result = controller.listTrackedResources();
                break;
            case 'repo contributions':
                result = controller.inspectContributions({ resourceId: required(options, 'resource') });
                break;
            case 'repo summary':
                result = controller.prepareContributionSummary({ resourceId: required(options, 'resource'), ...contributionRevision !== undefined ? { expectedRevision: contributionRevision } : {} });
                break;
            case 'repo register-target': {
                const roots = controller.listProjects().map(project => project.sourceRoot);
                if (observedRegistration) {
                    const credential = await githubCredential(required(options, 'credential-profile'), roots, 'Repository credential profile'), input = { owner: required(options, 'owner'), repository: required(options, 'repo'), signal: abort.signal };
                    const { observeNativeConfigurationTarget, observeGitHubConfigurationTarget } = await import('../platform/repository-identity.js');
                    const target = repositoryProvider === 'github' ? await observeGitHubConfigurationTarget((await import('../platform/github.js')).openGitHubReadClient(credential), input) : await observeNativeConfigurationTarget({ ...credential, provider: repositoryProvider as 'gitea' | 'gitlab', apiBase: required(options, 'api-base') }, input);
                    result = { ...controller.registerRepositoryConfigurationTarget({ target }), target, scope: 'Observed identity registration only; no write permission or agent standing is established' };
                }
                else {
                    const { readConfigurationTarget } = await import('./configuration-profile.js');
                    result = controller.registerRepositoryConfigurationTarget({ target: await readConfigurationTarget(required(options, 'target-profile'), roots) });
                }
                break;
            }
            case 'repo targets':
                result = controller.listRepositoryConfigurationTargets({ ...configurationListLimit !== undefined ? { limit: configurationListLimit } : {}, ...options.has('before') ? { before: required(options, 'before') } : {} });
                break;
            case 'repo plans':
                result = controller.listRepositoryConfigurationPlans({ ...configurationListLimit !== undefined ? { limit: configurationListLimit } : {}, ...options.has('before') ? { before: required(options, 'before') } : {}, ...options.has('target') ? { targetId: required(options, 'target') } : {} });
                break;
            case 'repo preview': {
                const { readConfigurationProfile } = await import('./configuration-profile.js');
                result = await controller.previewRepositoryConfiguration({ targetId: required(options, 'target'), profile: await readConfigurationProfile(required(options, 'profile'), controller.listProjects().map(project => project.sourceRoot)),
                    ...(options.has('continuation-plan') ? { continuationPlanId: required(options, 'continuation-plan') } : {}),
                    ...(options.has('owned-creation-operation') ? { ownedCreationOperationId: required(options, 'owned-creation-operation') } : {}), signal: abort.signal });
                break;
            }
            case 'repo apply':
                result = await controller.applyRepositoryConfiguration({ planId: required(options, 'plan'), signal: abort.signal });
                break;
            case 'repo reconcile':
                result = await controller.reconcileRepositoryConfiguration({ planId: required(options, 'plan'), signal: abort.signal });
                break;
            case 'repo audit':
                result = await controller.auditRepositoryConfiguration({ planId: required(options, 'plan'), signal: abort.signal });
                break;
            case 'repo guide':
                result = await controller.guideRepositoryConfiguration({ targetId: required(options, 'target'), branch: required(options, 'branch'), signal: abort.signal });
                break;
            case 'repo plan':
                result = controller.inspectRepositoryConfiguration(required(options, 'plan'));
                break;
            case 'repo inspect': {
                const credential = await githubCredential(required(options, 'credential-profile'), controller.listProjects().map(project => project.sourceRoot), 'Repository credential profile');
                if (repositoryProvider !== 'github') {
                    const { openRepositoryInspector } = await import('../platform/repository-inspect.js');
                    const client = openRepositoryInspector({ provider: repositoryProvider as 'gitea' | 'gitlab', apiBase: required(options, 'api-base'), token: credential.token });
                    result = await client.inspect({ owner: required(options, 'owner'), repository: required(options, 'repo'), ...(options.has('branch') ? { branch: required(options, 'branch') } : {}), signal: abort.signal });
                    break;
                }
                const { openGitHubReadClient } = await import('../platform/github.js');
                const { inspectGitHubRepository } = await import('../platform/github-inspect.js');
                const client = openGitHubReadClient({ token: credential.token });
                result = await inspectGitHubRepository(client, required(options, 'owner'), required(options, 'repo'), options.get('branch'), abort.signal);
                break;
            }
            case 'publication register-target': {
                const { readPublicationTarget } = await import('./publication-profile.js');
                result = await controller.registerPublicationTarget(await readPublicationTarget(required(options, 'target-profile'), controller.listProjects().map(project => project.sourceRoot)));
                break;
            }
            case 'publication delegate': {
                const { readPublicationGrant } = await import('./publication-profile.js');
                result = await controller.delegatePublication({ workId: required(options, 'work'), targetId: required(options, 'target'), operationLimit: effectLimit!,
                    ...await readPublicationGrant(required(options, 'grant-profile'), controller.listProjects().map(project => project.sourceRoot)),
                    ...(effectScope ? { scope: effectScope } : {}),
                });
                break;
            }
            case 'publication prepare': {
                const { readPublicationAction } = await import('./publication-profile.js');
                result = await controller.prepareOwnerPublication({ targetId: required(options, 'target'), action: await readPublicationAction(required(options, 'payload-file')),
                    ...(options.has('work') ? { workId: required(options, 'work') } : {}), ...(options.has('operation') ? { operationId: required(options, 'operation') } : {}), signal: abort.signal });
                break;
            }
            case 'publication dispatch':
                result = await controller.dispatchPublication({ operationId: required(options, 'operation'), signal: abort.signal });
                break;
            case 'publication prepare-contribution-summary':
                result = await controller.prepareContributionSummaryPublication({ resourceId: required(options, 'resource'), revisionId: required(options, 'revision-id'), targetId: required(options, 'target'), ...(options.has('operation') ? { operationId: required(options, 'operation') } : {}), signal: abort.signal });
                break;
            case 'publication reconcile':
                result = await controller.reconcilePublication({ operationId: required(options, 'operation'), signal: abort.signal });
                break;
            case 'publication list':
                result = controller.listPublications({ ...publicationListLimit === undefined ? {} : { limit: publicationListLimit }, ...options.has('before') ? { before: required(options, 'before') } : {} });
                break;
            case 'publication inspect': {
                const retained = controller.inspectRetainedPublication(required(options, 'operation'));
                if (!retained.view)
                    throw Error('Retained publication ' + retained.entry.operationId + ' unavailable; original records were kept and no recovery performed');
                result = retained.view;
                break;
            }
            case 'effect register-target': {
                const { readTargetProfile } = await import('./target-profile.js');
                const target = await readTargetProfile(required(options, 'target-profile'), controller.listProjects().map(project => project.sourceRoot));
                if ('kind' in target) {
                    required(options, 'credential-profile');
                    const { kind: _kind, ...hosted } = target;
                    result = await controller.registerHostedIntegrationTarget(hosted);
                }
                else {
                    result = await controller.registerLocalTarget(target);
                }
                break;
            }
            case 'effect delegate-integration':
                result = controller.delegateIntegration({ workId: required(options, 'work'), targetId: required(options, 'target'), mode: effectMode, operationLimit: effectLimit!, ...(effectScope ? { scope: effectScope } : {}) });
                break;
            case 'effect targets':
                result = controller.listIntegrationTargets({ ...integrationListLimit === undefined ? {} : { limit: integrationListLimit }, ...options.has('before') ? { before: required(options, 'before') } : {} });
                break;
            case 'effect target-inspect':
                result = controller.inspectIntegrationTarget(required(options, 'target'));
                break;
            case 'merge register-target':
                result = await controller.registerMergeTarget(mergeRegistrationRequest!, abort.signal, freshMergeRegistration);
                break;
            case 'merge list':
                result = controller.listMerges({ ...mergeListLimit === undefined ? {} : { limit: mergeListLimit }, ...options.has('before') ? { before: required(options, 'before') } : {} });
                break;
            case 'merge targets':
                result = controller.listMergeTargets({ ...mergeListLimit === undefined ? {} : { limit: mergeListLimit }, ...options.has('before') ? { before: required(options, 'before') } : {} });
                break;
            case 'merge target-inspect':
                result = controller.inspectMergeTarget(required(options, 'target'));
                break;
            case 'merge inspect': {
                const retained = controller.inspectRetainedMerge(required(options, 'operation'));
                if (retained.state !== 'RETAINED')
                    throw Error('Original merge ' + retained.operationId + ' unavailable; records retained without repair');
                result = retained.view;
                break;
            }
            case 'effect list':
                result = controller.listIntegrations({ ...integrationListLimit === undefined ? {} : { limit: integrationListLimit }, ...options.has('before') ? { before: required(options, 'before') } : {} });
                break;
            case 'effect inspect': {
                const retained = controller.inspectRetainedIntegration(required(options, 'operation'));
                if (!retained.view)
                    throw Error('Retained integration ' + retained.entry.operationId + ' unavailable; original records were kept and no recovery performed');
                result = retained.view;
                break;
            }
            case 'effect dispatch':
                result = await controller.dispatchIntegration({ operationId: required(options, 'operation'), signal: abort.signal });
                break;
            case 'effect reconcile':
                result = await controller.reconcileEffect({ operationId: required(options, 'operation'), signal: abort.signal });
                break;
            case 'effect prepare-integration': {
                const operation = await retainedChangeOperation(required(options, 'work'));
                result = await controller.prepareIntegration({ ...operation, targetId: required(options, 'target'), signal: abort.signal,
                    ...(options.has('operation') ? { operationId: required(options, 'operation') } : {}),
                });
                break;
            }
            case 'conversation create':
                result = controller.createConversation({ projectId: options.get('project') ?? null });
                break;
            case 'conversation list':
                result = controller.listConversations();
                break;
            case 'conversation inspect':
                result = controller.inspectConversation(required(options, 'conversation'));
                break;
            case 'conversation parent':
                result = controller.setConversationParent({ childId: required(options, 'conversation'), parentId: options.get('parent') ?? null, expectedRevision: relationRevision! });
                break;
            case 'conversation project':
                await controller.reclaimConversationResource({ conversationId: required(options, 'conversation'), expectedGeneration: scopeGeneration! });
                result = controller.setConversationProject({ conversationId: required(options, 'conversation'), projectId: required(options, 'project'), expectedGeneration: scopeGeneration! });
                break;
            case 'conversation archive':
                result = await controller.archiveConversation({ conversationId: required(options, 'conversation'), expectedGeneration: lifecycleGeneration! });
                break;
            case 'conversation restore':
                result = await controller.restoreConversation({ conversationId: required(options, 'conversation'), expectedGeneration: lifecycleGeneration! });
                break;
            case 'conversation reclaim':
                result = await controller.reclaimConversationResource({ conversationId: required(options, 'conversation'), expectedGeneration: lifecycleGeneration! });
                break;
            case 'conversation delete':
                result = await controller.deleteConversation({ conversationId: required(options, 'conversation'), expectedGeneration: lifecycleGeneration! });
                break;
            case 'conversation ui': {
                const { selectControllerModel } = await import('./selected-model.js');
                const { ApplicationModels } = await import('../app/models.js');
                const models = new ApplicationModels(controller);
                models.install({ resumeAuthorized: false });
                const model = options.has('model-profile') ? await selectControllerModel(required(options, 'model-profile'), controller) : undefined;
                const retained = !options.has('conversation') && !options.has('project') && !model ? controller.inspectConversationEntry() : undefined;
                const conversationId = options.has('conversation')
                    ? controller.inspectConversation(required(options, 'conversation')).conversationId
                    : retained?.conversationId ?? (model ? controller.createConversation({ projectId: options.get('project') ?? null }) : await models.newConversation({ projectId: options.get('project') ?? null })).conversationId;
                const choice = controller.getConversationModelChoice(conversationId);
                if (model && (choice.kind === 'managed' || choice.kind === 'legacy-external' && (choice.provider !== model.provider || choice.modelId !== model.modelId)))
                    throw new UsageError('Existing conversation model differs from --model-profile; omit the profile to inspect or supply its matching external profile');
                const { startConversationUI } = await import('../ui/index.js');
                let resetRequest: {
                    scope: import('../app/reset.js').ResetScope;
                    locale: import('../ui/i18n.js').UiLocale;
                    disposition: import('../app/reset.js').ResetDisposition;
                } | undefined;
                await startConversationUI({ initialDirectory, operatorClaude, restartArguments, onReset: (scope, locale, disposition) => { resetRequest = { scope, locale, disposition }; }, controller, ...(model ? { model } : {}), models, conversationId, signal: abort.signal,
                    ...(options.has('command-key') ? { commandKey: options.get('command-key') as CommandKey } : {}),
                    ...(retained ? { entryNotice: 'Reopened retained conversation · no work resumed · /resume selects another' } : {}),
                    retention: { completedLimit: completedViewLimit, idleGraceMs: viewIdleGraceMs },
                });
                if (resetRequest) {
                    await controller.close();
                    await (await import('./reset.js')).interactiveReset(installationHome, resetRequest.scope, resetRequest.locale, resetRequest.disposition);
                }
                return 0;
            }
            case 'change activate':
                result = controller.activateChangeOwner({ workId: required(options, 'work'), expectedEpoch: epoch!, ...(options.has('resume-cancelled') ? { resumeCancelled: options.get('resume-cancelled') === 'true' } : {}) });
                break;
            case 'change list':
                result = controller.listChanges({ ...(options.has('project') ? { projectId: required(options, 'project') } : {}), ...(changeListLimit === undefined ? {} : { limit: changeListLimit }), ...(options.has('before') ? { before: required(options, 'before') } : {}) });
                break;
            case 'change inspect':
                result = await controller.inspectChange(required(options, 'work'));
                break;
            case 'change refresh-criteria':
                result = await controller.refreshChangeCriteria({ workId: required(options, 'work'), reason: required(options, 'reason'), ...epoch !== undefined ? { expectedEpoch: epoch } : {} });
                break;
            case 'change extend-resolution':
                result = await controller.extendResolutionAllowance({ workId: required(options, 'work'), additional: additional!, reason: required(options, 'reason') });
                break;
            case 'change prepare': {
                const baseline = options.get('model-source') === 'application' ? await newApplicationBaseline(required(options, 'project')) : undefined;
                result = { ...await controller.beginChange({ projectId: required(options, 'project'), request: required(options, 'message'), signal: abort.signal,
                        ...(baseline ? { applicationModelBaseline: baseline } : {}),
                        ...(resolutionLimit === undefined ? {} : { resolutionLimit }), ...(executionLimit === undefined ? {} : { executionLimit }),
                    }), modelSource: baseline ? 'application' : 'explicit-profile-required' };
                break;
            }
            case 'change replan': {
                result = await controller.planChange({ ...await retainedChangeOperation(required(options, 'work')), signal: abort.signal });
                break;
            }
            case 'change start':
            case 'change run':
            case 'change resume': {
                let operation: import('../controller/change-types.js').ChangeOperation;
                if (command === 'change start') {
                    const baseline = options.has('model-profile') ? undefined : await newApplicationBaseline(required(options, 'project'));
                    // Preserve explicit profile admission before creating work on that legacy route.
                    const { selectControllerModel } = await import('./selected-model.js');
                    const model = options.has('model-profile') ? await selectControllerModel(required(options, 'model-profile'), controller) : undefined;
                    const work = await controller.beginChange({ projectId: required(options, 'project'), request: required(options, 'message'), signal: abort.signal,
                        ...(baseline ? { applicationModelBaseline: baseline } : {}),
                        ...(resolutionLimit === undefined ? {} : { resolutionLimit }), ...(executionLimit === undefined ? {} : { executionLimit }),
                    });
                    operation = model ? { workId: work.workId, model } : (await appModels()).workOperation(work.workId);
                }
                else
                    operation = await retainedChangeOperation(required(options, 'work'));
                result = await controller.driveChange({ ...operation, signal: abort.signal, ...(maximumSteps === undefined ? {} : { maximumSteps }) });
                break;
            }
            case 'project register':
                result = await controller.registerProject({ id: required(options, 'id'), sourceRoot: required(options, 'root') });
                break;
            case 'project list':
                result = await controller.listProjects();
                break;
            case 'work inspect':
                result = await controller.inspectWork(required(options, 'work'));
                break;
            case 'work extend':
                result = await controller.extendExecutionAllowance({ workId: required(options, 'work'), additional: additional!, reason: required(options, 'reason') });
                break;
            case 'work cancel':
                result = await controller.cancelWork({ workId: required(options, 'work'), ...(epoch === undefined ? {} : { expectedEpoch: epoch }) });
                break;
            case 'local protection':
            case 'local protect': {
                const projectId = required(options, 'project');
                if (!controller.listProjects().some(project => project.id === projectId))
                    throw new ControllerError('MISSING_PROJECT', 'Unknown registered project', 'Register the explicit project ID before configuring protection');
                if (command === 'local protection')
                    result = controller.inspectProjectProtection(projectId);
                else {
                    const { readProtectionProfile } = await import('./protection-profile.js');
                    result = await controller.setProjectProtection({ projectId, expectedRevision: protectionRevision!, ...await readProtectionProfile(required(options, 'policy-profile'), controller.listProjects().map(project => project.sourceRoot)) });
                }
                break;
            }
            case 'local inspect': {
                const project = controller.listProjects().find(value => value.id === required(options, 'project'));
                if (!project)
                    throw new ControllerError('MISSING_PROJECT', 'Unknown registered project', 'Register the explicit project ID before inspecting its rules');
                const { inspectLocalConfiguration } = await import('../controller/local-inspection.js');
                result = await inspectLocalConfiguration({ project, protection: controller.inspectProjectProtection(project.id), ...(profile ? { runtimeProfile: profile } : {}) });
                break;
            }
            case 'local git': {
                const projects = controller.listProjects(), project = projects.find(value => value.id === required(options, 'project'));
                if (!project)
                    throw new ControllerError('MISSING_PROJECT', 'Unknown registered project', 'Register the explicit project ID before inspecting its Git changes');
                const { inspectLocalGit } = await import('../controller/local-git.js');
                result = await inspectLocalGit({ project, projectRoots: projects.map(p => p.sourceRoot), installationHome, gitBinary: required(options, 'git-binary'), signal: abort.signal });
                break;
            }
            case 'local conventions':
            case 'local configure':
            case 'local prepare': {
                const { ApplicationLocalConventions } = await import('../app/local-conventions.js'), conventions = new ApplicationLocalConventions(controller), projectId = required(options, 'project');
                if (command === 'local conventions')
                    result = conventions.inspect(projectId);
                else if (command === 'local configure') {
                    const { readOwnerJson } = await import('../app/owner-json.js');
                    const value = await readOwnerJson(required(options, 'profile'), controller.listProjects().map(p => p.sourceRoot), 'Local convention profile', 32 * 1024);
                    result = conventions.set(projectId, localRevision!, value);
                }
                else {
                    const { prepareLocalChange } = await import('../controller/local-preparation.js');
                    result = await prepareLocalChange({ conventions, projectId, messageFile: required(options, 'message-file'), gitBinary: required(options, 'git-binary'), projectRoots: controller.listProjects().map(p => p.sourceRoot), installationHome, signal: abort.signal });
                }
                break;
            }
            case 'local candidates': {
                const { listLocalCandidates } = await import('../controller/local-candidate.js');
                result = listLocalCandidates(controller, required(options, 'project'));
                break;
            }
            case 'local candidate':
                result = await controller.localCommitCandidate({ projectId: required(options, 'project'), workId: required(options, 'work'), gitBinary: required(options, 'git-binary'), messageFile: required(options, 'message-file'), signal: abort.signal });
                break;
            case 'local audit':
                result = await controller.auditLocalCommit({ projectId: required(options, 'project'), candidateId: required(options, 'candidate'), commitRef: required(options, 'commit'), gitBinary: required(options, 'git-binary'), signal: abort.signal });
                break;
            case 'local evidence':
                result = await controller.inspectLocalCheckEvidence({ projectId: required(options, 'project'), workId: required(options, 'work'), gitBinary: required(options, 'git-binary'), signal: abort.signal });
                break;
            case 'local check':
                result = await controller.runLocalCheck({
                    projectId: required(options, 'project'), command: required(options, 'command'), signal: abort.signal,
                    ...(cwd ? { cwd: cwd as 'work' | 'scratch' } : {}),
                    ...(options.has('checkpoint') ? { continuationCheckpoint: required(options, 'checkpoint') } : {}),
                });
                break;
            case 'conversation start': {
                const projectId = required(options, 'project');
                let operand: Pick<import('../controller/types.js').ConversationOptions, 'model' | 'applicationModel' | 'applicationModelBaseline' | 'sessionPreferences'>;
                if (options.has('checkpoint')) {
                    const { workId, signal, ...retained } = await retainedChangeOperation(required(options, 'checkpoint'));
                    operand = retained;
                }
                else if (options.has('model-profile')) {
                    const { selectControllerModel } = await import('./selected-model.js');
                    operand = { model: await selectControllerModel(required(options, 'model-profile'), controller) };
                }
                else
                    operand = { applicationModelBaseline: await newApplicationBaseline(projectId) };
                result = await controller.startConversation({ projectId, message: required(options, 'message'), ...operand, signal: abort.signal,
                    ...(options.has('checkpoint') ? { continuationCheckpoint: required(options, 'checkpoint') } : {}),
                } as import('../controller/types.js').ConversationOptions);
                break;
            }
            case 'work resume': {
                const workId = required(options, 'work');
                const baseline = controller.getWorkApplicationModelBaseline(workId);
                if (baseline) {
                    const { workId: subject, signal, ...operand } = await retainedChangeOperation(workId);
                    result = await controller.resumeWork({ workId, signal: abort.signal, ...operand,
                        ...(options.has('command') ? { command: required(options, 'command') } : {}),
                        ...(options.has('message') ? { message: required(options, 'message') } : {}) });
                    break;
                }
                const { selectControllerModel } = await import('./selected-model.js');
                const model = options.has('model-profile') ? await selectControllerModel(required(options, 'model-profile'), controller) : undefined;
                result = await controller.resumeWork({ workId: required(options, 'work'), signal: abort.signal,
                    ...(options.has('command') ? { command: required(options, 'command') } : {}),
                    ...(options.has('message') ? { message: required(options, 'message') } : {}), ...(model ? { model } : {}),
                });
                break;
            }
            default: throw new UsageError('Unavailable command');
        }
        if (startupDiagnostic && command.startsWith('models ') && result && typeof result === 'object')
            result = { ...result, startupDiagnostic };
        console.log(JSON.stringify(result, null, 2));
        if (command === 'goal run' || command === 'goal resume')
            return (result as {
                state: string;
            }).state === 'COMPLETED' ? 0 : abort.signal.aborted ? 130 : 2;
        if (command === 'repo summary')
            return (result as {
                complete: boolean;
            }).complete ? 0 : 2;
        if (command === 'repo refresh')
            return (result as {
                state: string;
                view?: {
                    missing: readonly string[];
                };
            }[]).every(item => item.state === 'observed' && !item.view?.missing.length) ? 0 : 2;
        if (command === 'repo preview')
            return (result as RepositoryConfigurationView).phase === 'PREVIEWED' && !(result as RepositoryConfigurationView).blocked.length ? 0 : 2;
        if (command === 'repo apply' || command === 'repo reconcile')
            return (result as RepositoryConfigurationView).phase === 'CONFIRMED' && !(result as RepositoryConfigurationView).blocked.length ? 0 : 2;
        if (command === 'repo audit')
            return (result as RepositoryConfigurationAudit).complete ? 0 : 2;
        if (command === 'repo inspect')
            return repositoryProvider === 'github' || (result as {
                status: string;
            }).status === 'OBSERVED' ? 0 : 1;
        if (command.startsWith('repo '))
            return 0;
        if (command === 'publication prepare' || command === 'publication prepare-contribution-summary')
            return (result as PublicationView).phase === 'RESERVED' && !(result as PublicationView).blocked.length ? 0 : 2;
        if (command === 'publication dispatch' || command === 'publication reconcile')
            return (result as PublicationView).phase === 'CONFIRMED' && !(result as PublicationView).blocked.length ? 0 : 2;
        if (command.startsWith('publication '))
            return 0;
        if (['change start', 'change run', 'change resume'].includes(command))
            return (result as ChangeView).reviewReady ? 0 : 2;
        if (command === 'change prepare')
            return (result as ChangeView).phase === 'BASE_CAPTURED' ? 0 : 2;
        if (command === 'change replan')
            return (result as ChangeView).phase === 'PLAN_READY' && !(result as ChangeView).blocked.length ? 0 : 2;
        if (command === 'change refresh-criteria')
            return (result as ChangeView).phase === 'BASE_CAPTURED' && !(result as ChangeView).blocked.length ? 0 : 2;
        if (command === 'effect prepare-integration')
            return (result as EffectView).phase === 'RESERVED' && !(result as EffectView).blocked.length ? 0 : 2;
        if (command === 'effect dispatch' || command === 'effect reconcile')
            return (result as EffectView).phase === 'CONFIRMED' && !(result as EffectView).blocked.length ? 0 : 2;
        if (command === 'local prepare') {
            const status = (result as {
                status: string;
            }).status;
            return status === 'PASS' ? 0 : status === 'FAIL' ? 1 : 2;
        }
        if (command === 'local audit')
            return (result as {
                status: string;
            }).status === 'MATCH' ? 0 : 1;
        if (command === 'local evidence')
            return (result as {
                status: string;
            }).status === 'CURRENT' ? 0 : 1;
        return result && typeof result === 'object' && 'kind' in result ? observationExit(result as ObservationResult) : 0;
    }
    finally {
        try {
            await controller.close();
        }
        finally {
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
        }
    }
}
try {
    process.exitCode = await main(process.argv.slice(2));
}
catch (error) {
    const failure = error as Error & {
        code?: string;
        recovery?: string;
        workId?: string;
        runId?: string;
    };
    console.error(JSON.stringify({ error: failure.code ?? (error instanceof UsageError ? 'USAGE' : 'UNAVAILABLE'),
        message: failure.message, ...(failure.recovery ? { recovery: failure.recovery } : {}),
        ...(failure.workId ? { workId: failure.workId } : {}), ...(failure.runId ? { runId: failure.runId } : {}),
    }));
    process.exitCode = 2;
}
