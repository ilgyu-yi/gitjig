// The synthetic producer must call the real native tool, then preserve its original final.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { initializePiHost, createPiSession } from '../../dist/pi/index.js';
import { withAssignedReports, assignedWireReply } from './assigned-report-fixture.mjs';
test('assigned fixture inserts a native report and returns the cached final without replaying its script', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'gitjig-report-fixture-'))), oldTemp = process.env.TMPDIR;
    for (const name of ['state', 'artifacts', 'work'])
        await fs.mkdir(path.join(root, name), { mode: 0o700 });
    process.env.TMPDIR = path.join(root, 'artifacts');
    let pi, calls = 0;
    const reports = [];
    try {
        const host = await initializePiHost({ stateRoot: path.join(root, 'state'), artifactRoot: path.join(root, 'artifacts') }), usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        const model = withAssignedReports({
            provider: 'report-fixture', modelId: 'fixture', definition: {
                apiKey: 'DUMMY', baseUrl: 'http://unused.invalid', api: 'report-fixture-api', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], cost: usage.cost, contextWindow: 32000, maxTokens: 1000 }], streamSimple(selected) {
                    const stream = createAssistantMessageEventStream(), message = {
                        role: 'assistant', content: [{ type: 'text', text: 'Original fixture final ' + (++calls) }], api: selected.api, provider: selected.provider, model: selected.id, usage, stopReason: 'stop', timestamp: Date.now()
                    };
                    queueMicrotask(() => {
                        stream.push({ type: 'done', reason: 'stop', message });
                        stream.end(message);
                    });
                    return stream;
                }
            }
        });
        const unused = async () => { throw Error('No project operation expected'); }, operations = {
            workspaceRoot: path.join(root, 'work'), validatePath: p => path.resolve(root, 'work', p), exec: unused, readFile: unused, access: unused, writeFile: unused, mkdir: unused
        };
        pi = await createPiSession({
            host, operations, model, systemPrompt: 'Assigned synthetic report fixture', maxReadBytes: 1024, coordination: {
                status: () => ({}), address: () => ({}), assign: () => ({}), acknowledgeInput: () => ({}), report(input, id) {
                    reports.push({ input, id });
                    return { recorded: true };
                }
            }
        });
        for (let turn = 1; turn <= 2; turn++) {
            await pi.session.prompt('Original owner input ' + turn);
            assert.equal(calls, turn);
            assert.equal(reports.length, turn);
            assert.equal(reports.at(-1).input.text, 'Original fixture final ' + turn);
            const messages = pi.session.messages, call = messages.findLast(m => m.role === 'assistant' && m.content.some(p => p.type === 'toolCall'));
            assert.equal(call.content[0].id, reports.at(-1).id);
            assert.equal(call.content[0].name, 'conversation_report');
            const receipt = messages.findLast(m => m.role === 'toolResult');
            assert.equal(receipt.toolCallId, reports.at(-1).id);
            assert.notEqual(receipt.isError, true);
            assert.equal(messages.at(-1).content[0].text, 'Original fixture final ' + turn);
        }
    }
    finally {
        await pi?.session.abort();
        pi?.session.dispose();
        if (oldTemp === undefined)
            delete process.env.TMPDIR;
        else
            process.env.TMPDIR = oldTemp;
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('wire fixture requests a report only on the advertised assigned path and after the latest input', () => {
    const answer = { text: 'Original assigned final' }, report = { tool: { name: 'conversation_report', arguments: { text: answer.text } } }, tool = { function: { name: 'conversation_report' } }, user = { role: 'user', content: 'Owner input' }, call = { role: 'assistant', tool_calls: [{ function: { name: 'conversation_report' } }] };
    assert.equal(assignedWireReply({ messages: [user] }, answer), answer);
    assert.deepEqual(assignedWireReply({ tools: [tool], messages: [user] }, answer), report);
    assert.equal(assignedWireReply({ tools: [tool], messages: [user, call] }, answer), answer);
    assert.deepEqual(assignedWireReply({ tools: [tool], messages: [user, call, user] }, answer), report);
    assert.deepEqual(assignedWireReply({ tools: [tool], messages: [user] }, { text: '' }), { text: '' });
});
