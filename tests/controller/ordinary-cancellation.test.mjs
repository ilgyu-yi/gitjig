import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';

const latch=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const ledger=c=>Object.fromEntries(['sources','works','budgets','runs','conversation_inputs','conversations','conversation_state','capacity_leases'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
async function world(t) {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-ordinary-cancel-'))),source=path.join(root,'source');
    await fs.mkdir(source);await fs.writeFile(path.join(source,'original.txt'),'original project text');
    const c=await openController({installationHome:path.join(root,'home'),runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)}});
    let passed=false;
    t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained ordinary cancellation fixture '+root);});
    await c.registerProject({id:'P',sourceRoot:source});
    const accounts=ApplicationAccounts.open(c),models=new ApplicationModels(c);
    await accounts.configure({providers:{'cancellation-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',apiKey:'UNUSED',models:[{id:'fixture'}]}}});
    await accounts.setDefault('cancellation-fixture','fixture');models.install();
    const view=await models.newConversation({projectId:'P'}),cid=view.conversationId,text='Original request 한글';
    const receipt=await c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:view.generation,text,mode:'idle'});
    return {c,cid,text,receipt,operation:models.conversationOperation(cid),host:c.ordinary.h,pass(){passed=true;}};
}

test('an already cancelled ordinary request does not resolve a model or admit work',async t=>{
    const f=await world(t),abort=new AbortController(),reason=Error('OWNED_ALREADY_CANCELLED'),before=ledger(f.c);
    let resolved=0;const original=f.host.resolveOperation;
    f.host.resolveOperation=(...args)=>{resolved++;return original(...args);};
    abort.abort(reason);
    await assert.rejects(f.c.runConversation({conversationId:f.cid,...f.operation,signal:abort.signal}),error=>error===reason);
    assert.equal(resolved,0);assert.deepEqual(ledger(f.c),before);f.pass();
});

for(const boundary of ['resolveOperation','beforeFresh'])test(`cancellation during ordinary ${boundary} keeps the original queued input without late admission`,async t=>{
    const f=await world(t),abort=new AbortController(),reason=Error('OWNED_PREPARATION_CANCELLED'),entered=latch(),release=latch(),before=ledger(f.c);
    const owner=boundary==='resolveOperation'?f.host:f.host.completed,original=owner[boundary];
    owner[boundary]=async function(...args){const result=await original.apply(this,args);entered.resolve();await release.promise;return result;};
    const pending=f.c.runConversation({conversationId:f.cid,...f.operation,signal:abort.signal});
    const rejected=assert.rejects(pending,error=>error===reason);
    try {
        await entered.promise;abort.abort(reason);release.resolve();await rejected;
    } finally {release.resolve();owner[boundary]=original;}
    assert.deepEqual(ledger(f.c),before);
    assert.equal(f.c.getNativeHandle(f.cid),null);
    assert.equal(f.c.store.one('SELECT state,text FROM conversation_inputs WHERE id=?',f.receipt.inputId).state,'QUEUED');
    assert.equal(f.c.store.one('SELECT raw FROM sources WHERE id=(SELECT source FROM conversation_inputs WHERE id=?)',f.receipt.inputId).raw,f.text);f.pass();
});

test('cancellation at actual ordinary capture settles the same admitted run without runtime or model dispatch',async t=>{
    const f=await world(t),abort=new AbortController(),original=f.host.patchRun;
    let captured=false,runtime=false;
    f.host.patchRun=(id,phase,data)=>{
        original(id,phase,data);
        if(phase==='CAPTURING') {captured=true;assert.equal(f.c.inspectConversationProgress(f.cid).stage,'capture');queueMicrotask(()=>abort.abort());}
        if(phase==='RUNTIME_CREATING') {runtime=true;throw Error('UNEXPECTED_RUNTIME_BOUNDARY');}
    };
    let result;
    try {result=await f.c.runConversation({conversationId:f.cid,...f.operation,signal:abort.signal});}
    finally {f.host.patchRun=original;}
    assert.equal(captured,true);assert.equal(runtime,false);
    assert.equal(result.status,'interrupted');assert.equal(result.cleanup,'not-allocated');
    const run=f.c.store.one('SELECT * FROM runs'),data=JSON.parse(run.data);
    assert.equal(run.id,result.runId);assert.equal(run.phase,'SETTLED');
    assert.equal(data.nativePromptAttempted,undefined);assert.equal(data.modelDispatchAttempted,undefined);assert.equal(data.containerId,undefined);
    assert.equal(f.c.inspectConversation(f.cid).state,'IDLE');assert.equal(f.c.getNativeHandle(f.cid),null);
    const input=f.c.store.one('SELECT * FROM conversation_inputs WHERE id=?',f.receipt.inputId);
    assert.equal(input.state,'QUEUED');assert.equal(input.text,f.text);assert.equal(JSON.parse(input.data).interruptedRun,run.id);
    const budget=f.c.store.one("SELECT * FROM budgets WHERE lineage=? AND kind='execution'",result.workId);
    assert.equal(budget.consumed,1);assert.equal(budget.reserved,0);
    assert.equal(f.c.store.one('SELECT state FROM capacity_leases WHERE run=?',run.id).state,'RELEASED');f.pass();
});
