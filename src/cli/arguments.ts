import { isCommandKey } from '../ui/command-key.js';
export class UsageError extends Error {
}
export interface Invocation {
    command: string;
    options: ReadonlyMap<string, string>;
}
const routes: Record<string, readonly string[]> = {
    reset: ['home', 'scope', 'disposition'],
    'reset preview': ['home', 'scope', 'disposition'],
    'reset apply': ['home', 'scope', 'confirm', 'disposition'],
    'reset recover': ['home'],
    'reset backups': ['home'],
    'reset backup-delete': ['home', 'backup', 'confirm'],
    'reset backup-recover': ['home'],
    'goal create': ['home', 'conversation', 'objective', 'criteria', 'turn-limit'],
    'goal inspect': ['home', 'goal'],
    'goal list': ['home'],
    'goal pause': ['home', 'goal', 'revision', 'reason'],
    'goal cancel': ['home', 'goal', 'revision', 'reason'],
    'goal revise': ['home', 'goal', 'revision', 'objective', 'criteria', 'reason'],
    'goal extend': ['home', 'goal', 'revision', 'units', 'reason'],
    'goal run': ['home', 'goal', 'revision', 'input', 'model-profile', 'delegate-projects', 'max-assignments', 'delegate-integrations', 'git-binary', 'git-timeout-ms', 'git-output-bytes', 'docker-binary', 'docker-context', 'image'],
    'goal resume': ['home', 'goal', 'revision', 'input', 'model-profile', 'delegate-projects', 'max-assignments', 'delegate-integrations', 'git-binary', 'git-timeout-ms', 'git-output-bytes', 'docker-binary', 'docker-context', 'image'],
    'setup inspect': ['home'],
    'setup save': ['home', 'file'],
    'setup clear': ['home'],
    'auth status': ['home'],
    'auth login': ['home', 'provider', 'method'],
    'auth logout': ['home', 'provider'],
    'models list': ['home', 'search'],
    'models default': ['home', 'provider', 'model'],
    'models scope': ['home', 'patterns'],
    'models configure': ['home', 'file'],
    'models roles': ['home'],
    'models role-set': ['home', 'role', 'provider', 'model', 'thinking'],
    'models role-reset': ['home', 'role'],
    'settings inspect': ['home', 'project'],
    'settings set': ['home', 'key', 'value'],
    'settings approve-project': ['home', 'project'],
    doctor: ['docker-context'],
    'repo recommend': ['branch', 'provider', 'mode'],
    'repo track': ['home', 'repository-profile', 'kind', 'number', 'credential-profile'],
    'repo parent': ['home', 'resource', 'parent', 'revision', 'credential-profile'],
    'repo refresh': ['home', 'resources', 'credential-profile'],
    'repo resources': ['home'],
    'repo contributions': ['home', 'resource'],
    'repo summary': ['home', 'resource', 'revision'],
    'project register': ['home', 'id', 'root'],
    'project list': ['home'],
    'repo register-target': ['home', 'target-profile', 'provider', 'api-base', 'owner', 'repo', 'credential-profile'],
    'repo targets': ['home', 'limit', 'before'],
    'repo plans': ['home', 'limit', 'before', 'target'],
    'repo preview': ['home', 'target', 'profile', 'credential-profile', 'continuation-plan', 'owned-creation-operation'],
    'repo apply': ['home', 'plan', 'credential-profile'],
    'repo reconcile': ['home', 'plan', 'credential-profile'],
    'repo audit': ['home', 'plan', 'credential-profile'],
    'repo guide': ['home', 'target', 'branch', 'credential-profile'],
    'repo plan': ['home', 'plan'],
    'repo inspect': ['home', 'owner', 'repo', 'branch', 'credential-profile', 'provider', 'api-base'],
    'work inspect': ['home', 'work'],
    'work cancel': ['home', 'work', 'epoch'],
    'work extend': ['home', 'work', 'units', 'reason'],
    'work resume': ['home', 'work', 'command', 'message', 'model-profile', 'docker-binary', 'docker-context', 'image'],
    'local check': ['home', 'project', 'command', 'cwd', 'checkpoint', 'docker-binary', 'docker-context', 'image'],
    'local protection': ['home', 'project'],
    'local protect': ['home', 'project', 'revision', 'policy-profile'],
    'local inspect': ['home', 'project', 'docker-binary', 'docker-context', 'image'],
    'local git': ['home', 'project', 'git-binary'],
    'local recommend': [],
    'local conventions': ['home', 'project'],
    'local configure': ['home', 'project', 'revision', 'profile'],
    'local prepare': ['home', 'project', 'git-binary', 'message-file'],
    'local evidence': ['home', 'project', 'work', 'git-binary'],
    'local candidates': ['home', 'project'],
    'local candidate': ['home', 'project', 'work', 'git-binary', 'message-file'],
    'local audit': ['home', 'project', 'candidate', 'commit', 'git-binary'],
    'conversation start': ['home', 'project', 'message', 'model-profile', 'checkpoint', 'docker-binary', 'docker-context', 'image'],
    'conversation ui': ['home', 'project', 'conversation', 'model-profile', 'command-key', 'delegate-projects', 'max-assignments', 'completed-view-limit', 'view-idle-grace-ms', 'completed-resource-mode', 'completed-resource-idle-ms', 'completed-resource-limit', 'delegate-integrations', 'delegate-publications', 'credential-profile', 'git-binary', 'git-timeout-ms', 'git-output-bytes', 'docker-binary', 'docker-context', 'image'],
    'conversation create': ['home', 'project'],
    'conversation list': ['home'],
    'conversation inspect': ['home', 'conversation'],
    'conversation parent': ['home', 'conversation', 'parent', 'revision'],
    'conversation project': ['home', 'conversation', 'project', 'generation'],
    'conversation archive': ['home', 'conversation', 'generation'],
    'conversation restore': ['home', 'conversation', 'generation'],
    'conversation reclaim': ['home', 'conversation', 'generation'],
    'conversation delete': ['home', 'conversation', 'generation'],
    'change prepare': ['home', 'project', 'message', 'resolution-limit', 'execution-limit', 'model-source', 'provider', 'model', 'thinking', 'docker-binary', 'docker-context', 'image'],
    'change start': ['home', 'project', 'message', 'resolution-limit', 'execution-limit', 'model-profile', 'provider', 'model', 'thinking', 'maximum-steps', 'docker-binary', 'docker-context', 'image'],
    'change run': ['home', 'work', 'model-profile', 'maximum-steps', 'docker-binary', 'docker-context', 'image'],
    'change resume': ['home', 'work', 'model-profile', 'maximum-steps', 'docker-binary', 'docker-context', 'image'],
    'change replan': ['home', 'work', 'model-profile', 'docker-binary', 'docker-context', 'image'],
    'change inspect': ['home', 'work'],
    'change activate': ['home', 'work', 'epoch', 'resume-cancelled', 'delegate-integrations', 'delegate-publications', 'git-binary', 'git-timeout-ms', 'git-output-bytes'],
    'change list': ['home', 'project', 'limit', 'before'],
    'change refresh-criteria': ['home', 'work', 'reason', 'epoch'],
    'change extend-resolution': ['home', 'work', 'units', 'reason'],
    'effect register-target': ['home', 'target-profile', 'credential-profile', 'git-binary', 'git-timeout-ms', 'git-output-bytes'],
    'effect delegate-integration': ['home', 'work', 'target', 'operation-limit', 'scope', 'mode'],
    'effect prepare-integration': ['home', 'work', 'target', 'operation', 'model-profile', 'credential-profile', 'git-binary', 'git-timeout-ms', 'git-output-bytes', 'docker-binary', 'docker-context', 'image'],
    'effect dispatch': ['home', 'operation', 'credential-profile', 'git-binary', 'git-timeout-ms', 'git-output-bytes'],
    'effect reconcile': ['home', 'operation', 'credential-profile', 'git-binary', 'git-timeout-ms', 'git-output-bytes'],
    'effect inspect': ['home', 'operation'],
    'merge register-target': ['home', 'resource', 'source-target', 'base', 'credential-profile'],
    'merge list': ['home', 'limit', 'before'],
    'merge inspect': ['home', 'operation'],
    'merge targets': ['home', 'limit', 'before'],
    'merge target-inspect': ['home', 'target'],
    'effect list': ['home', 'limit', 'before'],
    'effect targets': ['home', 'limit', 'before'],
    'effect target-inspect': ['home', 'target'],
    'publication register-target': ['home', 'target-profile'],
    'publication delegate': ['home', 'work', 'target', 'grant-profile', 'operation-limit', 'scope'],
    'publication prepare': ['home', 'target', 'payload-file', 'work', 'operation', 'credential-profile'],
    'publication prepare-contribution-summary': ['home', 'resource', 'revision-id', 'target', 'operation', 'credential-profile'],
    'publication dispatch': ['home', 'operation', 'credential-profile'],
    'publication reconcile': ['home', 'operation', 'credential-profile'],
    'publication inspect': ['home', 'operation'],
    'publication list': ['home', 'limit', 'before'],
};
for (const [command, fields] of Object.entries(routes))
    if (fields.includes('docker-binary'))
        routes[command] = [...fields, 'docker-config-directory'];
export function parseInvocation(args: readonly string[]): Invocation {
    const words = [...args];
    const first = words.shift();
    const command = first === 'doctor' || first === 'reset' && (!words.length || words[0]!.startsWith('--')) ? first : `${first ?? ''} ${words.shift() ?? ''}`;
    const allowed = routes[command];
    if (!allowed)
        throw new UsageError('Unknown command; use --help for supported entries.');
    const options = new Map<string, string>();
    while (words.length) {
        const flag = words.shift()!;
        if (!flag.startsWith('--') || !allowed.includes(flag.slice(2)))
            throw new UsageError(`Unsupported option: ${flag}`);
        const key = flag.slice(2);
        if (options.has(key))
            throw new UsageError(`Repeated option: ${flag}`);
        const value = words.shift();
        if (value === undefined || value.startsWith('--') || !value.trim())
            throw new UsageError(`Missing value: ${flag}`);
        options.set(key, value);
    }
    const commandKey = options.get('command-key');
    if (commandKey !== undefined && !isCommandKey(commandKey))
        throw new UsageError('--command-key must be ctrl+g, ctrl+q or ctrl+p in this fixed profile');
    return { command, options };
}
export function required(options: ReadonlyMap<string, string>, key: string): string {
    const value = options.get(key);
    if (value === undefined)
        throw new UsageError(`Required option: --${key}`);
    return value;
}
export function nonnegativeInteger(value: string, key: string): number {
    if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new UsageError(`--${key} must be a nonnegative safe integer`);
    return Number(value);
}
export const usage = `Usage: gitjig COMMAND [options]
  --help | --version
  reset [--home PATH] [--scope settings|all] [--disposition backup|delete]
  reset preview [--home PATH] --scope settings|all [--disposition backup|delete]
  reset apply [--home PATH] --scope settings|all [--disposition backup|delete] --confirm PREVIEW_FINGERPRINT
  reset recover [--home PATH]
  reset backups [--home PATH]
  reset backup-delete [--home PATH] --backup BACKUP_ID --confirm BACKUP_FINGERPRINT
  reset backup-recover [--home PATH]
    Choose a private backup or permanent deletion before interactive reset review.
    Noninteractive preview/apply default to backup; delete is irreversible and is not secure erasure.
    Backups are listed without scanning nested contents; deletion needs the listed fingerprint.
    Backup recovery finishes an already confirmed interrupted backup deletion.
    Reset preserves external projects, installation and previous reset backups.
    Close all sessions first. Recovery finishes an explicitly confirmed interrupted reset.
  goal create [--home PATH] --conversation ID --objective TEXT --criteria JSON_ARRAY [--turn-limit N]
  goal list [--home PATH]
  goal inspect [--home PATH] --goal ID
  goal run|resume [--home PATH] --goal ID --revision N [--input ID] [--model-profile FILE] [--delegate-projects IDS --max-assignments N] [--delegate-integrations PROJECT:TARGET:LIMIT,... GIT] [RUNTIME]
  goal pause|cancel [--home PATH] --goal ID --revision N --reason TEXT
  goal revise [--home PATH] --goal ID --revision N --objective TEXT --criteria JSON_ARRAY --reason TEXT
  goal extend [--home PATH] --goal ID --revision N --units N --reason TEXT
    Goal turns count admitted author and independent review turns, not provider requests/child spend.
    Goal coordination grants no task or platform authority. Cancel retains delegated work.
    Start/resume is explicit; inspect/open never starts hidden work. UI: /goal.
  setup inspect [--home PATH]
  setup save [--home PATH] --file ABSOLUTE_PRIVATE_JSON_FILE
  setup clear [--home PATH]
    Saves future application startup only; close normally and relaunch to apply.
    Version1 JSON accepts runtime and bridge. Account/configuration repair does not recover work.
    Runtime options override the whole saved runtime; --docker-config-directory selects its config route.
  settings inspect [--home PATH] [--project ID]
  settings set [--home PATH] --key NAME --value JSON
  settings approve-project [--home PATH] --project ID
    Stores gitjig preferences independently of Pi. Source home: --home, GITJIG_HOME, then ~/.gitjig.
    Installed entry keeps its bound home. Preferences apply on the next relevant UI/session load.
  auth status [--home PATH]
  auth login [--home PATH] --provider ID --method api_key|oauth
  auth logout [--home PATH] --provider ID
    Uses gitjig accounts only. Login requires a terminal and masks secret input.
    Claude Code subscription identity remains managed by the separate Claude Code route.
  models list [--home PATH] [--search TEXT]
  models default [--home PATH] --provider ID --model ID
  models scope [--home PATH] --patterns JSON_ARRAY
  models configure [--home PATH] --file ABSOLUTE_PRIVATE_JSON_FILE
  models roles [--home PATH]
  models role-set [--home PATH] --role ROLE --provider ID --model ID [--thinking LEVEL]
  models role-reset [--home PATH] --role ROLE
    Roles: planner, challenger, adjudicator, implementer, reviewer, repairer, confirmer.
    An unset role inherits its work's captured model baseline.
    Catalogue and stored status are not a credential/entitlement check.
    Model configuration replaces the application file after Pi validation; no helpers or ambient references.
  doctor [--docker-context NAME]
  project register --home PATH --id ID --root PATH
  project list --home PATH
  local git [--home PATH] --project ID --git-binary ABSOLUTE_TRUSTED_GIT
    Read staged/unstaged/untracked paths and up to ten recent commits without model or engine.
    Requires stable repository configuration; native Git is not an execution sandbox.
    Preflight refuses observed filters/partial clones; concurrent replacement can run helpers before drift refusal.
    Nested project roots and non-UTF-8 output are refused.
    No staging, commit, push, remote refresh or agent completion is performed.
  local recommend
    Prints optional local convention recommendations; does not configure a project.
  local conventions [--home PATH] --project ID
  local configure [--home PATH] --project ID --revision N --profile ABSOLUTE_PRIVATE_JSON
  local prepare [--home PATH] --project ID --git-binary ABSOLUTE_TRUSTED_GIT --message-file ABSOLUTE_TEXT
    Rules cover branch literals, commit types, subject length and body. Profiles are developer-local preferences.
    Preparation checks staged/conflicting paths and message, never executes tests, commits or hooks.
    Native Git requires stable configuration; this is not an agent execution sandbox or hosting-rule override.
  local candidates [--home PATH] --project ID
  local candidate [--home PATH] --project ID --work W --git-binary ABSOLUTE_TRUSTED_GIT --message-file ABSOLUTE_TEXT
  local audit [--home PATH] --project ID --candidate UUID --commit REF --git-binary ABSOLUTE_TRUSTED_GIT
  local evidence [--home PATH] --project ID --work W --git-binary ABSOLUTE_TRUSTED_GIT
    Compares original settled /work command evidence with a fresh full capture and every staged blob/mode.
    Includes Git metadata and ignored files. Scratch checks and unsupported index entries are unavailable.
    CURRENT means correspondence only, not adequate tests, review, commit approval or a locked candidate.
  repo recommend --branch NAME [--provider github|gitea|gitlab] [--mode update|create]
    Prints an editable profile; save with owner-only permissions, customize, then preview.
    GitHub: one PR approval, stale/last-push/thread checks, no force-push/deletion/bypass.
    Gitea/GitLab: explicit native update (default) or create recommendations.
    Select CI names, code-owner requirements and merge settings for your repository.
  repo register-target --home PATH (--target-profile FILE | --provider github|gitea|gitlab --owner OWNER --repo NAME --credential-profile FILE [--api-base URL])
  repo targets --home PATH [--limit 1..100] [--before TARGET_ID]
  repo plans --home PATH [--target TARGET_ID] [--limit 1..100] [--before PLAN_ID]
  repo track --home PATH --repository-profile FILE --kind issue|pull-request --number N --credential-profile FILE
  repo parent --home PATH --resource R --revision N [--parent R] --credential-profile FILE
  repo refresh --home PATH [--resources R1,R2,R3,R4] --credential-profile FILE
  repo resources [--home PATH]
  repo contributions --home PATH --resource R
  repo summary --home PATH --resource R [--revision N]
    Tracked native observations and immutable local summaries; no agent ceremony or publication.
    Parent is explicit same-repository summary routing, not native issue hierarchy or authority.
  repo preview --home PATH --target T --profile FILE --credential-profile FILE [--continuation-plan O] [--owned-creation-operation O]
  repo apply|reconcile|audit --home PATH --plan O --credential-profile FILE
  repo guide --home PATH --target T --branch NAME --credential-profile FILE
  repo plan --home PATH --plan O
  repo inspect --home PATH --owner OWNER_OR_NAMESPACE --repo NAME [--branch NAME] --credential-profile FILE
    [--provider github|gitea|gitlab] [--api-base HTTPS_PROVIDER_API_BASE]
  work inspect --home PATH --work W
  work cancel --home PATH --work W [--epoch N]
  work extend --home PATH --work W --units N --reason TEXT
  local check --home PATH --project ID --command CMD [--cwd work|scratch] [--checkpoint W] RUNTIME
  local inspect --home PATH --project ID [RUNTIME]
  local protection --home PATH --project ID
  local protect --home PATH --project ID --revision N --policy-profile FILE
  conversation start --home PATH --project ID --message TEXT [--model-profile FILE] [--checkpoint W] RUNTIME
    New work uses the application default. A checkpoint keeps its retained model mode.
  conversation ui [--home PATH] [--model-profile FILE] [--project ID | --conversation ID] [--command-key ctrl+g|ctrl+q|ctrl+p] [--delegate-projects ID1,ID2] [--max-assignments N] [--completed-view-limit N] [--view-idle-grace-ms N] [--completed-resource-mode immediate|finite] [--completed-resource-idle-ms N] [--completed-resource-limit N] [RUNTIME]
    Opens without a model or engine. Use /model and /thinking for this conversation.
    Project execution still requires RUNTIME; opening the UI grants no execution permission.
  conversation create --home PATH [--project ID]
  conversation list --home PATH
  conversation inspect --home PATH --conversation ID
  conversation archive|restore|reclaim|delete --home PATH --conversation ID --generation N
  conversation parent --home PATH --conversation ID --revision N [--parent ID]
  conversation project --home PATH --conversation ID --project ID --generation N
  work resume --home PATH --work W [--command CMD | --message TEXT] [--model-profile FILE] RUNTIME
    Application investigation keeps its baseline. Legacy investigation requires --model-profile.
  change prepare --home PATH --project ID --message TEXT [--model-source application] [--provider ID --model ID [--thinking LEVEL]] [--resolution-limit N] [--execution-limit N] [RUNTIME]
    Plain prepare captures without a model and later requires an explicit profile.
  change start --home PATH --project ID --message TEXT [--provider ID --model ID [--thinking LEVEL] | --model-profile FILE] [--resolution-limit N] [--execution-limit N] [--maximum-steps N] RUNTIME
    Without a profile, start captures an application model baseline before work creation.
  change run|resume --home PATH --work W [--model-profile FILE] [--maximum-steps N] RUNTIME
    Application work keeps its saved baseline; legacy work requires its explicit profile.
  change replan --home PATH --work W [--model-profile FILE] RUNTIME
    Explicit planning attempt for active work; retains failed checks and requires independent amendments.
  change list --home PATH [--project ID] [--limit 1..100] [--before WORK_ID]
  change activate --home PATH --work W --epoch N [--resume-cancelled true] [--delegate-integrations PROJECT:TARGET:LIMIT,... GIT] [--delegate-publications FILE]
    Retry captured owner delegation activation; does not dispatch work or reset allowance.
  change inspect --home PATH --work W
  change refresh-criteria --home PATH --work W --reason TEXT [--epoch N]
    Explicit owned criteria re-entry; keeps old evidence and requires new planning/checks/review.
  change extend-resolution --home PATH --work W --units N --reason TEXT
  effect register-target --home PATH --target-profile FILE [--credential-profile FILE] GIT
  effect delegate-integration --home PATH --work W --target T --operation-limit N [--scope work|delegation-lineage] [--mode ordinary|owner-override]
  effect prepare-integration --home PATH --work W --target T [--operation O] [--model-profile FILE] [--credential-profile FILE] GIT RUNTIME
    Application work uses its retained model baseline. Legacy work requires --model-profile.
  effect dispatch --home PATH --operation O [--credential-profile FILE] GIT
  effect reconcile --home PATH --operation O [--credential-profile FILE] GIT
  merge register-target --home PATH --resource RESOURCE --source-target TARGET --base BRANCH --credential-profile FILE
  merge list --home PATH [--limit 1..100] [--before O]
  merge inspect --home PATH --operation O
  merge targets --home PATH [--limit 1..100] [--before TARGET_ID]
  merge target-inspect --home PATH --target TARGET_ID
  effect list --home PATH [--limit 1..100] [--before O]
  effect targets --home PATH [--limit 1..100] [--before TARGET_ID]
  effect target-inspect --home PATH --target TARGET_ID
  effect inspect --home PATH --operation O
  publication register-target --home PATH --target-profile FILE
  publication delegate --home PATH --work W --target T --grant-profile FILE --operation-limit N [--scope work|delegation-lineage]
  publication prepare --home PATH --target T --payload-file FILE [--work W] [--operation O] [--credential-profile FILE]
  publication prepare-contribution-summary --home PATH --resource R --revision-id S --target T [--operation O] [--credential-profile FILE]
    Uses only the host's complete immutable contribution revision; no caller body or procedure claim.
  publication dispatch|reconcile --home PATH --operation O --credential-profile FILE
  publication inspect --home PATH --operation O
  publication list --home PATH [--limit 1..100] [--before O]
RUNTIME: --docker-binary ABSOLUTE_PATH --docker-context NAME --image IMMUTABLE_ID_OR_DIGEST
GIT: --git-binary ABSOLUTE_PATH [--git-timeout-ms N] [--git-output-bytes N]
Hosted target profiles use kind "github-existing-ref", PUBLIC repository identity and explicit path scope; hosted operations need --credential-profile FILE.
owner-override is hosted-only and requires explicit owner delegation plus current native authority for every applicable rule set.
conversation ui: --delegate-integrations PROJECT:TARGET:LIMIT,... grants finite ordinary integration at original owner-work entry; requires GIT.
conversation ui: --credential-profile FILE also recaptures hosted credentials for retained work; it does not create a delegation.
conversation ui: --delegate-publications FILE captures finite target/action grants at original owner-work entry; --credential-profile FILE configures the captured host credential.
Omit --parent to detach a conversation. Conversation selection does not change work scope.
Local commands report exact observations. Agent changes require current planning, checks and independent resolution.
Preparing work is activation only; successful change driving means local review-ready.
Native integration requires explicit owner delegation, current evidence and observed target authority.
Hosted effects and full installed maturity remain unavailable until their acceptance gates pass.`;
