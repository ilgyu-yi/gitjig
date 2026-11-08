import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {managedWorld} from './managed-change-fixture.mjs';
import {newConversationAction} from '../../dist/ui/new-conversation.js';
import {errorCommands} from '../../dist/ui/error-commands.js';
import {failurePresentation} from '../../dist/ui/failure-details.js';
import {uiText} from '../../dist/ui/i18n.js';

function language(f,replyLanguage){
    const view=f.c.inspectConversation(f.cid),old=f.c.getConversationLanguage(f.cid);
    f.c.setConversationLanguage({conversationId:f.cid,expectedGeneration:view.generation,expectedRevision:old.revision,replyLanguage});
}

test('a held project destination that changes during saved defaults allocates nothing', async t => {
    const f = await managedWorld(t);
    const root = await fs.mkdtemp(path.join(f.root, 'destination-'));
    const replacement = await fs.mkdtemp(path.join(f.root, 'replacement-'));
    const project = await f.c.registerProject({ id: 'Q', sourceRoot: root });
    const catalogue = f.models.catalogue.bind(f.models);
    let prepared = false;
    f.models.catalogue = async () => {
        const result = await catalogue();
        f.c.store.run('UPDATE projects SET root=? WHERE id=?', replacement, project.id);
        prepared = true;
        return result;
    };
    const h = host(f, 'en', { hostLanguage: 'en' });
    const before = f.c.listConversations();
    await assert.rejects(newConversationAction(h.value, { project, validateSource() {} }, f.cid), /selected project registration changed/);
    assert.equal(prepared, true);
    assert.deepEqual(f.c.listConversations(), before);
    assert.deepEqual(h.activated, []);
    f.pass();
});
function host(f,locale,overrides={}){
    const notices=[],activated=[],dialogs=[];
    return {notices,activated,dialogs,value:{controller:f.c,hostLanguage:locale==='ko'?'en':'ko',isCurrent:()=>true,ready:()=>true,
        choose:async()=>{throw Error('Stable choice adapter expected');},
        chooseItems:async(title,items)=>{dialogs.push({title,items});return 'root';},
        create:(projectId,validate)=>f.models.newConversation({projectId},validate),
        activate:async id=>{activated.push(id);},notice:text=>notices.push(text),...overrides}};
}
for(const locale of ['en','ko']){
    const copy=locale==='ko'?{title:'새 독립 대화 · 범위 선택',project:'현재 프로젝트',root:'프로젝트 미지정 대화',cancel:'취소',opened:'독립 대화를 열었습니다',changed:'원본 대화가 변경되었습니다',retained:'대화가 생성되었습니다'}:{title:'New independent conversation · choose scope',project:'Current project',root:'Unbound control conversation',cancel:'Cancel',opened:'Independent conversation opened',changed:'New-conversation source changed',retained:'was created'};
    test(`independent scope choices and completion use captured ${locale} with stable values`,async t=>{
        const f=await managedWorld(t);language(f,locale);const before=f.c.inspectConversation(f.cid),h=host(f,locale);
        assert.equal(await newConversationAction(h.value,'',f.cid),'completed');
        assert.equal(h.dialogs[0].title,copy.title);assert.deepEqual(h.dialogs[0].items.map(v=>v.value),['project','root','cancel']);
        for(const [index,label] of [copy.project,copy.root,copy.cancel].entries())assert.ok(h.dialogs[0].items[index].label.includes(label));
        assert.ok(h.dialogs[0].items[0].label.includes('P'));assert.ok(h.notices[0].includes(copy.opened));
        assert.equal(f.c.inspectConversation(h.activated[0]).projectId,null);assert.deepEqual(f.c.inspectConversation(f.cid),before);f.pass();
    });
    test(`independent automatic UI language uses captured host ${locale}`,async t=>{
        const f=await managedWorld(t),h=host(f,locale,{hostLanguage:locale});
        assert.equal(f.c.getConversationLanguage(f.cid).replyLanguage,null);
        assert.equal(await newConversationAction(h.value,'',f.cid),'completed');
        assert.equal(h.dialogs[0].title,copy.title);assert.ok(h.notices[0].includes(copy.opened));
        assert.equal(f.c.getConversationLanguage(f.cid).replyLanguage,null);f.pass();
    });
    test(`independent ${locale} cancellation allocates no conversation`,async t=>{
        const f=await managedWorld(t);language(f,locale);const before=f.c.listConversations(),h=host(f,locale,{chooseItems:async()=> 'cancel'});
        assert.equal(await newConversationAction(h.value,'',f.cid),'cancelled');assert.deepEqual(f.c.listConversations(),before);assert.deepEqual(h.notices,[]);assert.deepEqual(h.activated,[]);f.pass();
    });
    for(const boundary of ['picker','defaults'])test(`independent ${locale} entry rejects language drift during ${boundary}`,async t=>{
        const f=await managedWorld(t);language(f,locale);const before=f.c.listConversations().length,other=locale==='ko'?'en':'ko';
        const h=host(f,locale,boundary==='picker'?{chooseItems:async()=>{language(f,other);return 'root';}}:{});
        if(boundary==='defaults'){const original=f.models.catalogue.bind(f.models);f.models.catalogue=async()=>{const result=await original();language(f,other);return result;};}
        await assert.rejects(newConversationAction(h.value,boundary==='picker'?'':'root',f.cid),e=>e.message.includes(copy.changed));
        assert.equal(f.c.listConversations().length,before);assert.deepEqual(h.activated,[]);assert.deepEqual(h.notices,[]);f.pass();
    });
    test(`independent ${locale} postcreation language drift retains identity and captured recovery language`,async t=>{
        const f=await managedWorld(t);language(f,locale);const before=f.c.listConversations().length;let retained;
        const h=host(f,locale,{create:async(projectId,validate)=>{const result=await f.models.newConversation({projectId},validate);retained=result.conversationId;language(f,locale==='ko'?'en':'ko');return result;}});
        await assert.rejects(newConversationAction(h.value,'root',f.cid),e=>e.code==='CONVERSATION_CREATED'&&e.message.includes(copy.retained)&&e.message.includes(retained)&&e.recovery.includes('/resume '+retained));
        assert.equal(f.c.listConversations().length,before+1);assert.equal(f.c.inspectConversation(retained).workId,null);assert.deepEqual(h.activated,[]);f.pass();
    });
    test(`independent ${locale} recovery opens only the retained destination`, async t => {
        const f = await managedWorld(t);
        language(f, locale);
        f.c.setDraft({conversationId: f.cid, expectedRevision: 0, text: 'Original draft 한글'});
        const before = f.c.inspectConversation(f.cid), count = f.c.listConversations().length;
        let retained, failure, selected = f.cid, canOpen = false;
        const h = host(f, locale, {
            isCurrent: id => id === selected,
            activate: async id => { retained = id; throw Error('Controlled activation failure'); },
        });
        await assert.rejects(newConversationAction(h.value, 'root', f.cid), error => {
            failure = failurePresentation(error);
            return failure.detail.includes('Controlled activation failure') && failure.detail.includes('/resume ' + retained);
        });
        const action = uiText(locale, 'error.openCreatedConversation');
        const run = (choose, diagnostic = failure) => errorCommands({
            controller: f.c, isCurrent: h.value.isCurrent, failure: () => diagnostic, assertAvailable() {},
            choose, notice: h.value.notice,
            openConversation: async id => {
                if (!canOpen) throw Error('Controlled navigation retry failure');
                selected = id;
            },
            execute: () => assert.fail('Recovery must use navigation'),
        })[0].run('', f.cid);
        assert.equal(await run(async (_title, rows) => {
            assert.ok(rows.includes(action));
            return uiText(locale, 'error.back');
        }), 'cancelled');
        assert.equal(selected, f.cid);
        const forged = failurePresentation({code: 'CONVERSATION_CREATED', message: 'Untrusted', created: failure.createdConversation});
        assert.equal(await run(async (_title, rows) => {
            assert.ok(!rows.includes(action));
        }, forged), 'cancelled');
        assert.equal(await run(async () => action), 'cancelled');
        assert.equal(selected, f.cid);
        assert.equal(h.notices.at(-1), uiText(locale, 'error.createdConversationOpenFailed'));
        canOpen = true;
        assert.equal(await run(async () => action), 'completed');
        assert.equal(selected, retained);
        selected = f.cid;
        assert.equal(await run(async (_title, rows) => {
            assert.ok(rows.includes(action));
            await f.c.archiveConversation({conversationId: retained, expectedGeneration: f.c.inspectConversation(retained).generation});
            return action;
        }), 'cancelled');
        assert.equal(selected, f.cid);
        assert.equal(h.notices.at(-1), uiText(locale, 'error.createdConversationChanged'));
        assert.deepEqual(f.c.inspectConversation(f.cid), before);
        assert.equal(f.c.store.one('SELECT COUNT(*) AS n FROM conversations').n, count + 1);
        assert.equal(f.calls.length, 0);
        f.pass();
    });
}
