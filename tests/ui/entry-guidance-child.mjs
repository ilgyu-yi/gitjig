import fs from 'node:fs/promises';
import { openController } from '../../dist/controller/index.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { startConversationUI } from '../../dist/ui/index.js';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
const cfg = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
let c = await openController({
    installationHome: cfg.home,
    ...(['managed-runtime', 'managed-account'].includes(cfg.mode) ? {
        runtimeProfile: { dockerBinary: '/usr/bin/false', dockerContext: 'fixture', image: 'sha256:' + '0'.repeat(64) }
    } : {})
});
if (['runtime', 'managed-runtime', 'managed-account'].includes(cfg.mode))
    await c.registerProject({ id: 'P', sourceRoot: cfg.source });
let conversation = ['account', 'literal', 'broken', 'managed-account'].includes(cfg.mode) ? undefined : c.createConversation(['runtime', 'managed-runtime', 'managed-account'].includes(cfg.mode) ? { projectId: 'P' } : {});
let calls = 0;
let models;
const model = {
    provider: 'entry-fixture',
    modelId: 'fixture',
    definition: {
        api: 'entry-fixture-api',
        apiKey: 'DUMMY',
        baseUrl: 'http://unused.invalid',
        models: [
            {
                id: 'fixture',
                name: 'fixture',
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 32000,
                maxTokens: 1000
            }
        ],
        streamSimple(m) {
            calls++;
            const stream = createAssistantMessageEventStream();
            const message = {
                role: 'assistant',
                content: [{ type: 'text', text: 'Ready to work with your request.' }],
                api: m.api,
                provider: m.provider,
                model: m.id,
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
                },
                stopReason: 'stop',
                timestamp: Date.now()
            };
            queueMicrotask(() => {
                stream.push({ type: 'done', reason: 'stop', message });
                stream.end(message);
            });
            return stream;
        }
    }
};
if (['account', 'literal', 'broken', 'managed-account'].includes(cfg.mode)) {
    models = new ApplicationModels(c);
    models.install({ resumeAuthorized: false });
    const accounts = ApplicationAccounts.open(c);
    if (cfg.mode === 'literal')
        await accounts.configure({
            providers: {
                'entry-literal': {
                    api: 'openai-completions',
                    apiKey: 'DUMMY_LITERAL_SECRET',
                    baseUrl: 'http://127.0.0.1:9/v1',
                    models: [{ id: 'fixture' }]
                }
            }
        });
    const selected = cfg.mode === 'literal' ? { provider: 'entry-literal', id: 'fixture' } : (await models.list()).models.find(model => model.provider === 'openai');
    conversation = await models.newConversation({
        ...(cfg.mode === 'managed-account' ? { projectId: 'P' } : {}),
        choice: await models.choice(selected.provider, selected.id)
    });
    if (cfg.mode === 'broken')
        await fs.writeFile(cfg.home + '/config/auth.json', '{PRIVATE_BROKEN_AUTH', { mode: 0o600 });
}
if (cfg.mode === 'managed-account') {
    const choice = c.getConversationModelChoice(conversation.conversationId);
    const baseline = {
        ...await models.baseline('P', choice),
        source: { kind: 'conversation', conversationId: conversation.conversationId, choiceRevision: choice.revision }
    };
    c.changes.drive = async (input) => c.changes.inspect(input.workId);
    await c.startConversationChange({
        conversationId: conversation.conversationId,
        expectedGeneration: 0,
        expectedModelRevision: choice.revision,
        projectId: 'P',
        request: 'Retain application account failure',
        applicationModelBaseline: baseline
    });
}
if (cfg.mode === 'managed-runtime') {
    c.changes.drive = async (input) => c.changes.inspect(input.workId);
    const work = await c.startConversationChange({
        conversationId: conversation.conversationId,
        expectedGeneration: 0,
        expectedModelRevision: 0,
        projectId: 'P',
        request: 'Owned retained task',
        model
    });
    await c.close();
    c = await openController({ installationHome: cfg.home });
    conversation = c.inspectConversation(conversation.conversationId);
    models = new ApplicationModels(c);
    try {
        c.resumeConversationChange({
            conversationId: conversation.conversationId,
            expectedGeneration: conversation.generation,
            expectedModelRevision: 0,
            workId: work.workId,
            expectedEpoch: work.epoch,
            model
        });
        throw Error('Missing runtime unexpectedly admitted');
    }
    catch (error) {
        if (!String(error).includes('Configure and apply the execution runtime through /ready'))
            throw error;
    }
}
const stopping = new AbortController();
const stop = () => stopping.abort();
process.once('SIGTERM', stop);
try {
    await startConversationUI({
        signal: stopping.signal,
        controller: c,
        conversationId: conversation.conversationId,
        ...(models ? { models } : {}),
        ...(['model', 'account', 'literal', 'broken', 'managed-account'].includes(cfg.mode) ? {} : { model })
    });
    await fs.writeFile(cfg.receipt, JSON.stringify({
        calls,
        works: c.store.one('SELECT COUNT(*) AS n FROM works').n,
        inputs: c.store.all('SELECT state,text FROM conversation_inputs'),
        draft: c.inspectConversation(conversation.conversationId).draft.text,
        ...(cfg.mode === 'account' ? { accountPresent: ApplicationAccounts.open(c).accountPresence('openai') } : {})
    }));
}
finally {
    process.removeListener('SIGTERM', stop);
    await c.close();
}
