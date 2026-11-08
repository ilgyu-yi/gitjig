import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {nodePreloads} from '../helpers/node-preloads.mjs';
const execute=promisify(execFile);
const stages=[{}, {roleStage:'planning-adjudication'}, {roleStage:'consumer-control-proposal'},
    {roleStage:'planning-adjudication',providerReport:true}, {unconfirmed:true}];
for(const locale of ['en','ko'])for(const {roleStage,providerReport,unconfirmed} of stages) test(
    `actual accepted-WAIT terminal retains the draft during ${unconfirmed?'unconfirmed settlement':providerReport?'provider retry':roleStage ?? 'source capture'} in ${locale}`,{timeout:15000},async t=>{
    const root=await temporaryDirectory('wait-screen');let passed=false;
    t.after(async()=>{if(passed&&process.env.GITJIG_RETAIN_UI_FIXTURE!=='1')await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained waiting screen '+root);});
    const config=path.join(root,'config.json'),ready=path.join(root,'ready.json'),observation=path.join(root,'observation'),output=path.join(root,'terminal'),guard=path.join(root,'guard.json'),resultFile=path.join(root,'result.json');
    const targetLabel=locale==='ko'?'기다리는 작업 #':'Waiting for #';
    const label=unconfirmed ? (locale==='ko'?'원래 실행의 정리 상태 미확인':'Original execution cleanup unconfirmed') : targetLabel;
    const roleLabel = roleStage==='planning-adjudication' ? (locale==='ko'?'계획 승인 판단':'Plan acceptance decision') :
        roleStage==='consumer-control-proposal' ? (locale==='ko'?'격리 대조안 제안':'Isolated check variant proposal') : undefined;
    const report=locale==='ko'?'서버 요청 재시도 중 (2/5)':'Provider retry (2/5)';
    await fs.writeFile(config,JSON.stringify({locale,roleStage,providerReport,unconfirmed,ready,observation,output,receipt:resultFile,timeoutSeconds:9,gracefulShutdownSeconds:2,
        steps:[{wait:label,send:'\x07q',frame:{contains:[label,'Retained 한글 draft',...(roleLabel?[roleLabel]:[]),...(providerReport?[report]:[])],draft:'Retained 한글 draft',editorFocused:true}}],
        command:[process.execPath,...nodePreloads(),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('tests/ui/waiting-activity-child.mjs'),config],
        env:{HOME:root,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',SHELL:'/bin/sh',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation,GITJIG_NAVIGATION_RECEIPT:guard}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',config],{timeout:12000,maxBuffer:2**20})).stdout);
    await fs.writeFile(path.join(root,'driver-receipt.json'),JSON.stringify(receipt,null,2));
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,1);assert.equal(receipt.terminalRestored,true);
    assert.equal(receipt.alternateEntered,true);assert.equal(receipt.alternateExited,true);
    const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));assert.equal(progress.forceKilled,false);assert.equal(progress.error,null);
    const frame=JSON.parse(await fs.readFile(output+'.frame-0.json','utf8')),identity=JSON.parse(await fs.readFile(ready,'utf8'));
    assert.ok(frame.frame.join('\n').includes('#'+identity.target.slice(0,8)));
    if (unconfirmed)
        assert.ok(!frame.frame.join('\n').includes(targetLabel));
    const relation=frame.frame.find(line=>line.startsWith('↓ '));assert.ok(relation);
    assert.ok(relation.includes('#'+identity.target.slice(0,8)));
    assert.ok(relation.includes(locale==='ko'?'하위 대화':'Children'));
    assert.ok(relation.includes(roleLabel ?? (locale==='ko'?'기록된 작업 단계: 소스 캡처됨':'Recorded task stage: source captured')),relation);
    assert.doesNotMatch(relation,/Conversation idle|대화 대기/);
    assert.doesNotMatch(frame.frame.join('\n'),/Waiting · check conversation|대기 중 · 대화를 확인하세요/);
    assert.equal(frame.selected,identity.parent);assert.equal(frame.draft,'Retained 한글 draft');
    assert.deepEqual(JSON.parse(await fs.readFile(guard,'utf8')),{process:0,network:0,model:0,run:0});
    const final=JSON.parse(await fs.readFile(resultFile,'utf8'));assert.equal(final.draft,'Retained 한글 draft');assert.equal(final.noAdditionalWork,true);
    passed=true;
});
