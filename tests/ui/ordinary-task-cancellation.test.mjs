import test from 'node:test';
import assert from 'node:assert/strict';
import {ordinaryTaskWorld as world} from './ordinary-task-cancellation-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';
import {workCommands} from '../../dist/ui/work-commands.js';

const ledger=s=>Object.fromEntries(['sources','works','budgets','conversation_inputs','conversation_assignments','conversation_dependencies'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]));
for(const locale of ['en','ko'])for(const action of ['cancel','back','escape','stale'])test(`${locale} ordinary assigned child exposes explicit cancellation with ${action} control`,async t=>{
    const f=await world(t);assert.equal(f.c.inspectWork(f.child.workId).source.origin.kind,'agent-assignment');
    let choices=0,expected=ledger(f.c.store);const notices=[];
    const command=workCommands({controller:f.c,locale:()=>locale,isCurrent:()=>true,activate:async()=>assert.fail('Unexpected navigation'),input:async()=>undefined,notice:text=>notices.push(text),
        choose:async(title,rows)=>{
            if(choices++===0){assert.ok(rows.includes(uiText(locale,'workRecovery.cancelWork')));return uiText(locale,'workRecovery.cancelWork');}
            if(choices===2){
                if(action==='escape'){assert.equal(title,uiText(locale,'workRecovery.title',{id:f.child.workId,state:'ACTIVE'}));return undefined;}
                assert.equal(rows[0],uiText(locale,'workRecovery.backCancel'));return action==='back'?rows[0]:uiText(locale,'workRecovery.confirmCancel');
            }
            return undefined;
        },show:async(_title,text,primary)=>{
            assert.ok(text.includes(f.child.workId));assert.ok(text.includes(uiText(locale,'workRecovery.cancelScope')));assert.ok(_title.includes(locale==='ko'?'1/':'page 1 of'));
            if(action==='stale'){await f.c.queueConversationInput({conversationId:f.child.conversationId,expectedGeneration:f.c.inspectConversation(f.child.conversationId).generation,text:'New owner direction',mode:'idle'});expected=ledger(f.c.store);}
            if(action!=='escape')await primary?.run();
        }})[0];
    if(action==='stale')await assert.rejects(command.run(f.child.workId,f.parent),new RegExp(uiText(locale,'workRecovery.cancelConversationChanged').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    else assert.equal(await command.run(f.child.workId,f.parent),action==='cancel'?'completed':'cancelled');
    if(action==='cancel'){
        assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignmentId).state,'CANCELLED');
        assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',f.child.assignmentId).state,'CANCELLED');
        assert.equal(f.c.inspectWork(f.c.inspectConversation(f.parent).workId).state,'ACTIVE');assert.ok(notices.length);
        await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});
    }else assert.deepEqual(ledger(f.c.store),expected);
    f.pass();
});
