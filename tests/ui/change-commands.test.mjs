import test from 'node:test';import assert from 'node:assert/strict';
import {registryWorld,workLedger} from '../controller/change-registry-fixture.mjs';
import {HostCommands} from '../../dist/ui/host-commands.js';import {changeCommands} from '../../dist/ui/change-commands.js';
test('all-project UI registry finds original work after scope changes and detail preserves ledger and draft',async t=>{
 const f=await registryWorld(t),conversation=f.c.createConversation({projectId:'B'});f.c.setDraft({conversationId:conversation.conversationId,expectedRevision:0,text:'Keep 한국어 draft'});const before=workLedger(f.c),shown=[];let lists=0;
 const registry=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,choose:async(title,rows)=>{assert.match(title,/all projects/);lists++;return rows.find(row=>row.includes(f.works[0].workId));},show:async(title,text)=>shown.push({title,text})}));
 await registry.execute('/change',conversation.conversationId);assert.equal(lists,1);assert.match(shown[0].text,/Project: A/);assert.match(shown[0].text,/Owner request 0 한국어/);assert.match(shown[0].text,/Execution: 1 consumed \+ 0 reserved/);assert.match(shown[0].text,/Inspection does not retry work/);
 assert.equal(f.c.inspectConversation(conversation.conversationId).draft.text,'Keep 한국어 draft');assert.deepEqual(workLedger(f.c),before);
});
test('selection guards, explicit IDs and cancellation never begin or drive retained work',async t=>{
 const f=await registryWorld(t),conversation=f.c.createConversation();let current=true,shown=0;
 const host={controller:f.c,isCurrent:()=>current,show:async()=>shown++};const before=workLedger(f.c);
 await assert.rejects(new HostCommands(changeCommands({...host,choose:async(_title,rows)=>{current=false;return rows[0];}})).execute('/change',conversation.conversationId),/target changed/);
 current=true;const registry=new HostCommands(changeCommands({...host,choose:async()=>undefined}));assert.equal(await registry.execute('/change',conversation.conversationId),'cancelled');
 await registry.execute('/change inspect '+f.works[1].workId,conversation.conversationId);assert.equal(shown,1);await assert.rejects(registry.execute('/change start',conversation.conversationId),/not available/);assert.deepEqual(workLedger(f.c),before);
});
test('older/newer pages, refresh and project filters keep work identity explicit',async t=>{
    const f=await registryWorld(t),conversation=f.c.createConversation({projectId:'B'});const original=f.c.listChanges.bind(f.c),requests=[],steps=['older','newer','current','refresh','all','close'];
    f.c.listChanges=options=>{requests.push({...options});return original({...options,limit:1});};
    const registry=new HostCommands(changeCommands({controller:f.c,isCurrent:()=>true,show:async()=>assert.fail('Navigation opened work'),choose:async(_title,rows)=>{
        const action=steps.shift();return rows.find(row=>row.startsWith({older:'Older changes',newer:'Newer changes',current:'Current project',refresh:'Refresh this page',all:'All projects',close:'Close'}[action]));
    }}));
    const before=workLedger(f.c);assert.equal(await registry.execute('/change',conversation.conversationId),'cancelled');assert.equal(requests.length,6);
    assert.equal(requests[1].before,f.works[2].workId);assert.equal(requests[2].before,undefined);assert.equal(requests[3].projectId,'B');assert.equal(requests[4].projectId,'B');assert.equal(requests[5].projectId,undefined);assert.deepEqual(workLedger(f.c),before);
});
