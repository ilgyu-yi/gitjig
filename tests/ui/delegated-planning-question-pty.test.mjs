import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';
import { uiText } from '../../dist/ui/i18n.js';

const execute = promisify(execFile);
for (const [locale,nested,mode] of [['en',false,'historical'],['ko',true,'answer'],['en',true,'stale'],['ko',false,'archived']]) test(
    `the ${locale} originating parent reviews original ${nested?'nested':'direct'} planning questions · ${mode}`,{timeout:22000},async t=>{
    const root=await temporaryDirectory('delegated-planning-question');
    let passed=false;
    t.after(async()=> {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained planning question '+root);
    });
    const cfg={root,home:path.join(root,'home'),locale,nested,ready:path.join(root,'ready'),question:'Choose the intended consumer behavior',
        draft:'Original parent draft · 한국어',replyDraft:'Original role draft · 한국어',archived:mode==='archived',
        answer:mode==='answer'?'값 3을 선택합니다. Keep the original consumer.':null};
    const fixture=path.join(root,'fixture.json'),driver=path.join(root,'driver.json'),output=path.join(root,'terminal');
    const tText=id=>uiText(locale,id);
    const lead=tText('delegated.planningQuestion');
    const returnLabel=tText('delegated.inputReturn');
    const reply=tText('result.planningClarificationReply');
    const keepFeedback=tText('input.keepFeedback');
    const steps=cfg.archived ? [
        {wait:lead,send:'\x07\r'},
        {wait:tText('result.planningClarificationReplyUnavailable').split('.')[0],send:'\x1b'},
        {wait:cfg.draft,send:'\x07q'},
    ] : [
        ...mode==='historical' ? [
            {wait:lead,send:'\x07r'},
            {wait:tText('delegated.resultsTitle'),send:'Consumer exports3\r'},
            {wait:tText('delegated.resultTitle'),send:'\x1b'},
            {wait:tText('delegated.resultsTitle'),send:'\x1b'},
        ] : [],
        {wait:lead,send:'\x07\r'},
        {wait:cfg.question,send:'\x1b'},
        {wait:cfg.draft,send:'\x07\r'},
        {wait:cfg.question,send:'\r'},
        ...mode==='stale' ? [
            {wait:reply,send:reply+'\r',mutations:[{
                sql:"UPDATE role_outputs SET raw=raw||' ' WHERE id=(SELECT json_extract(c.data,'$.planningClarification.outputId') FROM change_state c LIMIT 1)",
            }]},
            {wait:tText('delegated.resultChanged'),send:'\x07q'},
        ] : [
            {wait:reply,send:reply+'\r'},
            {wait:cfg.replyDraft,send:cfg.answer?'\x15'+cfg.answer+'\x1b\r':'\x07'},
            ...(cfg.answer ? [
                {wait:tText('input.recoveryFeedbackNext').split('.')[0],send:'\r'},
                {wait:tText('input.feedbackTitle'),send:keepFeedback+'\r'},
                {wait:tText('workRecovery.backToSource'),send:'\x1b'},
                {wait:returnLabel,send:'\x07'},
            ] : []),
            {wait:returnLabel,send:'\r'},
            {wait:cfg.draft,send:'\x07q'},
        ],
    ];
    await fs.writeFile(fixture,JSON.stringify(cfg));
    await fs.writeFile(driver,JSON.stringify({steps,output,database:path.join(cfg.home,'state','controller.sqlite'),columns:110,rows:40,timeoutSeconds:10,noForceKill:true,
        command:[process.execPath,path.resolve('tests/ui/delegated-planning-question-child.mjs'),fixture],
        env:{HOME:root,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}}));
    const terminal=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',driver],{timeout:13500,maxBuffer:2**20})).stdout);
    assert.deepEqual([terminal.exitCode,terminal.stages,terminal.terminalRestored],[0,steps.length,true]);
    const transcript=await fs.readFile(output);
    const proof=JSON.parse(await fs.readFile(cfg.ready,'utf8'));
    if (!cfg.archived) assert.ok(transcript.includes(proof.outputId));
    if (cfg.archived) assert.ok(!transcript.includes(reply));
    const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
    assert.ok(!transcript.subarray(0,progress.actionOutputOffsets[0]).includes(cfg.question));
    passed=true;
});

for (const [locale,held,unverified] of [['en',false],['ko',false],['ko',true],['en',false,true]]) test(
    `the ${locale} owner asks to continue the original assignment ${unverified?'with an unreadable result':held?'with a decision hold':'within existing authority'}`,{timeout:22000},async t=>{
    const root=await temporaryDirectory('delegated-owner-continuation');
    let passed=false;
    t.after(async()=> {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained owner continuation '+root);
    });
    const cfg={root,home:path.join(root,'home'),locale,held,unverified,continuation:true,ready:path.join(root,'ready'),
        initial:'Delegate the original project work.', question:'Choose the intended consumer behavior',
        draft:'Keep this unsent draft · 한국어',
        diagnose:locale==='ko'?'원래 맡긴 작업은 왜 멈췄나요?':'Why did the task I delegated stop?',
        resume:locale==='ko'?'기존 지시를 유지하고 원래 맡긴 작업을 이어서 진행해 주세요.':'Please continue the task I delegated under the existing instructions.',
        diagnosed:unverified?'The current outcome for the original assignment could not be verified.':held?'독립 계획 검토에서 사용자 판단이 필요합니다.':locale==='ko'?'계획 검토 응답의 형식이 유효하지 않아 원래 작업이 멈췄습니다.':'The original task stopped because the planning review returned an invalid response.',
        finished:unverified?'Open the retained results for the original assignment before deciding how to continue.':held?'원래 작업의 계획 질문에 먼저 답해야 합니다.':locale==='ko'?'같은 위임의 이어서 진행 요청이 접수됐습니다.':'The request to continue the same assignment was accepted.'};
    const fixture=path.join(root,'fixture.json'),driver=path.join(root,'driver.json'),output=path.join(root,'terminal');
    const untouched = {sql:"SELECT count(*) FROM conversation_inputs WHERE mode='reentry'",rows:[[0]]};
    const childRuns = count => ({
        sql:"SELECT count(*) FROM runs r JOIN conversation_assignments a ON a.work=r.work WHERE json_extract(a.data,'$.operation')='change'",
        rows:[[count]],
    });
    const originalRuns=childRuns(held?4:3), finalRuns=childRuns(unverified?3:held?4:5);
    const settled = {sql:`SELECT count(*) FROM conversation_inputs i JOIN conversation_assignments a ON a.work=i.work
        WHERE i.mode='reentry' AND i.state='CONSUMED' AND a.state='UNAVAILABLE'
        AND json_extract(a.data,'$.resultId')<>json_extract(i.text,'$.resumeResult')`,rows:[[held||unverified?0:1]]};
    const status = uiText(locale,unverified?'delegated.resultListKey':'delegated.recoveryKey',{key:'Ctrl+G',confirm:'enter'});
    const idle = {sql:'SELECT s.resource FROM conversation_state s JOIN interaction_view v ON v.selected=s.conversation',rows:[['IDLE']]};
    const steps=[
        {wait:status,send:cfg.diagnose+'\r',queries:[untouched,idle,originalRuns]},
        {wait:cfg.diagnosed,send:cfg.resume+'\r',queries:[untouched,idle,originalRuns]},
        {wait:cfg.finished,send:cfg.draft,queries:[settled,idle,finalRuns]},
        {wait:cfg.draft,send:'\x07q',queries:[settled,finalRuns]},
    ];
    await fs.writeFile(fixture,JSON.stringify(cfg));
    await fs.writeFile(driver,JSON.stringify({steps,output,database:path.join(cfg.home,'state','controller.sqlite'),columns:122,rows:40,timeoutSeconds:11,noForceKill:true,
        command:[process.execPath,path.resolve('tests/ui/delegated-planning-question-child.mjs'),fixture],
        env:{HOME:root,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}}));
    const terminal=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',driver],{timeout:14500,maxBuffer:2**20})).stdout);
    assert.deepEqual([terminal.exitCode,terminal.stages,terminal.terminalRestored],[0,steps.length,true]);
    passed=true;
});
