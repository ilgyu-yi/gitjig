import test from 'node:test';
import assert from 'node:assert/strict';
import {ordinaryTaskWorld as world} from './ordinary-task-cancellation-fixture.mjs';
import {workCommands} from '../../dist/ui/work-commands.js';

const ledger=s=>Object.fromEntries(['sources','works','budgets','conversation_inputs','conversation_assignments','conversation_dependencies'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]));
for(const action of ['cancel','back','stale'])test(`ordinary assigned child exposes explicit cancellation with ${action} control`,async t=>{
    const f=await world(t);assert.equal(f.c.inspectWork(f.child.workId).source.origin.kind,'agent-assignment');
    let choices=0,expected=ledger(f.c.store);const notices=[];
    const command=workCommands({controller:f.c,isCurrent:()=>true,activate:async()=>assert.fail('Unexpected navigation'),input:async()=>undefined,notice:text=>notices.push(text),
        choose:async(_title,rows)=>{
            if(choices++===0){assert.ok(rows.includes('Review cancellation of this original work'));return 'Review cancellation of this original work';}
            if(choices===2){assert.equal(rows[0],'Back without cancellation');return action==='back'?rows[0]:'Cancel this original work and its delegated tasks';}
            return undefined;
        },show:async(_title,text)=>{
            assert.ok(text.includes(f.child.workId));assert.match(text,/Parent and sibling work are kept/);
            if(action==='stale'){await f.c.queueConversationInput({conversationId:f.child.conversationId,expectedGeneration:f.c.inspectConversation(f.child.conversationId).generation,text:'New owner direction',mode:'idle'});expected=ledger(f.c.store);}
        }})[0];
    if(action==='stale')await assert.rejects(command.run(f.child.workId,f.parent),/conversation changed/);
    else assert.equal(await command.run(f.child.workId,f.parent),action==='back'?'cancelled':'completed');
    if(action==='cancel'){
        assert.equal(f.c.store.one('SELECT state FROM conversation_assignments WHERE id=?',f.child.assignmentId).state,'CANCELLED');
        assert.equal(f.c.store.one('SELECT state FROM conversation_dependencies WHERE assignment=?',f.child.assignmentId).state,'CANCELLED');
        assert.equal(f.c.inspectWork(f.c.inspectConversation(f.parent).workId).state,'ACTIVE');assert.ok(notices.length);
        await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});
    }else assert.deepEqual(ledger(f.c.store),expected);
    f.pass();
});
