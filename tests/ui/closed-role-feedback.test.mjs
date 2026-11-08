import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {closedRoleFixture} from './closed-role-feedback-fixture.mjs';
import {inputCommands,isClosedRoleFeedback,reviewConversationInputs} from '../../dist/ui/input-commands.js';
import {uiText} from '../../dist/ui/i18n.js';

for (const mode of ['en','ko','back','stale','target-changed','held','direct','direct-back','direct-stale','direct-escape']) test('original closed-role feedback recovery: '+mode,async t=>{
    const root=await temporaryDirectory('closed-role-feedback'),f=await closedRoleFixture(root,mode==='ko'?'ko':'en'),{c,cid,workId}=f;let passed=false;
    t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained feedback fixture '+root);});
    const direct=mode.startsWith('direct'), earlier=direct
        ? await c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:0,text:'Earlier separate feedback',mode:'idle'}) : undefined;
    const receipt=await c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:0,text:'Exact owner correction',mode:'idle'});
    if(mode==='held')c.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?','UNKNOWN',cid);
    const input=c.inspectConversationInputs(cid).find(row=>row.inputId===receipt.inputId);assert.equal(isClosedRoleFeedback(input),mode!=='held');
    const newer='Newer unsubmitted draft';c.setDraft({conversationId:cid,expectedRevision:c.inspectConversation(cid).draft.revision,text:newer});
    const tables=['sources','conversation_directions','works','runs','role_launches','obligations','budgets','capacity_leases'];
    const snapshot=()=>Object.fromEntries(tables.map(name=>[name,c.store.all('SELECT * FROM '+name+' ORDER BY rowid')])),before=snapshot();
    let selected=0,current=true,inspected=0,acknowledged=0,detail='',notice='';const locale=mode==='ko'?'ko':'en';
    const context={acknowledgeSubmission:()=>{
        assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?',receipt.inputId).state,'CONFLICTED');
        assert.equal(inspected,0);acknowledged++;
    }};
    const host={controller:c,isCurrent:()=>current,locale:()=>locale,
        choose:async(_title,rows)=>{
            assert.notEqual(mode,'direct-escape','Closing the exact review opened an action menu');
            selected++;
            if(!direct && selected===1)return rows[0];
            if(mode==='held')return 'Back';
            if(selected>2)return 'Back';
            if(mode==='back' || mode==='direct-back')return 'Back without changes';
            assert.deepEqual(rows,[uiText(locale,'input.recoveryBackUnchanged'),uiText(locale,'input.keepFeedback')]);
            if(mode==='stale' || mode==='direct-stale')c.store.run('UPDATE conversation_inputs SET data=? WHERE id=?',JSON.stringify({routeError:'Changed after review'}),receipt.inputId);
            if(mode==='target-changed')current=false;
            return rows[1];
        },show:async(_title,text,primary)=>{detail+=text;if(mode!=='direct-escape')await primary?.run();},retry:async()=>assert.fail('A closed role cannot retry'),
        inspectWork:async(target,id)=>{assert.equal(target,cid);assert.equal(id,workId);inspected++;return 'cancelled';},notice:text=>{notice=text;}};
    const review=direct ? reviewConversationInputs(host,cid,{submittedFeedback:input}) : inputCommands(host)[0].run('',cid,context);
    if(['stale','target-changed','direct-stale'].includes(mode))await assert.rejects(review,/changed/i);
    else assert.equal(await review,['en','ko','direct'].includes(mode)?'completed':'cancelled');
    const acted=['en','ko','direct'].includes(mode);assert.equal(inspected,acted?1:0);
    assert.equal(acknowledged,acted && !direct?1:0);
    assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?',receipt.inputId).state,acted?'CONFLICTED':'QUEUED');
    assert.deepEqual(snapshot(),before,'Feedback delivery recovery never rewrites task evidence, directions or allowance');
    assert.equal(c.inspectConversation(cid).draft.text,newer);assert.match(detail,/Exact owner correction/);
    if(earlier){
        assert.equal(selected,mode==='direct-escape'?0:1);
        assert.doesNotMatch(detail,/Earlier separate feedback/);
        assert.equal(c.store.one('SELECT state FROM conversation_inputs WHERE id=?',earlier.inputId).state,'QUEUED');
    }
    assert.equal(c.store.one('SELECT data FROM conversation_directions WHERE source=?',receipt.sourceId).data.includes('"effectHold":true'),true);
    if(acted)assert.equal(notice,uiText(locale,'input.feedbackKept',{work:workId}));passed=true;
});

for(const change of ['role-removed','role-replaced','work-rebound','run-rebound','ordinary-to-role'])test('file capture refuses same-generation source change: '+change,async t=>{
    const root=await temporaryDirectory('feedback-source-race'),{c,cid,workId}=await closedRoleFixture(root);let passed=false;
    const original=c.store.one('SELECT * FROM conversation_state WHERE conversation=?',cid);
    t.after(async()=>{c.store.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?',original.work,original.data,cid);await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained source race '+root);});
    const other=change==='work-rebound'?await c.beginChange({projectId:'P',request:'Separate original task'}):null;
    const data=JSON.parse(original.data);
    if(change==='ordinary-to-role'){const {role,...ordinary}=data;c.store.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?',null,JSON.stringify(ordinary),cid);}
    const text='Correction belongs to the original selected role';const draft=c.setDraft({conversationId:cid,expectedRevision:c.inspectConversation(cid).draft.revision,text});
    const tables=['sources','conversation_inputs','conversation_directions','runs','budgets','obligations'];
    const snapshot=()=>Object.fromEntries(tables.map(name=>[name,c.store.all('SELECT * FROM '+name+' ORDER BY rowid')])),before=snapshot();
    const pending=c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:0,draftRevision:draft.revision,text,mode:'idle'});
    if(change==='role-removed'){const {role,...removed}=data;c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify(removed),cid);}
    if(change==='role-replaced')c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...data,role:'planner'}),cid);
    if(change==='work-rebound')c.store.run('UPDATE conversation_state SET work=? WHERE conversation=?',other.workId,cid);
    if(change==='run-rebound')c.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...data,runId:'CONTROLLED_DIFFERENT_RUN'}),cid);
    if(change==='ordinary-to-role')c.store.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?',workId,original.data,cid);
    await assert.rejects(pending,/Input target or exact draft changed during file capture/);
    assert.deepEqual(snapshot(),before,'Source drift admits no input, direction, source or execution');assert.equal(c.inspectConversation(cid).draft.text,text);passed=true;
});
