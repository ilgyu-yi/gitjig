import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {closedRoleFixture} from './closed-role-feedback-fixture.mjs';
import {ApplicationKeybindings} from '../../dist/app/keybindings.js';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);
for(const locale of ['en','ko'])for(const mode of ['feedback','held-work','pending','unknown','custom-key'])
test(`actual ${locale} role composer describes feedback without hiding ${mode} state`,{timeout:18000},async t=>{
    const root=await temporaryDirectory('role-composer'),{c,cid,home,workId}=await closedRoleFixture(root,locale,{configuredModel:false});let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained role composer '+root);});
    if(mode==='pending')await c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:0,text:'Earlier retained feedback',mode:'idle'});
    if(mode==='unknown')c.store.run('UPDATE conversation_state SET resource=? WHERE conversation=?','UNKNOWN',cid);
    if(mode==='held-work'){
        const data=JSON.parse(c.store.one('SELECT data FROM change_state WHERE work=?',workId).data);
        c.store.run('UPDATE change_state SET phase=?,data=? WHERE work=?','BLOCKED',JSON.stringify({...data,blocked:['CONTROLLED_TASK_HOLD'],nextAction:'Inspect original task',resumeStage:'plan'}),workId);
    }
    if(mode==='custom-key'){
        const keys = new ApplicationKeybindings(c).file;
        await fs.mkdir(path.dirname(keys),{recursive:true,mode:0o700});
        await fs.writeFile(keys,JSON.stringify({'tui.input.submit':'ctrl+t'}),{mode:0o600});
    }
    await c.close();
    const observation=path.join(root,'frame.json'),output=path.join(root,'terminal'),config=path.join(root,'driver.json');
    const hint=uiText(locale,'input.roleFeedbackHint',{work:workId}),key=mode==='custom-key'?'ctrl+t':'Enter',footer=uiText(locale,'footer.roleFeedback',{submit:key});
    const idle=['feedback','held-work','custom-key'].includes(mode);
    const initial={editorFocused:true,draft:'',baseline:true,contains:idle?[hint,footer,...(mode==='held-work'?[uiText(locale,'task.change.blocked')]:[])]:[uiText(locale,mode==='unknown'?'task.resource.UNKNOWN':'activity.retained')],absent:idle?[uiText(locale,'footer.setup')]:[hint,footer],send:mode==='feedback'?'Correction @missing.txt\x1b\r':'\x07q'};
    if(mode==='custom-key')initial.send='/help';
    const steps=[initial,...(mode==='feedback'?[
        {editorFocused:true,draft:'Correction @missing.txt',contains:['File context unavailable',uiText(locale,'footer.setup')],absent:[hint,footer],unchanged:true,send:'\x07q'},
    ]:mode==='custom-key'?[
        {editorFocused:true,draft:'/help',contains:[uiText(locale,'footer.setup')],absent:[hint,footer],unchanged:true,send:'\x15!do-not-execute'},
        {editorFocused:true,draft:'!do-not-execute',contains:[uiText(locale,'footer.setup')],absent:[hint,footer],unchanged:true,send:'\x15//literal input'},
        {editorFocused:true,draft:'//literal input',contains:[hint,footer],absent:[uiText(locale,'footer.setup')],unchanged:true,send:'\x15'},
        {editorFocused:true,draft:'',contains:[hint,footer],absent:[uiText(locale,'footer.setup')],unchanged:true,send:'\x07q'},
    ]:[])];
    await fs.writeFile(config,JSON.stringify({cid,observation,output,steps,timeoutSeconds:10,command:[process.execPath,'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation}}));
    try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:14000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
        const frames=JSON.parse(await fs.readFile(output+'.frames.json','utf8'));assert.equal(frames.error,null);assert.ok(frames.snapshots.every(row=>row.ledger===frames.snapshots[0].ledger),'Display and failed plain-input capture preserve original work/input/budget ledger');passed=true;
    }catch(error){t.diagnostic((await fs.readFile(output+'.frames.json','utf8').catch(()=>'' )).slice(-4500));throw error;}
});
