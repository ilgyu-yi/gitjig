// Original assignment, native tools/history and result publication. Engine lifecycle replies and model prose are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openController } from '../../dist/controller/index.js';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { getCurrentSystemPrompt } from '@earendil-works/pi-ai';
import { parseSessionEntries } from '@earendil-works/pi-coding-agent';
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
let sharedRoot, successful = 0;
test.after(async () => {
    if (successful === 5 && sharedRoot)
        await fs.rm(sharedRoot, { recursive: true, force: true });
});
const human = '사용자에게만 보여줄 한국어 답변입니다.', english = 'The assigned observation is complete. This is the English coordinator report.';
async function journey(t, mode) {
    sharedRoot ??= await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/assigned-language-')));
    const root = sharedRoot, home = path.join(root, 'home'), source = path.join(root, 'project'), config = path.join(root, 'docker-config'), binary = path.join(root, 'docker.mjs'), engine = path.join(root, 'engine');
    for (const dir of [source, config, engine])
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(source, 'file.txt'), 'Fixed fixture input');
    await fs.writeFile(binary, '#!' + process.execPath + '\n' + `
import fs from 'node:fs';import crypto from 'node:crypto';const args=process.argv.slice(2),root=${JSON.stringify(engine)};if(args[0]!=='--config'||args[2]!=='--context')throw Error('Explicit fixture route required');const command=args[4],rest=args.slice(5),file=id=>root+'/'+id+'.json';
if(command==='info')console.log(JSON.stringify('owned-fixture-daemon'));
else if(command==='create'){const id=crypto.randomBytes(32).toString('hex'),labels={};for(let i=0;i<rest.length;i++)if(rest[i]==='--label'){const pair=rest[++i],split=pair.indexOf('=');labels[pair.slice(0,split)]=pair.slice(split+1);}fs.writeFileSync(file(id),JSON.stringify({Id:id,Config:{Labels:labels},State:{Running:false}}));console.log(id);}
else if(command==='inspect')console.log('['+fs.readFileSync(file(rest[0]),'utf8')+']');
else if(command==='start'||command==='stop'||command==='kill'){const value=JSON.parse(fs.readFileSync(file(rest.at(-1))));value.State.Running=command==='start';fs.writeFileSync(file(value.Id),JSON.stringify(value));}
else if(command==='rm')fs.unlinkSync(file(rest[0]));else throw Error('No project commands may execute in lifecycle fixture');
`, { mode: 0o700 });
    const c = await openController({
        installationHome: home, runtimeProfile: { dockerBinary: binary, dockerConfigDirectory: config, dockerContext: 'owned', image: 'sha256:' + '0'.repeat(64) }, interactionDelegation: { projectIds: ['P'], maxAssignments: 2 }
    }), previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(home, 'artifacts');
    let passed = false;
    const queued = [];
    let childId, rootCalls = 0, childCalls = 0, resultId;
    t.after(async () => {
        await c.close();
        if (previousTmp === undefined)
            delete process.env.TMPDIR;
        else
            process.env.TMPDIR = previousTmp;
        if (!passed)
            t.diagnostic('Retained assigned language fixture ' + root);
    });
    await c.registerProject({ id: 'P', sourceRoot: source });
    const parent = c.createConversation();
    const off = c.subscribeInteraction(event => {
        if (mode === 'late' && event.type === 'native-released' && event.conversationId === childId)
            queued.push(c.queueConversationInput({ conversationId: childId, expectedGeneration: event.generation, text: '정리 중 새 조건을 추가합니다.', mode: 'idle' }));
        if (event.type !== 'native-ready' || event.conversationId === parent.conversationId || event.conversationId === childId)
            return;
        childId = event.conversationId;
        queued.push(c.queueConversationInput({ conversationId: childId, expectedGeneration: event.generation, text: '진행 상황과 답변을 한국어로 알려줘.', mode: 'steer' }));
        if (mode === 'stale') {
            const handle = c.getNativeHandle(childId);
            handle.session.subscribe(native => {
                if (native.type === 'tool_execution_end' && native.toolName === 'conversation_report') {
                    queued.push(c.queueConversationInput({ conversationId: childId, expectedGeneration: c.inspectConversation(childId).generation, text: '추가 조건을 반영해줘.', mode: 'follow-up' }));
                }
            });
        }
        if (mode === 'interrupted') {
            const handle = c.getNativeHandle(childId);
            handle.session.subscribe(native => {
                if (native.type === 'tool_execution_end' && native.toolName === 'conversation_report')
                    queued.push(c.interruptConversation({ conversationId: childId, expectedGeneration: c.inspectConversation(childId).generation }));
            });
        }
    });
    t.after(off);
    const model = {
        provider: 'assigned-language-' + mode, modelId: 'fixture', definition: {
            apiKey: 'DUMMY', baseUrl: 'http://unused.invalid', api: 'assigned-language-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: usage.cost, contextWindow: 64000, maxTokens: 1000 }], streamSimple(selected, context) {
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    let tool, text;
                    try {
                        const system = getCurrentSystemPrompt(context.messages), child = system.includes('Assigned audience:');
                        if (child) {
                            const n = childCalls++;
                            if (n === 0)
                                tool = { name: 'conversation_status', args: {} };
                            else if (n === 1 && mode !== 'missing')
                                tool = { name: 'conversation_report', args: { text: english } };
                            else
                                text = human;
                        }
                        else {
                            const n = rootCalls++;
                            if (n === 0)
                                tool = {
                                    name: 'conversation_assign', args: { projectId: 'P', instructions: 'Report the fixed observation in English to the coordinator.', resultDependency: true }
                                };
                            else if (n === 1)
                                text = '자식 작업을 시작했습니다.';
                            else if (n === 2)
                                tool = { name: 'conversation_result', args: { resultId } };
                            else {
                                const last = context.messages.filter(m => m.role === 'toolResult').at(-1), body = JSON.parse(last.content.find(p => p.type === 'text').text);
                                assert.equal(body.result.coordinatorReport.text[0].text, english);
                                assert.equal(body.result.answer, undefined);
                                assert.ok(!JSON.stringify(body).includes(human));
                                text = '영어 작업 보고를 확인했습니다.';
                            }
                        }
                        const message = {
                            role: 'assistant', content: tool ? [{ type: 'toolCall', id: 'call-' + Math.random(), name: tool.name, arguments: tool.args }] : [{ type: 'text', text }], api: selected.api, provider: selected.provider, model: selected.id, usage, stopReason: tool ? 'toolUse' : 'stop', timestamp: Date.now()
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
    await c.queueConversationInput({ conversationId: parent.conversationId, expectedGeneration: 0, text: '자식에게 조사를 맡겨줘.', mode: 'idle' });
    const first = await c.runConversation({ conversationId: parent.conversationId, model });
    assert.equal(first.status, 'delivered', JSON.stringify(c.store.all('SELECT data FROM observations')));
    await c.ordinaryCore.drain();
    await Promise.all(queued);
    assert.ok(childId);
    const row = c.store.one('SELECT data FROM conversation_assignments WHERE target=?', childId), assignment = JSON.parse(row.data), published = c.store.one('SELECT id,data FROM conversation_results WHERE conversation=? ORDER BY rowid DESC LIMIT 1', childId);
    assert.ok(published, JSON.stringify(c.store.all('SELECT data FROM observations')));
    const result = JSON.parse(published.data);
    assert.equal(result.version, 2);
    assert.equal(result.result.answer, undefined);
    assert.ok(!JSON.stringify(result).includes(human));
    const view = c.inspectConversation(childId), history = await fs.readFile(view.historyRef, 'utf8');
    if (mode !== 'interrupted')
        assert.ok(history.includes(human));
    assert.ok(history.includes('진행 상황과 답변을 한국어로 알려줘.'));
    if (mode === 'healthy') {
        assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE target=?', childId).state, 'COMPLETE', JSON.stringify(result));
        assert.equal(result.result.coordinatorReport.text[0].text, english);
        assert.equal(result.result.coordinatorReport.state, 'delivered');
        assert.equal(assignment.result.answer, undefined);
        resultId = published.id;
        await c.queueConversationInput({
            conversationId: parent.conversationId, expectedGeneration: c.inspectConversation(parent.conversationId).generation, text: '결과를 알려줘.', mode: 'idle'
        });
        const next = await c.runConversation({ conversationId: parent.conversationId, model });
        assert.equal(next.status, 'delivered', JSON.stringify(next));
        assert.equal(next.answer.text[0].text, '영어 작업 보고를 확인했습니다.');
        const originalAssignment = c.store.one('SELECT * FROM conversation_assignments WHERE target=?', childId), originalResults = c.store.all('SELECT * FROM conversation_results WHERE conversation=? ORDER BY rowid', childId), entry = parseSessionEntries(history).filter(e => e.type === 'message' && e.message.role === 'assistant').at(-1);
        const navigation = await c.navigateConversationTree({ conversationId: childId, expectedGeneration: c.inspectConversation(childId).generation, entryId: entry.id, model });
        assert.equal(navigation.status, 'delivered');
        assert.deepEqual(c.store.one('SELECT * FROM conversation_assignments WHERE target=?', childId), originalAssignment);
        assert.deepEqual(c.store.all('SELECT * FROM conversation_results WHERE conversation=? ORDER BY rowid', childId), originalResults);
    }
    else {
        assert.equal(c.store.one('SELECT state FROM conversation_assignments WHERE target=?', childId).state, 'UNAVAILABLE');
        assert.equal(result.result.status, 'unavailable');
        if (mode === 'missing')
            assert.match(result.result.failure, /COORDINATOR_REPORT_REQUIRED/);
        else if (mode === 'stale' || mode === 'late')
            assert.equal(result.result.coordinatorReport.code, 'COORDINATOR_REPORT_STALE');
        else {
            assert.ok(!JSON.stringify(result).includes(english));
            assert.notEqual(result.result.coordinatorReport?.state, 'delivered');
        }
    }
    passed = true;
    successful++;
}
for (const mode of ['healthy', 'missing', 'stale', 'late', 'interrupted'])
    test('actual assigned human reply and coordinator report stay separate · ' + mode, { timeout: 20000 }, t => journey(t, mode));
