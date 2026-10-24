import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { conversationLanguagePolicy } from '../../dist/controller/conversation-language.js';
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { readinessCommands } from '../../dist/ui/readiness-commands.js';
import { parseSessionEntries } from '@earendil-works/pi-coding-agent';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { languageCommands } from '../../dist/ui/language-commands.js';
test('saved reply language owns each real request after tool loops, restart and context copies without a language clue in native input', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/language-state-'))), home = path.join(root, 'home'), oldTemp = process.env.TMPDIR;
    let c = await openController({ installationHome: home });
    process.env.TMPDIR = path.join(home, 'artifacts');
    try {
        const parent = c.createConversation(), sibling = c.createConversation(), cid = parent.conversationId;
        const set = tag => {
            const view = c.inspectConversation(cid), old = c.getConversationLanguage(cid);
            return c.setConversationLanguage({ conversationId: cid, expectedGeneration: view.generation, expectedRevision: old.revision, replyLanguage: tag });
        };
        set('ko');
        const clone = await c.forkConversation({ conversationId: cid, expectedGeneration: 0, expectedModelRevision: 0, kind: 'clone' });
        assert.equal(c.getConversationLanguage(clone.conversationId).replyLanguage, 'ko');
        assert.equal(c.getConversationLanguage(sibling.conversationId).replyLanguage, null);
        let calls = 0, compacting = false;
        const seen = [], usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        const model = {
            provider: 'language-state', modelId: 'fixture', definition: {
                apiKey: 'DUMMY', baseUrl: 'http://unused.invalid', api: 'language-state-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: usage.cost, contextWindow: 32000, maxTokens: 1000 }], streamSimple(selected, context) {
                    const stream = createAssistantMessageEventStream();
                    queueMicrotask(() => {
                        try {
                            const n = calls++, system = getCurrentSystemPrompt(context.messages);
                            seen.push(system);
                            if (compacting) {
                                assert.match(JSON.stringify(context.messages), /English is mandatory/);
                            }
                            else {
                                assert.ok(system.includes('"replyLanguage":"' + (n === 0 ? 'ko' : 'ja') + '"'));
                                assert.match(system, /English is mandatory/);
                                assert.ok(getCurrentTools(context.messages).some(tool => tool.name === 'conversation_status'));
                            }
                            if (n === 0)
                                set('ja');
                            const message = {
                                role: 'assistant', content: n === 0 ? [{ type: 'toolCall', id: 'status', name: 'conversation_status', arguments: {} }] : [{ type: 'text', text: 'Scripted fixture final' }], api: selected.api, provider: selected.provider, model: selected.id, usage, stopReason: n === 0 ? 'toolUse' : 'stop', timestamp: Date.now()
                            };
                            stream.push({ type: 'done', reason: message.stopReason, message });
                            stream.end(message);
                        }
                        catch (error) {
                            const message = {
                                role: 'assistant', content: [], api: selected.api, provider: selected.provider, model: selected.id, usage, stopReason: 'error', errorMessage: String(error), timestamp: Date.now()
                            };
                            stream.push({ type: 'error', reason: 'error', error: message });
                            stream.end(message);
                        }
                    });
                    return stream;
                }
            }
        };
        await c.queueConversationInput({ conversationId: cid, expectedGeneration: 0, text: 'Inspect status and return.', mode: 'idle' });
        const result = await c.runConversation({ conversationId: cid, model });
        assert.equal(result.status, 'delivered', JSON.stringify(result));
        assert.equal(calls, 2);
        assert.ok(!seen[1].includes('"replyLanguage":"ko"'));
        const history = c.inspectConversation(cid).historyRef;
        assert.ok(!(await fs.readFile(history, 'utf8')).includes('한국어'));
        assert.equal(c.getConversationLanguage(clone.conversationId).replyLanguage, 'ko');
        const entry = parseSessionEntries(await fs.readFile(history, 'utf8')).find(e => e.type === 'message' && e.message.role === 'user');
        assert.ok(entry);
        {
            const fork = await c.forkConversation({
                conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, expectedModelRevision: 0, kind: 'fork', entryId: entry.id
            });
            assert.equal(c.getConversationLanguage(fork.conversationId).replyLanguage, 'ja');
        }
        await c.close();
        c = await openController({ installationHome: home });
        assert.equal(c.getConversationLanguage(cid).replyLanguage, 'ja');
        await c.queueConversationInput({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, text: 'ok', mode: 'idle' });
        assert.equal((await c.runConversation({ conversationId: cid, model })).status, 'delivered');
        assert.equal(calls, 3);
        for (let n = 0; n < 4; n++) {
            await c.queueConversationInput({
                conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, text: 'English fixture history ' + n + ' ' + ('retained observation '.repeat(80)), mode: 'idle'
            });
            assert.equal((await c.runConversation({ conversationId: cid, model })).status, 'delivered');
        }
        const beforeCompact = c.getConversationLanguage(cid), off = c.subscribeInteraction(event => {
            if (event.type === 'native-ready' && event.conversationId === cid)
                c.getNativeHandle(cid).session.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 20, reserveTokens: 100 } });
        });
        compacting = true;
        const summary = await c.compactConversation({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, model });
        off();
        assert.equal(summary.status, 'delivered', JSON.stringify(summary));
        assert.deepEqual(c.getConversationLanguage(cid), beforeCompact);
        compacting = false;
        await c.queueConversationInput({ conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, text: 'Continue.', mode: 'idle' });
        assert.equal((await c.runConversation({ conversationId: cid, model })).status, 'delivered');
        assert.ok(parseSessionEntries(await fs.readFile(c.inspectConversation(cid).historyRef, 'utf8')).some(entry => entry.type === 'compaction'));
        const state = c.getConversationLanguage(cid);
        assert.throws(() => c.setConversationLanguage({
            conversationId: cid, expectedGeneration: c.inspectConversation(cid).generation, expectedRevision: state.revision - 1, replyLanguage: 'en'
        }), /changed/);
        assert.throws(() => set('bad language'), /language tag/);
    }
    finally {
        await c.close();
        if (oldTemp === undefined)
            delete process.env.TMPDIR;
        else
            process.env.TMPDIR = oldTemp;
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('automatic mode retains initial human language after acknowledgements and another pane; invalid state is repairable', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/language-command-'))), c = await openController({ installationHome: path.join(root, 'home') });
    try {
        const a = c.createConversation(), b = c.createConversation(), cid = a.conversationId;
        let current = true, input;
        const commands = new HostCommands(languageCommands({ controller: c, isCurrent: () => current, input: async () => input, notice() { } }));
        assert.equal(await commands.execute('/language', cid), 'cancelled');
        assert.equal(c.getConversationLanguage(cid).revision, 0);
        assert.equal(await commands.execute('/language pt-br', cid), 'completed');
        assert.equal(c.getConversationLanguage(cid).replyLanguage, 'pt-BR');
        const other = new HostCommands(languageCommands({
            controller: c, isCurrent: () => current, input: async () => {
                current = false;
                return 'en';
            }, notice() { }
        }));
        await assert.rejects(other.execute('/language', cid), /target changed/);
        assert.equal(c.getConversationLanguage(cid).replyLanguage, 'pt-BR');
        current = true;
        await commands.execute('/language auto', cid);
        for (const [id, text] of [[cid, '한국어로 상태를 알려줘.'], [cid, 'ok'], [b.conversationId, 'Bitte antworten Sie auf Deutsch.']])
            await c.queueConversationInput({ conversationId: id, expectedGeneration: 0, text, mode: 'idle' });
        c.store.run("UPDATE conversation_inputs SET state='CONSUMED'");
        const policy = conversationLanguagePolicy(c.store, cid, false, false);
        assert.match(policy, /한국어로 상태를 알려줘/);
        assert.ok(!policy.includes('Bitte antworten'));
        assert.match(policy, /"replyLanguage":"auto"/);
        c.store.run("UPDATE conversation_state SET data=json_set(data,'$.language',json(?)) WHERE conversation=?", JSON.stringify({ version: 1, revision: 4, replyLanguage: 'INVALID LANGUAGE' }), cid);
        assert.ok(c.getConversationLanguage(cid).diagnostic);
        const project = path.join(root, 'project');
        await fs.mkdir(project);
        await c.registerProject({ id: 'P', sourceRoot: project });
        c.setConversationProject({ conversationId: cid, expectedGeneration: 0, projectId: 'P' });
        let first;
        await new HostCommands(readinessCommands({
            controller: c, isCurrent: () => true, externalModel: { provider: 'fixture', modelId: 'fixture' }, choose: async (_title, rows) => {
                first = rows[0];
                return rows.at(-1);
            }, execute: async () => { assert.fail('Inspection cannot dispatch'); }
        })).execute('/ready', cid);
        assert.match(first, /Repair the saved reply language/);
        assert.throws(() => conversationLanguagePolicy(c.store, cid, false, false), /Invalid saved reply language/);
        assert.equal(await commands.execute('/language auto', cid), 'completed');
        assert.equal(c.getConversationLanguage(cid).diagnostic, undefined);
    }
    finally {
        await c.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
