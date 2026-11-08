import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
import {reconciliationFixture} from './publication-reconcile-fixture.mjs';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);
for(const scenario of ['confirm','close','interrupt','interruptKo'])test('actual original-publication reconciliation terminal '+{
    confirm:'confirms by native reads without resend',close:'joins read cancellation on host close',
    interrupt:'interrupts the read in place and keeps the original in English',interruptKo:'interrupts the read in place and keeps the original in Korean',
}[scenario],{timeout:16000},async t=>{
    const closing=scenario==='close',interrupting=scenario.startsWith('interrupt'),locale=scenario==='interruptKo'?'ko':'en';
    const copy=(key,params)=>uiText(locale,key,params);
    const tls=await repositoryTlsFixture(t),f=await reconciliationFixture(t),home=f.c.applicationHome(),file=path.join(f.root,'reconcile-ui.json'),marker=path.join(f.root,'read-entered');
    const stopped=path.join(f.root,'read-stopped'),draft='Keep this unrelated draft 한국어';
    const context=f.c.inspectPublicationReconciliation(f.op.operationId),grants=f.c.store.all('SELECT * FROM effect_delegations'),payload=f.c.store.one('SELECT data FROM effect_operations WHERE id=?',f.op.operationId).data;
    let held;
    if (closing || interrupting) { held=f.holdRead(); f.onRead(()=>writeFileSync(marker,'entered')); }
    if (closing || interrupting) {
        f.c.setConversationView({selectedId:f.source});
        f.c.setDraft({conversationId:f.source,expectedRevision:0,text:draft});
        f.c.setConversationLanguage({conversationId:f.source,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    }
    await f.c.close();
    // Owned TLS front for the same synthetic service that accepted the original HTTP fixture POST.
    const requests=[];const proxy=https.createServer(tls.tls,(req,res)=>{
        requests.push({method:req.method,path:req.url});if(req.method!=='GET'){res.writeHead(405);res.end();return;}
        const request=http.request(new URL(req.url,f.origin),{method:'GET',headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
        res.once('close',()=>{
            request.destroy();
            if (interrupting && !res.writableFinished && req.url.startsWith('/repos/owner/repo/issues/8/comments?')) {
                writeFileSync(stopped,'stopped');
                held.release();
            }
        });request.once('error',()=>{if(!res.destroyed){res.writeHead(502);res.end();}});request.end();
    });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(async()=>{held?.release();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));});
    const fixed=[{sql:'SELECT COUNT(*) FROM effect_operations',rows:[[1]]},{sql:'SELECT COUNT(*) FROM works',rows:[[1]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]},{sql:'SELECT * FROM effect_delegations ORDER BY rowid',rows:grants.map(row=>Object.values(row))}];
    const list='Retained publications · recorded facts',menu=copy('publication.record.title',{id:f.op.operationId});
    const management=copy('repository.menu.title').split(',')[0];
    const phase=recorded=>({sql:'SELECT phase FROM effect_operations WHERE id=?',params:[f.op.operationId],rows:[[recorded]]});
    const spend=amount=>({sql:"SELECT consumed,reserved,lim FROM budgets WHERE lineage=? AND kind='execution'",params:[context.lineage],rows:[[context.execution.consumed+amount,0,context.execution.limit]]});
    const selectRead={wait:menu,queries:[...fixed,phase('UNKNOWN'),spend(0)],send:copy('publication.choice.read')+'\r'};
    const returnToRead=copy('publication.returnToRead',{action:copy('publication.choice.read')}).split('.')[0];
    const review={wait:copy('review.confirm'),queries:fixed,send:'\r'};
    const attempts=interrupting?2:1;
    const confirmed={wait:menu,queries:[...fixed,phase('CONFIRMED'),spend(attempts)],send:copy('integration.choice.back')+'\r',...interrupting?{assertDraft:draft}:{} };
    const confirmRead={wait:'Explicit original-publication action',send:'Reconcile original with read requests\r'};
    const provideCredential={wait:copy('repository.credentialFilePrompt'),send:f.credential+'\r'};
    const waiting={wait:'Working · Checking the original publication result',waitFiles:[{path:marker,value:'entered'}]};
    const readSettled={sql:"SELECT COUNT(*) FROM runs WHERE phase='RUNNING'",rows:[[0]]};
    const steps=[
        ...closing || interrupting?[
            {wait:draft,send:'\x07/'},
            {wait:copy('command.discovery.title').split(locale==='ko'?' · ':',')[0],send:'/repo\r'},
        ]:[{wait:'Model: not selected',send:'/repo\x1b\r'}],
        {wait:management,send:copy('repository.menu.publications')+'\r'},
        {wait:list,send:'owner/repo\r'},
        selectRead,{...review,send:'\x1b'},
        selectRead,review,{wait:'Explicit original-publication action',send:'Back without reconciliation\r'},
        selectRead,review,
        confirmRead,provideCredential,
        ...closing?[{...waiting,terminate:true,send:''}]:[
            ...interrupting?[
                {...waiting,wait:copy('interaction.interruptible'),send:'\x1b'},
                {wait:returnToRead,waitFiles:[{path:stopped,value:'stopped'}],
                    queries:[...fixed,phase('UNKNOWN'),spend(1),readSettled],assertDraft:draft,send:'\x1b'},
                {...selectRead,queries:[...fixed,phase('UNKNOWN'),spend(1),readSettled],assertDraft:draft},
                review,confirmRead,provideCredential,
            ]:[],
            {wait:'Original publication reconciliation retained',queries:[...fixed,phase('CONFIRMED'),spend(attempts)],send:'\x1b'},
            confirmed,
            {wait:list,send:'Back\r'},
            {wait:management,send:copy('repository.menu.close')+'\r'},
            interrupting?{wait:draft,assertDraft:draft,send:'\x07q'}:{wait:'INPUT',send:'/quit\x1b\r'},
        ],
    ];
    const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[],output=file+'.terminal';
    const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_CONTRIBUTION_PORT:String(proxy.address().port),...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/contribution-network-only.mjs',entry??'dist/cli/entry.js'],env,steps,timeoutSeconds:7,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3}));
    try{
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.ok(requests.length>0&&requests.every(row=>row.method==='GET'));assert.equal(f.posts.length,1);
        if (closing) {
            const calls = requests.length;
            const unchanged = [...fixed, phase('UNKNOWN'), spend(1), readSettled];
            const cold = [
                {wait:draft, send:'\x07/'},
                {wait:copy('command.discovery.title').split(',')[0], send:'/repo\r'},
                {wait:management, send:copy('repository.menu.publications')+'\r'},
                {wait:list, send:'owner/repo\r'},
                {wait:menu, send:copy('integration.choice.back')+'\r'},
                {wait:list, send:'Back\r'},
                {wait:management, send:copy('repository.menu.close')+'\r'},
                {wait:draft, send:'\x07q'},
            ].map(step => ({...step, queries:unchanged, assertDraft:draft, expectedSelected:f.source}));
            const config = JSON.parse(await fs.readFile(file, 'utf8'));
            const coldFile = file + '.cold';
            await fs.writeFile(coldFile, JSON.stringify({...config, output:output+'.cold', steps:cold}));
            const reopened = JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',coldFile],{timeout:12000,maxBuffer:2**20})).stdout);
            assert.deepEqual([reopened.exitCode,reopened.stages,reopened.terminalRestored],[0,cold.length,true]);
            assert.equal(requests.length,calls, 'Cold inspection must not send or check the published result');
        }
        const bytes=await fs.readFile(output);assert.doesNotMatch(bytes.toString('utf8'),/fixture-original/);
        if(!closing){
            const {actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8')),index=steps.indexOf(confirmed);
            const picker=bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');
            for(const line of [menu,copy('publication.field.phase',{phase:'CONFIRMED'}),copy('publication.field.transport',{outcome:copy('integration.transport.uncertain')}),
                copy('publication.field.observation',{outcome:copy('publication.observed.resource',{id:f.comments[0].id})})])assert.ok(picker.includes(line),'Refreshed original must show '+line);
            assert.ok(!picker.includes(copy('publication.choice.read')));
            assert.ok(!picker.includes(copy('publication.choice.send')));
            if (interrupting) {
                const stoppedIndex = steps.findIndex(step => step.wait === returnToRead);
                const outcome = bytes.subarray(offsets[stoppedIndex - 1], offsets[stoppedIndex]).toString('utf8');
                for (const line of [copy('publication.readInterrupted'), menu, 'owner/repo', copy('publication.reviewWork', {id: JSON.stringify(f.op.workId)}),
                    copy('publication.field.phase', {phase: 'UNKNOWN'}),
                    copy('publication.field.transport', {outcome: copy('integration.transport.uncertain')}),
                    returnToRead])
                    assert.ok(outcome.includes(line), 'Interrupted outcome must show ' + line);
            }
        }
        const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{
            const row=db.prepare('SELECT phase,data FROM effect_operations WHERE id=?').get(f.op.operationId);assert.equal(row.phase,closing?'UNKNOWN':'CONFIRMED');assert.equal(JSON.parse(row.data).payloadHash,JSON.parse(payload).payloadHash);assert.equal(JSON.parse(row.data).payloadBase64,JSON.parse(payload).payloadBase64);
            const budget=db.prepare("SELECT consumed,reserved,lim FROM budgets WHERE lineage=? AND kind='execution'").get(context.lineage);assert.equal(budget.consumed,context.execution.consumed+attempts);assert.equal(budget.reserved,0);assert.equal(budget.lim,context.execution.limit);assert.deepEqual(db.prepare('SELECT * FROM effect_delegations ORDER BY rowid').all(),grants);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE phase='RUNNING'").get().n,0);
        }finally{db.close();}f.pass();
    }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}
    finally{held?.release();}
});
