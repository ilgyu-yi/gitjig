import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import test from 'node:test';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';
import { uiText } from '../../dist/ui/i18n.js';

const execute=promisify(execFile);
for (const [locale,stale,nested] of [
    ['en',false,false],['ko',false,false],['en','dialog',false],['en',false,true],['ko',false,true],['en','ancestor',true],
]) {
    test(`parent reaches only the live original ${nested?'grandchild':'child'} input in ${locale}${stale?' with stale '+stale:''}`,{timeout:20000},async t=>{
        const root=await temporaryDirectory('delegated-native-input');
        let passed=false;
        t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained delegated input fixture '+root);});
        const cfg={root,locale,stale,nested,confirm:locale==='ko'?'ctrl+r':'enter',home:path.join(root,'home'),start:path.join(root,'start'),
            expire:path.join(root,'expire'),expired:path.join(root,'expired'),receipt:path.join(root,'receipt'),
            draft:'Parent draft · 한국어 · retained', parentModelUnavailable:nested && locale==='ko'};
        const text=(id,values)=>uiText(locale,id,...values?[values]:[]);
        const confirm=cfg.confirm==='enter'?'\r':'\x12';
        const keys={key:'Ctrl+G',confirm:cfg.confirm};
        const open=text('delegated.inputKey',keys);
        const menu=text('delegated.inputMenu');
        const review=text('delegated.inputReview').split(/[.!?]/u)[0];
        const footer=text('footer.leave',{key:'Ctrl+G'});
        const returnKey=text('delegated.inputReturnKey',keys);
        const pick=(wait,send)=>({wait,send});
        const selectedLabel = label => [{
            sql: "SELECT json_extract(s.data,'$.userLabel') FROM conversation_state s JOIN interaction_view v ON v.selected=s.conversation",
            rows: [[label]],
        }];
        const navigate = !stale && locale === 'en';
        const parentSelected = selectedLabel('Assigning conversation');
        const liveDialog = {
            sql: "SELECT count(*) FROM conversation_state WHERE resource='RUNNING' AND json_array_length(json_extract(data,'$.dialogs'))=1",
            rows: [[1]],
        };
        const completeSelection = 'Original investigation'+confirm;
        const changed = text('delegated.inputChanged');
        const expireAncestor = {
            sql: `UPDATE conversation_state SET data=json_set(data,'$.continuationAuthorized',json('false'))
                WHERE conversation IN (SELECT target FROM conversation_assignments WHERE state='WAITING')`,
        };
        const expired = {path:cfg.expired,value:'done'};
        const steps=[
            {...pick(cfg.draft,''),releaseFile:cfg.start},
            ...(navigate ? [
                pick(open, '\x07c'),
                pick(text('navigation.title'), 'Unrelated conversation'+confirm),
                {...pick('Unrelated conversation','\x07c'), queries:selectedLabel('Unrelated conversation')},
                pick(text('navigation.searchPlaceholder'), 'Assigning conversation'+confirm),
            ] : []),
            {...pick(open,'\x07'), queries:parentSelected},
            pick(menu,confirm),pick(review,confirm),
            {...pick(footer,'\x07'), queries:parentSelected},pick(menu,confirm),pick(review,'\x1b'),
            {...pick(footer,'\x07'), queries:parentSelected},pick(menu,confirm),
            ...stale === 'ancestor' ? [
                {...pick(review,completeSelection), queries:[liveDialog], mutations:[expireAncestor]},
                {...pick(changed,''), queries:[...parentSelected,liveDialog], releaseFile:cfg.expire},
                {...pick('','\x07q'), waitFiles:[expired]},
            ] : stale === 'dialog' ? [
                {...pick(review,''),releaseFile:cfg.expire},
                {...pick('',completeSelection),waitFiles:[expired]},
                pick(changed,'\x07q'),
            ]:[
                pick(review,completeSelection),
                {...pick('Original delegated confirmation',confirm), queries:[{sql:
                    "SELECT json_array_length(json_extract(s.data,'$.dialogs')) FROM conversation_state s JOIN interaction_view v ON v.selected=s.conversation",
                    rows:[[1]]}]},
                pick(returnKey,'\x07'),
                pick(text('delegated.inputReturn'),confirm),
                pick(cfg.draft,'\x07q'),
            ],
        ];
        const fixture=path.join(root,'fixture.json'), driver=path.join(root,'terminal.json'), output=path.join(root,'terminal');
        await fs.writeFile(fixture,JSON.stringify(cfg));
        await fs.writeFile(driver,JSON.stringify({steps,output,database:path.join(cfg.home,'state','controller.sqlite'),
            columns:locale==='ko'?76:100,rows:30,timeoutSeconds:12,noForceKill:true,
            command:[process.execPath,path.resolve('tests/ui/delegated-native-input-child.mjs'),fixture],
            env:{HOME:root,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}}));
        const terminal=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',driver],{timeout:15500,maxBuffer:2**20})).stdout);
        assert.deepEqual([terminal.exitCode,terminal.stages,terminal.terminalRestored],[0,steps.length,true]);
        assert.deepEqual(JSON.parse(await fs.readFile(cfg.receipt,'utf8')),{answer:!stale,openCount:1});
        const transcript = await fs.readFile(output);
        const progress = JSON.parse(await fs.readFile(output+'.progress.json', 'utf8'));
        const selectStage = steps.findIndex(step => step.send === completeSelection);
        const beforeSelection = transcript.subarray(0, progress.actionOutputOffsets[selectStage]);
        assert.ok(!beforeSelection.includes('Original delegated confirmation'));
        if (cfg.parentModelUnavailable) assert.ok(beforeSelection.includes(text('model.footerExternalRequired')));
        if (stale) assert.ok(!transcript.includes('Original delegated confirmation'));
        passed=true;
    });
}

for (const [locale,removed] of [['en',false],['ko',false],['en',true]]) test(
    `reopened ${locale} parent identifies interrupted grandchild input with ${removed?'confirmed':'unconfirmed'} cleanup`, {timeout:25000}, async t => {
    const root = await temporaryDirectory('delegated-native-input-restart');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive:true,force:true});
        else t.diagnostic('Retained interrupted dialog fixture '+root);
    });
    const cfg = {root, locale, nested:true, confirm:'enter', home:path.join(root,'home'), start:path.join(root,'start'),
        crash:path.join(root,'crash'), crashProof:path.join(root,'crash-proof'), draft:'Parent draft · 한국어 · retained'};
    const fixture = path.join(root,'fixture.json');
    await fs.writeFile(fixture, JSON.stringify(cfg));
    const env = {HOME:root,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
        LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
    const runTerminal = async (name, args, steps) => {
        const driver = path.join(root,name+'.json');
        const output = path.join(root,name+'.terminal');
        await fs.writeFile(driver, JSON.stringify({command:[process.execPath,...args], env, steps, output,
            database:path.join(cfg.home,'state','controller.sqlite'),columns:106,rows:34,timeoutSeconds:7,noForceKill:true}));
        const result = JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',driver],{timeout:10000})).stdout);
        return {result, output};
    };
    const tText = (id, values) => uiText(locale,id,...values?[values]:[]);
    const before = await runTerminal('before',[path.resolve('tests/ui/delegated-native-input-child.mjs'),fixture], [
        {wait:cfg.draft,releaseFile:cfg.start,send:''},
        {wait:tText('delegated.inputKey',{key:'Ctrl+G',confirm:'enter'}),send:'\x07\r'},
        {wait:tText('delegated.inputReview').split(/[.!?]/u)[0],send:'Original investigation\r'},
        {wait:'Original delegated confirmation',releaseFile:cfg.crash,send:'',queries:[{
            sql:"SELECT json_array_length(json_extract(s.data,'$.dialogs')) FROM conversation_state s JOIN interaction_view v ON v.selected=s.conversation",
            rows:[[1]],
        }]},
    ]);
    assert.deepEqual([before.result.exitCode,before.result.stages],[-9,4]);
    const proof = JSON.parse(await fs.readFile(cfg.crashProof,'utf8'));
    if (removed) {
        const nonce = randomUUID();
        const journal = path.join(cfg.home,'state','runtime',nonce+'.json');
        await fs.writeFile(journal, JSON.stringify({version:1,context:'DIALOG_CONTROLLED',nonce,name:'gitjig-'+nonce,
            workId:proof.work,runId:proof.run,state:'removed'}), {mode:0o600});
    }
    const stopped = tText('delegated.inputInterrupted');
    const recovery = tText('delegated.inputRecovery');
    const state = removed ? 'INTERRUPTED' : 'UNKNOWN';
    const exact = [
        {sql:'SELECT count(*) FROM runs',rows:[[3]]},
        {sql:'SELECT count(*) FROM works',rows:[[3]]},
        {sql:'SELECT count(*) FROM conversation_assignments',rows:[[2]]},
        {sql:'SELECT count(*) FROM conversation_results WHERE work=?',params:[proof.work],rows:[[0]]},
        {sql:`SELECT w.state,r.phase,r.reservation,json_extract(t.data,'$.dialogs') FROM runs r JOIN works w ON w.id=r.work
            JOIN conversation_state t ON t.work=w.id WHERE w.id=? AND r.id=? AND t.conversation=?`,
            params:[proof.work,proof.run,proof.leaf],rows:[[state,state,'consumed','[]']]},
    ];
    const cli = ['--import',path.resolve('tests/ui/readiness-no-execution.mjs'),
        path.resolve('dist/cli/entry.js'),'conversation','ui','--home',cfg.home,'--conversation',proof.parent];
    const parentDraft = {assertDraft:cfg.draft,expectedInputs:3,expectedSelected:proof.parent,queries:exact};
    const after = await runTerminal('after',cli, [
        {wait:stopped,send:'\x07\r',...parentDraft},
        {wait:recovery,send:'Original investigation\r'},
        {wait:proof.run,send:'\r',queries:exact},
        {wait:tText('workRecovery.title',{id:proof.work,state}),send:'\x1b',queries:exact},
        {wait:cfg.draft,send:'\x07q',...parentDraft},
    ]);
    assert.deepEqual([after.result.exitCode,after.result.stages,after.result.terminalRestored],[0,5,true]);
    const transcript = await fs.readFile(after.output,'utf8');
    assert.ok(!transcript.includes('Original delegated confirmation'));
    assert.ok(transcript.includes(tText(removed ? 'delegated.inputInterruptedSettled' : 'workRecovery.settlementUnconfirmed')));
    if (locale === 'ko' || removed) {
        // Restore only the dialog representation left by the earlier startup implementation.
        const db = new DatabaseSync(path.join(cfg.home,'state','controller.sqlite'));
        try {
            const {requestId} = db.prepare("SELECT json_extract(data,'$.interruptedOwnerDialog.requestId') AS requestId FROM runs WHERE id=?").get(proof.run);
            assert.equal(requestId, '1');
            db.prepare("UPDATE runs SET data=json_remove(data,'$.interruptedOwnerDialog') WHERE id=?").run(proof.run);
            db.prepare("UPDATE conversation_state SET data=json_set(data,'$.dialogs',json_array(?)) WHERE conversation=?").run(requestId,proof.leaf);
        } finally { db.close(); }
    }
    const repeat = await runTerminal('repeat',cli,[{wait:stopped,send:'\x07q',...parentDraft}]);
    assert.deepEqual([repeat.result.exitCode,repeat.result.stages,repeat.result.terminalRestored],[0,1,true]);
    passed = true;
});
