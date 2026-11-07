// Fault injection at the actual private delivery function's await boundary.
// Public native transport/order is separately covered by claude-mcp109.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const entry = import.meta.resolve('@gitjig/pi-claude-bridge-host');
const { QueryContext } = await import(new URL('./query-state.js', entry));
const { userMessage } = await import(new URL('./prompt-stream.js', entry));
const source = await fs.readFile(new URL('./index.js', entry), 'utf8'), tree = ts.createSourceFile('bridge.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), nodes = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'deliverToolResults');
assert.equal(nodes.length, 1);
const deliver = vm.runInNewContext('(' + nodes[0].getText(tree) + ')', {
    userMessage, debug() { }, piUI: undefined, steerMissedSession() { assert.fail('Stale delivery cannot change successor steering state'); }
});
for (const outcome of ['acknowledged', 'rejected'])
    test('old language delivery ' + outcome + ' cannot mutate or close a successor query', async () => {
        let resolve, reject, oldClosed = 0, newClosed = 0, oldFailed = 0, newFailed = 0, released = 0, received = 0;
        const gate = new Promise((yes, no) => {
            resolve = yes;
            reject = no;
        }), oldQuery = { close() { oldClosed++; } }, newQuery = { close() { newClosed++; } }, oldStream = { push: () => gate, fail() { oldFailed++; } }, newStream = { push: async () => assert.fail('Old delivery cannot send to successor'), fail() { newFailed++; } }, c = new QueryContext();
        c.activeQuery = oldQuery;
        c.promptStream = oldStream;
        c.languageSection = 'ko';
        const pending = deliver(c, [{ toolCallId: 'same-id', content: [], isError: false }], null, 3, 'ja');
        c.activeQuery = newQuery;
        c.promptStream = newStream;
        c.hostQuery = {};
        c.languageSection = 'en';
        c.pendingToolCalls.set('same-id', { toolName: 'successor', resolve() { received++; } });
        c.releasePendingToolCalls = () => { released++; };
        if (outcome === 'acknowledged')
            resolve();
        else
            reject(Error('Old stdin closed'));
        await pending;
        assert.equal(c.languageSection, 'en');
        assert.equal(c.languageFailure, undefined);
        assert.equal(newClosed, 0);
        assert.equal(newFailed, 0);
        assert.equal(released, 0);
        assert.equal(received, 0);
        assert.equal(c.pendingToolCalls.size, 1);
        assert.equal(oldClosed, outcome === 'rejected' ? 1 : 0);
        assert.equal(oldFailed, outcome === 'rejected' ? 1 : 0);
    });
