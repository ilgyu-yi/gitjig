import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import net from 'node:net';
import { openController } from '../../dist/controller/index.js';
import { ApplicationAccounts } from '../../dist/app/accounts.js';
import { ApplicationModels } from '../../dist/app/models.js';
import { initializeApplicationEnvironment } from '../../dist/app/environment.js';
import { nativeCheckpoint } from '../../dist/controller/history.js';
import { validatedContextOrigin, contextAuthoritySnapshot } from '../../dist/controller/context-origin.js';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { workCommands } from '../../dist/ui/work-commands.js';

initializeApplicationEnvironment();
const root = process.argv[2], home = path.join(root, 'app'), evidence = path.join(root, 'handoff-evidence.json');
const markers = ['SOURCE_FIRST_NATIVE', 'SOURCE_SECOND_NATIVE', 'FORK_FIRST_NATIVE', 'CLONE_FIRST_NATIVE'];
const recovery = process.env.GITJIG_CONTEXT_RECOVERY_CASE;
if (recovery) markers.push('RECOVERED_CLONE_NATIVE');
let requests = 0, sockets = 0, controller;
const bodies = [], observations = { markers, requests: bodies };
net.Socket.prototype.connect = function () { sockets++; throw Error('No socket in public producer handoff'); };
globalThis.fetch = async (url, options) => {
    assert.ok(requests < markers.length, 'Original-codec request ceiling'); const index = requests++;
    assert.equal(String(url), 'http://127.0.0.1:9/v1/chat/completions'); assert.equal(options.method, 'POST');
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer DUMMY_HANDOFF_KEY');
    const body = JSON.parse(options.body); assert.equal(body.model, 'owned'); assert.ok(Array.isArray(body.messages));
    bodies.push({ model: body.model, messages: body.messages });
    return wireResponse('openai-completions', body.model, { text: markers[index] });
};
const policy = { mode: 'finite', idleMs: 60000, maxRetained: 2 };
const inspectData = cid => JSON.parse(controller.store.one('SELECT data FROM conversation_state WHERE conversation=?', cid).data);
const runData = wid => controller.store.all('SELECT * FROM runs WHERE work=? ORDER BY rowid', wid).map(row => ({ ...row, data: JSON.parse(row.data) }));
const assistantTexts = history => history.sessionManager.buildSessionProjection().messages.filter(m => m.role === 'assistant').map(m => m.content.filter(v => v.type === 'text').map(v => v.text).join(''));
async function main() { try {
    controller = await openController({ installationHome: home, completedResources: policy });
    const accounts = ApplicationAccounts.open(controller), models = new ApplicationModels(controller), store = controller.store;
    models.install();
    await accounts.configure({ providers: { 'handoff-fixture': { api: 'openai-completions', apiKey: 'DUMMY_HANDOFF_KEY', baseUrl: 'http://127.0.0.1:9/v1', models: [{ id: 'owned', contextWindow: 8192, maxTokens: 256 }] } } });
    await accounts.setDefault('handoff-fixture', 'owned');
    const source = await models.newConversation();
    const turn = async (cid, text) => {
        const view = controller.inspectConversation(cid);
        await controller.queueConversationInput({ conversationId: cid, expectedGeneration: view.generation, text, mode: 'idle' });
        const outcome = await controller.runConversation({ conversationId: cid, ...models.conversationOperation(cid) });
        assert.equal(outcome.status, 'delivered'); return outcome;
    };
    await turn(source.conversationId, 'First actual question');
    const firstHistory = await controller.getConversationHistory(source.conversationId);
    const firstAssistant = firstHistory.sessionManager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'assistant' && JSON.stringify(entry.message.content).includes(markers[0]));
    assert.ok(firstAssistant);
    const originalWork = controller.inspectConversation(source.conversationId).workId;
    await turn(source.conversationId, 'Second actual question');
    assert.equal(controller.inspectConversation(source.conversationId).workId, originalWork); assert.equal(runData(originalWork).length, 2);
    assert.equal(controller.inspectConversation(source.conversationId).completedResource.state, 'absent');
    const nonretention = store.all("SELECT data FROM observations WHERE json_extract(data,'$.kind')='completed-client-not-retained'").map(row => JSON.parse(row.data));
    assert.deepEqual(nonretention, Array.from({ length: 2 }, () => ({ kind: 'completed-client-not-retained', reason: 'borrowed-runtime-not-owned' })));
    observations.managedNonretention = nonretention;
    const sourceView = controller.inspectConversation(source.conversationId), sourceBytes = await fs.readFile(sourceView.historyRef), sourceCheckpoint = await nativeCheckpoint(sourceView.historyRef);
    const sourceChoice = controller.getConversationModelChoice(source.conversationId);
    const request = { conversationId: source.conversationId, expectedGeneration: sourceView.generation, expectedModelRevision: sourceChoice.revision };
    const beforeBudget = store.all('SELECT * FROM budgets ORDER BY kind').map(row => ({ ...row }));
    const fork = await controller.forkConversation({ ...request, kind: 'fork', entryId: firstAssistant.id });
    assert.equal(controller.inspectConversation(source.conversationId).completedResource.state, 'absent');
    const clone = await controller.forkConversation({ ...request, kind: 'clone' });
    const views = [sourceView, fork, clone];
    assert.equal(new Set(views.map(view => view.nativeSessionId)).size, 3); assert.equal(new Set(views.map(view => view.historyRef)).size, 3);
    assert.deepEqual(await fs.readFile(sourceView.historyRef), sourceBytes);
    const seeds = [fork, clone].map(view => structuredClone(inspectData(view.conversationId).nativeSeed));
    const origins = [fork, clone].map(view => structuredClone(inspectData(view.conversationId).contextOrigin));
    for (const [index, view] of [fork, clone].entries()) {
        assert.equal(view.workId, null); assert.equal(view.generation, 0); assert.equal(view.parentId, source.conversationId);
        assert.equal(store.one('SELECT COUNT(*) AS n FROM conversation_inputs WHERE conversation=?', view.conversationId).n, 0);
        assert.equal(Object.hasOwn(inspectData(view.conversationId), 'runId'), false); assert.equal(Object.hasOwn(inspectData(view.conversationId), 'role'), false);
        assert.deepEqual(controller.getConversationModelChoice(view.conversationId), sourceChoice);
        assert.equal(origins[index].sourceWorkId, originalWork); assert.equal(origins[index].effects.sourceEpoch, store.one('SELECT epoch FROM works WHERE id=?', originalWork).epoch);
        assert.equal(origins[index].sourceGeneration, 2); assert.equal(origins[index].sourceChoiceRevision, sourceChoice.revision);
        assert.deepEqual(JSON.parse(store.one('SELECT origin FROM sources WHERE id=?', origins[index].sourceEventId).origin).contextOrigin, origins[index]);
        const history = await controller.getConversationHistory(view.conversationId);
        assert.equal(history.sessionManager.getHeader().parentSession, sourceView.historyRef);
        assert.deepEqual(assistantTexts(history), index === 0 ? [markers[0]] : markers.slice(0, 2));
    }
    assert.equal(seeds[0].source.selectedLeaf, firstAssistant.id);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM works').n, 1); assert.equal(store.one('SELECT COUNT(*) AS n FROM runs').n, 2);
    assert.deepEqual(store.all('SELECT * FROM budgets ORDER BY kind').map(row => ({ ...row })), beforeBudget);
    await turn(fork.conversationId, 'Continue the selected earlier context');
    await turn(clone.conversationId, 'Continue the current copied context');
    assert.equal(requests, 4);
    const forkRequest = JSON.stringify(bodies[2].messages), cloneRequest = JSON.stringify(bodies[3].messages);
    assert.ok(forkRequest.includes(markers[0])); assert.ok(!forkRequest.includes(markers[1]));
    assert.ok(cloneRequest.includes(markers[0])); assert.ok(cloneRequest.includes(markers[1])); assert.ok(!cloneRequest.includes(markers[2]));
    const works = views.map(view => store.one('SELECT * FROM works WHERE id=?', controller.inspectConversation(view.conversationId).workId));
    assert.equal(new Set(works.map(work => work.id)).size, 3); assert.deepEqual(works.map(work => work.lineage), [originalWork, originalWork, originalWork]);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM works').n, 3); assert.equal(store.one('SELECT COUNT(*) AS n FROM runs').n, 4);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM budgets').n, 2);
    assert.deepEqual({ ...store.one('SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind=?', originalWork, 'execution') }, { lim: 8, consumed: 4, reserved: 0 });
    assert.deepEqual({ ...store.one('SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind=?', originalWork, 'resolution') }, { lim: 8, consumed: 0, reserved: 0 });
    assert.equal(store.one('SELECT COUNT(*) AS n FROM conversation_assignments').n, 0);
    const delegation = JSON.parse(works[0].data).delegation;
    observations.works = works.map(work => ({ ...work, data: JSON.parse(work.data) })); observations.runs = works.flatMap(work => runData(work.id));
    for (const [index, view] of [fork, clone].entries()) {
        const work = works[index + 1], data = JSON.parse(work.data), runs = runData(work.id);
        assert.equal(data.conversation, view.conversationId); assert.equal(data.delegation.rootWorkId, delegation.rootWorkId);
        assert.ok(data.delegation.maxAssignments <= origins[index].delegationCeiling.maxAssignments);
        assert.equal(data.continuationSourceWorkId, originalWork); assert.deepEqual(data.contextOrigin, origins[index]); assert.equal(runs.length, 1);
        assert.equal(runs[0].phase, 'SETTLED'); assert.equal(runs[0].data.conversation, view.conversationId);
        assert.equal(runs[0].data.nativeSessionId, view.nativeSessionId); assert.ok(runs[0].data.nativeCheckpoint);
        const ownerSource = JSON.parse(store.one('SELECT origin FROM sources WHERE id=?', work.source).origin);
        assert.equal(ownerSource.kind, 'owner-conversation-input');
        assert.deepEqual(inspectData(view.conversationId).nativeSeed, seeds[index]);
        await nativeCheckpoint(view.historyRef, seeds[index].destination.checkpoint);
        assert.ok(runs[0].data.nativeCheckpoint.bytes > seeds[index].destination.checkpoint.bytes);
        assert.deepEqual(assistantTexts(await controller.getConversationHistory(view.conversationId)), index === 0 ? [markers[0], markers[2]] : [markers[0], markers[1], markers[3]]);
    }
    observations.seeds = seeds; observations.origins = origins; observations.sourceCheckpoint = sourceCheckpoint;
    observations.budgets = store.all('SELECT * FROM budgets ORDER BY kind').map(row => ({ ...row }));
    assert.deepEqual(await fs.readFile(sourceView.historyRef), sourceBytes); assert.deepEqual(await nativeCheckpoint(sourceView.historyRef), sourceCheckpoint);
    if (recovery) {
        const cloneView = controller.inspectConversation(clone.conversationId), cloneWork = cloneView.workId;
        const cloneBytes = await fs.readFile(cloneView.historyRef), originalData = store.one('SELECT data FROM works WHERE id=?',cloneWork).data;
        const originBytes = JSON.stringify(inspectData(clone.conversationId).contextOrigin), edgeBytes = JSON.stringify(JSON.parse(originalData).contextContinuation);
        const originalEvent = {...store.one('SELECT * FROM sources WHERE id=?',origins[1].sourceEventId)};
        const beforeBudget = store.all('SELECT * FROM budgets ORDER BY kind').map(row=>({...row}));
        const descendant = await controller.forkConversation({conversationId:clone.conversationId,expectedGeneration:cloneView.generation,expectedModelRevision:controller.getConversationModelChoice(clone.conversationId).revision,kind:'clone'});
        await controller.cancelWork({workId:originalWork});
        const rootRecovery = controller.inspectOrdinaryWorkRecovery(originalWork); assert.equal(rootRecovery.eligible,true,JSON.stringify(rootRecovery.holds));
        controller.recoverOrdinaryWorkAdmission({workId:originalWork,expectedContext:rootRecovery.fingerprint,reason:'Restore the same root independently'},()=>{});
        assert.throws(()=>validatedContextOrigin(store,clone.conversationId),/effect source epoch/);
        const context = controller.inspectContextWorkRecovery(cloneWork); assert.equal(context.eligible,true,JSON.stringify(context.holds));
        const request = () => ({workId:cloneWork,expectedContext:controller.inspectContextWorkRecovery(cloneWork).fingerprint,reason:'Restore the same retained clone admission'});
        const ledger = () => JSON.stringify({works:store.all('SELECT * FROM works'),sources:store.all('SELECT * FROM sources'),runs:store.all('SELECT * FROM runs'),budgets:store.all('SELECT * FROM budgets'),inputs:store.all('SELECT * FROM conversation_inputs'),assignments:store.all('SELECT * FROM conversation_assignments')});
        if (recovery === 'metadata-adverse') {
            // Controlled later-run metadata with the genuine earlier native checkpoint retained.
            // This is a refusal consumer, not a claim of another actual model dispatch.
            for(const marker of ['modelDispatchAttempted','nativeInputObserved']){
                const row={...store.one('SELECT * FROM runs WHERE work=? ORDER BY rowid DESC LIMIT 1',cloneWork)},data=JSON.parse(row.data);
                row.id='CONTROLLED_LATER_'+marker;data.attainedNative=false;data[marker]=true;row.data=JSON.stringify(data);
                try{store.run('INSERT INTO runs('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')',...Object.values(row));const before=ledger();assert.equal(controller.inspectContextWorkRecovery(cloneWork).eligible,false);await assert.rejects(controller.recoverContextWorkAdmission(request(),()=>{}),/changed or is held/);assert.equal(ledger(),before);assert.equal(requests,4);}
                finally{store.run('DELETE FROM runs WHERE id=?',row.id);}
            }
            const mutations = [
                ['conversation_state','data',source.conversationId,'conversation',d=>{d.contextFamily.budgetLineage='WRONG_LINEAGE';return d;}],
                ['works','data',cloneWork,'id',d=>{d.contextOrigin.effects.ceiling='none';return d;}],
                ['sources','origin',origins[1].sourceEventId,'id',d=>{d.contextOrigin.sourceWorkId=cloneWork;return d;}],
                ['works','data',originalWork,'id',d=>{d.invocation={};return d;}],
                ['runs','data',context.captured.histories[1].runId,'id',d=>{d.cleanup='quarantined';return d;}],
                ['runs','data',context.captured.histories[1].runId,'id',d=>{d.nativeCheckpoint.sessionId='WRONG_SESSION';return d;}],
                ['runs','data',context.captured.histories[0].runId,'id',d=>{d.attainedNative=false;d.modelDispatchAttempted=true;return d;}],
                ['runs','data',context.captured.histories[0].runId,'id',d=>{d.attainedNative=false;d.nativeInputObserved=true;return d;}],
                ['conversation_state','data',clone.conversationId,'conversation',d=>{d.nativeInputRecovery={};return d;}],
            ];
            for (const [table,column,id,key,change] of mutations) {
                const original=store.one(`SELECT ${column} AS value FROM ${table} WHERE ${key}=?`,id).value;
                try {store.run(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`,JSON.stringify(change(JSON.parse(original))),id);const before=ledger();assert.equal(controller.inspectContextWorkRecovery(cloneWork).eligible,false);await assert.rejects(controller.recoverContextWorkAdmission(request(),()=>{}),/changed or is held/);assert.equal(ledger(),before);assert.equal(requests,4);}
                finally {store.run(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`,original,id);}
            }
        }
        if (recovery === 'missing-history') {
            for (const file of [sourceView.historyRef,cloneView.historyRef]) {
                const before=ledger(); await fs.rename(file,file+'.held');
                try { await assert.rejects(controller.recoverContextWorkAdmission(request(),()=>{}),/ENOENT/); assert.equal(ledger(),before); assert.equal(requests,4); }
                finally { await fs.rename(file+'.held',file); }
            }
        }
        if (recovery === 'final-abort') {
            const abort = new AbortController(), before=ledger();
            await assert.rejects(controller.recoverContextWorkAdmission({...request(),signal:abort.signal},()=>{if(store.db.isTransaction)abort.abort(Error('Final owner abort'));}),/Final owner abort/);
            assert.equal(ledger(),before); assert.equal(requests,4);
        }
        if (recovery === 'direction-drift') {
            const beforeEpoch=store.one('SELECT epoch FROM works WHERE id=?',cloneWork).epoch, sourceCount=store.one('SELECT COUNT(*) AS n FROM sources').n;
            let changed=false;
            await assert.rejects(controller.recoverContextWorkAdmission(request(),()=>{if(!changed&&store.db.isTransaction){changed=true;store.run('UPDATE conversation_state SET direction=direction+1 WHERE conversation=?',clone.conversationId);}}),/changed or is held/);
            assert.equal(store.one('SELECT epoch FROM works WHERE id=?',cloneWork).epoch,beforeEpoch);assert.equal(store.one('SELECT COUNT(*) AS n FROM sources').n,sourceCount);assert.equal(requests,4);
        }
        if (['close-during-read','root-cancel-during-read'].includes(recovery)) {
            const open=fs.open;let release,reached;
            const held=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{release=resolve;});let once=false;
            fs.open=async(file,...args)=>{if(file===sourceView.historyRef&&!once){once=true;reached();await gate;}return open(file,...args);};
            const before=ledger(),pending=controller.recoverContextWorkAdmission(request(),()=>{}),rejected=assert.rejects(pending,/closed|closing|aborted|changed or is held/i);
            try {
                await held;
                if(recovery==='close-during-read'){
                    let closed=false;const closing=controller.close().then(()=>{closed=true;});await Promise.resolve();assert.equal(closed,false,'Close must join the owned read');release();await rejected;await closing;
                    controller=await openController({installationHome:home,completedResources:policy});
                    const reopened=controller.store;
                    const after=JSON.stringify({works:reopened.all('SELECT * FROM works'),sources:reopened.all('SELECT * FROM sources'),runs:reopened.all('SELECT * FROM runs'),budgets:reopened.all('SELECT * FROM budgets'),inputs:reopened.all('SELECT * FROM conversation_inputs'),assignments:reopened.all('SELECT * FROM conversation_assignments')});
                    assert.equal(after,before);assert.equal(requests,4);observations.contextRecovery={case:recovery,workId:cloneWork,originPreserved:true,oldDescendantHeld:true,actualSeparateContinuation:false,closeJoinedOwnedRead:true};observations.status='passed';return;
                }
                await controller.cancelWork({workId:originalWork});const cancelled=ledger();release();await rejected;assert.equal(ledger(),cancelled);assert.equal(requests,4);
                const root=controller.inspectOrdinaryWorkRecovery(originalWork);assert.equal(root.eligible,true,JSON.stringify(root.holds));controller.recoverOrdinaryWorkAdmission({workId:originalWork,expectedContext:root.fingerprint,reason:'Restore exact root after cancellation during physical proof'},()=>{});
            } finally {release();fs.open=open;}
        }
        const originalRequest=request();
        let result;
        if (recovery === 'ui') {
            const command=(choices,inputs)=>new HostCommands(workCommands({controller,isCurrent:()=>true,choose:async(title,rows)=>{if(title==='Confirm retained context admission recovery')assert.equal(rows[0],'Back without recovery');const selected=choices.shift();return rows.find(row=>row.startsWith(selected??'NO_SELECTION'));},input:async()=>inputs.shift(),show:async()=>{},notice:()=>{},activate:async()=>assert.fail('Admission recovery cannot navigate')}));
            const before=ledger();
            await command(['Review retained context admission recovery','Back without recovery','Back to all works'],['Explicit reason']).execute('/work '+cloneWork,clone.conversationId);assert.equal(ledger(),before);
            await command(['Review retained context admission recovery','Back to all works'],[undefined]).execute('/work '+cloneWork,clone.conversationId);assert.equal(ledger(),before);
            await command(['Review retained context admission recovery','Recover this retained context admission'],['Explicit exact context recovery']).execute('/work '+cloneWork,clone.conversationId);
            result={workId:cloneWork,sourceId:JSON.parse(store.one('SELECT data FROM works WHERE id=?',cloneWork).data).contextAdmissionRecoverySource,physicalHistory:'verified',execution:'not dispatched'};
        } else if (recovery === 'concurrent') {
            const results=await Promise.allSettled([controller.recoverContextWorkAdmission(originalRequest,()=>{}),controller.recoverContextWorkAdmission(originalRequest,()=>{})]);
            assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);result=results.find(r=>r.status==='fulfilled').value;
        } else result=await controller.recoverContextWorkAdmission(originalRequest,()=>{});
        assert.equal(result.workId,cloneWork);assert.equal(result.physicalHistory,'verified');assert.equal(result.execution,'not dispatched');
        assert.equal(requests,4);assert.deepEqual(store.all('SELECT * FROM budgets ORDER BY kind').map(row=>({...row})),beforeBudget);
        assert.equal(JSON.stringify(inspectData(clone.conversationId).contextOrigin),originBytes);assert.equal(JSON.stringify(JSON.parse(store.one('SELECT data FROM works WHERE id=?',cloneWork).data).contextContinuation),edgeBytes);
        assert.deepEqual({...store.one('SELECT * FROM sources WHERE id=?',origins[1].sourceEventId)},originalEvent);
        assert.deepEqual(await fs.readFile(cloneView.historyRef),cloneBytes);assert.deepEqual(await fs.readFile(sourceView.historyRef),sourceBytes);
        assert.deepEqual(validatedContextOrigin(store,clone.conversationId),origins[1]);
        assert.ok(contextAuthoritySnapshot(store,[cloneWork])[0].context.recovery.fingerprint);
        if(recovery==='metadata-adverse'){
            const proof=store.one('SELECT raw FROM sources WHERE id=?',result.sourceId).raw;
            try{const bad=JSON.parse(proof);bad.sourceEpoch++;store.run('UPDATE sources SET raw=? WHERE id=?',JSON.stringify(bad),result.sourceId);assert.throws(()=>validatedContextOrigin(store,clone.conversationId),/epoch/);assert.equal(requests,4);}finally{store.run('UPDATE sources SET raw=? WHERE id=?',proof,result.sourceId);}
        }
        assert.throws(()=>validatedContextOrigin(store,descendant.conversationId),/effect source epoch/);
        await assert.rejects(controller.recoverContextWorkAdmission(originalRequest,()=>{}),/changed or is held/);
        const fresh = await controller.forkConversation({conversationId:clone.conversationId,expectedGeneration:cloneView.generation,expectedModelRevision:controller.getConversationModelChoice(clone.conversationId).revision,kind:'clone'});
        assert.ok(validatedContextOrigin(store,fresh.conversationId));
        await turn(clone.conversationId,'Separate explicit continuation of the recovered original context');
        assert.equal(controller.inspectConversation(clone.conversationId).workId,cloneWork);assert.equal(requests,5);
        const rootAgain=controller.inspectConversation(source.conversationId);
        await controller.cancelWork({workId:originalWork});
        assert.throws(()=>validatedContextOrigin(store,clone.conversationId),/work|epoch/);
        const second=controller.inspectOrdinaryWorkRecovery(originalWork);assert.equal(second.eligible,true,JSON.stringify(second.holds));
        controller.recoverOrdinaryWorkAdmission({workId:originalWork,expectedContext:second.fingerprint,reason:'Restore original root after a later cancellation'},()=>{});
        assert.throws(()=>validatedContextOrigin(store,clone.conversationId),/epoch/);
        const repeat=await controller.recoverContextWorkAdmission(request(),()=>{});assert.equal(repeat.workId,cloneWork);assert.equal(requests,5);
        assert.equal(controller.inspectConversation(source.conversationId).generation,rootAgain.generation);
        observations.contextRecovery={case:recovery,workId:cloneWork,sourceWorkId:originalWork,firstSource:result.sourceId,secondSource:repeat.sourceId,originPreserved:true,oldDescendantHeld:true,newDescendantValidated:true,physicalHistoriesVerified:true,actualSeparateContinuation:true};
    }
    await controller.close(); controller = await openController({ installationHome: home, completedResources: policy });
    assert.deepEqual(assistantTexts(await controller.getConversationHistory(source.conversationId)), markers.slice(0, 2));
    for (const [index, view] of [fork, clone].entries()) {
        assert.deepEqual(assistantTexts(await controller.getConversationHistory(view.conversationId)), index === 0 ? [markers[0], markers[2]] : [markers[0], markers[1], markers[3],...(recovery?[markers[4]]:[])]);
        assert.deepEqual(inspectData(view.conversationId).nativeSeed, seeds[index]); assert.deepEqual(inspectData(view.conversationId).contextOrigin, origins[index]);
    }
    assert.equal(requests, recovery?5:4); assert.equal(sockets, 0); assert.deepEqual(await nativeCheckpoint(sourceView.historyRef), sourceCheckpoint);
    observations.status = 'passed';
} finally {
    observations.syntheticRequests = requests; observations.socketAttempts = sockets;
    await fs.writeFile(evidence, JSON.stringify(observations, null, 2) + '\n');
    await controller?.close();
} }
await main();
console.log(JSON.stringify({ outcome: 'passed', syntheticRequests: requests, socketAttempts: sockets, evidence }));
