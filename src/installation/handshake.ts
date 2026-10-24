import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { privateDirectory } from '../controller/ownership.js';
import type { Role, PlanProposal } from '../workflow/types.js';
import type { PiProjectOperations } from '../pi/operations.js';
/** Actual loaded SDK/role adapter exercise in an isolated namespace. It grants no live standing. */
export async function installedHandshake(namespace: string) {
    const payloadRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    await privateDirectory(namespace);
    for (const name of ['state', 'artifacts', 'work'])
        await privateDirectory(path.join(namespace, name));
    const artifactRoot = path.join(namespace, 'artifacts');
    if (await fs.realpath(process.env.TMPDIR ?? '') !== artifactRoot)
        throw Error('Handshake process must start with its exact owned health artifact TMPDIR');
    // Exercise the actual CLI's core dependency graph as well as the SDK adapter.
    // A manifest can faithfully describe an incomplete build; SDK-only health did
    // not detect a missing Ordinary/Controller dependency before live activation.
    const { openController } = await import('../controller/index.js'), metadataHome = path.join(namespace, 'controller-metadata');
    const controller = await openController({ installationHome: metadataHome });
    let metadata;
    try {
        const conversation = controller.createConversation(), listed = controller.listConversations(), observed = controller.inspectConversation(conversation.conversationId);
        if (!listed.some(row => row.conversationId === conversation.conversationId) || observed.projectId !== null || observed.workId !== null || observed.historyRef !== null)
            throw Error('Installed Controller metadata roundtrip differs');
        metadata = { module: await fs.realpath(new URL('../controller/index.js', import.meta.url)), home: metadataHome, conversationId: observed.conversationId, projectId: observed.projectId, workId: observed.workId, historyRef: observed.historyRef, operation: 'actual create/list/inspect and joined close; no project execution or live standing' };
    }
    finally {
        await controller.close();
    }
    const sdk = await import('@earendil-works/pi-coding-agent');
    const actualSdkRoot = await fs.realpath(sdk.getPackageDir()), expectedSdkRoot = await fs.realpath(path.join(payloadRoot, 'node_modules/@earendil-works/pi-coding-agent'));
    if (sdk.VERSION !== '1.3.0' || actualSdkRoot !== expectedSdkRoot)
        throw Error('Actual public SDK package identity differs from installed payload');
    const { initializePiHost } = await import('../pi/host.js'), { runRole } = await import('../workflow/adapter.js'), { loadCriteria } = await import('../controller/criteria.js'), { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai/compat');
    const host = await initializePiHost({ stateRoot: path.join(namespace, 'state'), artifactRoot }), criteria = await loadCriteria(), work = path.join(namespace, 'work');
    const operations: PiProjectOperations = { workspaceRoot: work, validatePath(p) { const full = path.resolve(work, p), rel = path.relative(work, full); if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('../'))
            throw Error('Health operation outside isolated namespace'); return full; }, async readFile() { throw Error('No health project input exposed'); }, async access() { throw Error('No health project input exposed'); }, async writeFile() { throw Error('Health scripted roles have no project writes'); }, async mkdir() { throw Error('Health scripted roles have no project writes'); }, async exec() { throw Error('Health scripted roles have no shell execution'); } };
    const requirement = { id: 'HEALTH', text: 'Exercise installed role serialization and native history; no work eligibility', source: 'fixed installed health fixture' };
    const plan: PlanProposal = { intent: requirement.text, requirements: [requirement], approach: 'Use installed public SDK and actual adapter', simplerAlternative: 'Retain metadata-only health separately', factualSources: ['actual installed package'], verification: { checks: [{ id: 'health-output', guaranteeIds: ['HEALTH'], command: 'not-executed-health-plan-data', assertions: ['serialized-output'], timeoutMs: 1000, fixturePaths: [], expectationPaths: [] }], requiredPaths: [], reviewRoles: [{ key: 'independent', kind: 'reviewer', purpose: 'Actual output protocol load', requiredPaths: [] }] }, ambiguities: [] };
    const receipts = [];
    for (const role of ['planner', 'challenger', 'adjudicator', 'implementer', 'reviewer', 'repairer', 'confirmer'] as Role[]) {
        const output = { version: 1, summary: 'Installed health fixture; no software correctness or action permission claim', findings: [], assessedScope: [], ...(role === 'planner' ? { plan } : {}), ...(role === 'challenger' ? { alternatives: ['Metadata alone cannot prove native role loading'] } : {}), ...(role === 'adjudicator' ? { decisions: [], planAccepted: true, acceptedPlan: plan } : {}), ...(role === 'reviewer' ? { outcome: 'clear' } : {}), ...(role === 'confirmer' ? { confirmed: true, witnesses: ['actual isolated native history'] } : {}) };
        const result = await runRole({ launchId: 'health-' + role + '-' + randomUUID(), role, inputBundle: { requirements: [requirement], contracts: criteria.text, context: { namespace: 'isolated-installed-health', liveStanding: false }, sources: [], requiredScope: [] }, operations, host, assertEntry() { }, beforeModelRequest: async (manager) => { if (!manager.getLeafId())
                throw Error('No actual native checkpoint'); await fs.access(manager.getSessionFile()!); }, timeoutMs: 10000, maxProviderRequests: 1, model: { provider: 'installed-health-' + role, modelId: 'fixture', definition: { baseUrl: 'http://unused.invalid', apiKey: 'fixed-health-not-a-credential', api: 'fixture-api', models: [{ id: 'fixture', name: 'Installed isolated fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2000 }], streamSimple(model) { const stream = createAssistantMessageEventStream(); queueMicrotask(() => { const message = { role: 'assistant' as const, content: [{ type: 'text' as const, text: JSON.stringify(output) }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop' as const, timestamp: Date.now() }; stream.push({ type: 'done', reason: 'stop', message }); stream.end(message); }); return stream; } } } });
        if (!result.usable || !result.historyRef || !result.nativeCheckpoint?.leafId || !result.selectedFinalEntryId)
            throw Error('Installed actual role failed ' + role + ': ' + result.issues.join(';'));
        const history = await fs.readFile(result.historyRef, 'utf8');
        if (!history.includes(result.selectedFinalEntryId))
            throw Error('Actual native selected final missing from retained history');
        receipts.push({ role, usable: true, nativeSessionId: result.nativeSessionId, history: result.historyRef, checkpoint: result.nativeCheckpoint, selectedFinalEntryId: result.selectedFinalEntryId, providerRequests: result.providerRequests });
    }
    if (new Set(receipts.map(r => r.nativeSessionId)).size !== receipts.length)
        throw Error('Health role histories not distinct');
    sdk.initTheme('dark', false);
    const component = new sdk.UserMessageComponent('Installed native UI asset check 한글', sdk.getMarkdownTheme());
    const rendered = component.render(60);
    if (!rendered.join('\n').includes('한글'))
        throw Error('Installed native component did not render');
    return { payloadRoot, node: process.execPath, version: process.version, controller: metadata, sdk: { version: sdk.VERSION, packageDir: actualSdkRoot }, criteria: { hash: criteria.hash, assets: criteria.assets }, roles: receipts, nativeUi: { component: 'public UserMessageComponent', rendered: true, humanTerminalIme: 'not-observed' }, liveStanding: false, providerTransport: 'trusted-scripted-health-provider-no-external-transport', namespace };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 3)
            throw Error('Explicit isolated health namespace required');
        console.log(JSON.stringify(await installedHandshake(process.argv[2]!)));
    }
    catch (e) {
        console.error(JSON.stringify({ error: 'INSTALLED_HANDSHAKE_UNAVAILABLE', message: (e as Error).message }));
        process.exitCode = 2;
    }
}
