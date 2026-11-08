import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Store } from '../../dist/controller/store.js';
import { observeCapturedInputPresentation, observeHostInputPresentation, readCapturedInputPresentation, readNativeInputPresentation } from '../../dist/controller/captured-input-presentation.js';

test('captured-input display follows the actual appended SDK message only', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-captured-presentation-'));
    const store = new Store(path.join(root, 'state.sqlite'));
    try {
        const sha = value => createHash('sha256').update(value).digest('hex');
        const raw = 'Ask about @source.txt', text = 'opaque prepared context for the model';
        const context = { rawSha256: sha(raw), files: [{ path: 'source.txt' }] };
        const manager = SessionManager.create(root, root), sessionId = manager.getSessionId();
        store.run("INSERT INTO conversations VALUES('C',NULL,NULL,1,'RUNNING')");
        store.run("INSERT INTO sources VALUES('S','C',?,?)", JSON.stringify({ context }), raw);
        store.run("INSERT INTO works VALUES('W',NULL,'S',NULL,'W','ACTIVE',1,1,NULL,'{}')");
        store.run("INSERT INTO runs VALUES('R','W',1,1,'RUNNING',?,'reserved',?)", root, JSON.stringify({ nativeSessionId: sessionId }));
        store.run("INSERT INTO conversation_inputs VALUES('I','C',1,'W','S','CONSUMED','idle',?,?)", raw, JSON.stringify({ context }));
        const identity = { conversationId: 'C', workId: 'W', runId: 'R', launchId: null, generation: 1, directionRevision: 1, initialInputId: 'I' };
        const comparison = { runId: 'R', generation: 1, inputId: 'I', sourceId: 'S', inputManifestSha256: sha(JSON.stringify(context)) };
        const message = { role: 'user', content: [{ type: 'text', text }], timestamp: 1 };
        observeCapturedInputPresentation(store, identity, manager, message, text, comparison);
        const entry = manager.appendMessage(message);
        await Promise.resolve();
        assert.deepEqual(readCapturedInputPresentation(store, 'C', sessionId, entry, text), { text: raw, fileCount: 1 });
        assert.equal(readCapturedInputPresentation(store, 'C', sessionId, entry, text + ' changed'), undefined);
        assert.equal(readCapturedInputPresentation(store, 'another', sessionId, entry, text), undefined);
        observeCapturedInputPresentation(store, identity, manager, message, text, comparison);
        const literal = manager.appendMessage(structuredClone(message));
        await Promise.resolve();
        assert.equal(readCapturedInputPresentation(store, 'C', sessionId, literal, text), undefined);
        assert.match(await fs.readFile(manager.getSessionFile(), 'utf8'), /opaque prepared context for the model/);
    } finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('WAIT presentation binds the real appended entry and survives replacement of the live scheduler cursor', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-wait-presentation-'));
    const store = new Store(path.join(root, 'state.sqlite'));
    try {
        const manager = SessionManager.create(root, root), sessionId = manager.getSessionId();
        const previous = {conversationId:'C',workId:'W',runId:'previous',launchId:null,generation:1,directionRevision:1,initialInputId:'older-input'};
        const identity = {...previous,runId:'R',generation:2,directionRevision:2,initialInputId:'I'};
        const wait = {runId:previous.runId,sourceIdentity:previous,waitHandles:['assignment'],resultIds:['result'],inputId:'I',sourceId:'S',directionRevision:2,newRunId:'R'};
        const text = 'Opaque same-text example · original provider input';
        const origin = JSON.stringify({kind:'agent-conversation-input',actor:previous});
        store.run("INSERT INTO conversations VALUES('C',NULL,NULL,2,'RUNNING')");
        store.run("INSERT INTO sources VALUES('S','C',?,?)",origin,text);
        store.run("INSERT INTO works VALUES('W',NULL,'S',NULL,'W','ACTIVE',1,1,NULL,'{}')");
        store.run("INSERT INTO runs VALUES('R','W',1,1,'RUNNING',?,'reserved',?)",root,
            JSON.stringify({conversation:'C',nativeSessionId:sessionId,initialInputId:'I'}));
        store.run("INSERT INTO conversation_inputs VALUES('I','C',2,'W','S','CONSUMED','idle',?,'{}')",text);
        store.run("INSERT INTO conversation_state(conversation,data) VALUES('C',?)",JSON.stringify({explicitContinuation:wait}));
        const message = () => ({role:'user',content:[{type:'text',text}],timestamp:1});
        const read = (id, value=text) => readNativeInputPresentation(store,'C',sessionId,id,value);
        const actual = message();
        observeHostInputPresentation(store,identity,manager,actual,text);
        const original = manager.appendMessage(actual);
        await Promise.resolve();
        assert.deepEqual(read(original),{kind:'wait-resume'});

        store.run("UPDATE conversation_state SET data=? WHERE conversation='C'",JSON.stringify({explicitContinuation:{...wait,newRunId:'new-run'}}));
        assert.deepEqual(read(original),{kind:'wait-resume'});
        const literal = message();
        observeHostInputPresentation(store,identity,manager,literal,text);
        const differentEntry = manager.appendMessage(literal);
        await Promise.resolve();
        assert.equal(read(differentEntry),undefined);
        assert.equal(read(original,text+' changed'),undefined);
        assert.equal(readNativeInputPresentation(store,'C','other-session',original,text),undefined);
        store.run("UPDATE conversation_state SET data=? WHERE conversation='C'",JSON.stringify({explicitContinuation:wait}));
        store.run("UPDATE sources SET origin=? WHERE id='S'",JSON.stringify({kind:'owner-conversation-input'}));
        const direct = message();
        observeHostInputPresentation(store,identity,manager,direct,text);
        const directEntry = manager.appendMessage(direct);
        await Promise.resolve();
        assert.equal(read(directEntry),undefined);
        assert.equal(read(original),undefined);
    } finally {
        store.close();
        await fs.rm(root,{recursive:true,force:true});
    }
});
