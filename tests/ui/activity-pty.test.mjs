import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {translator} from '../../dist/ui/i18n.js';

const execute=promisify(execFile), cli=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/main.js');
const cliDist=path.dirname(path.dirname(await fs.realpath(cli)));
const cliModule=file=>pathToFileURL(path.join(cliDist,file)).href;
const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
async function fixture(t) {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-activity-pty-'))), home=path.join(root,'home');
    let passed=false;
    t.after(async()=>{if(passed) await fs.rm(root,{recursive:true,force:true}); else t.diagnostic('Retained activity terminal '+root);});
    return {root,home,pass(){passed=true;}};
}
async function launch(f,name,steps,extra=[],locale='en',columns=140,exitCode=0) {
    const output=path.join(f.root,name+'.terminal'), config=path.join(f.root,name+'.json');
    const observation=steps.some(step=>step.frame)?path.join(f.root,name+'.observation.json'):undefined;
    const observer=observation?['--import',path.resolve('tests/ui/inspection-pty-observer.mjs')]:[];
    await fs.writeFile(config,JSON.stringify({command:[process.execPath,...moduleGuard,...extra,...observer,cli,'conversation','ui','--home',f.home,'--completed-view-limit','0','--view-idle-grace-ms','0'],
        env:{HOME:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',USER:'fixture',LOGNAME:'fixture',SHELL:'/bin/sh',TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'C.UTF-8',GITJIG_HOME:f.home,TMPDIR:path.join(f.home,'artifacts'),NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},database:path.join(f.home,'state','controller.sqlite'),observation,output,columns,timeoutSeconds:15,steps}));
    const actual=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',config],{timeout:20000,maxBuffer:2**20})).stdout);
    assert.equal(actual.exitCode,exitCode); assert.equal(actual.stages,steps.length);
    if(exitCode===0) assert.equal(actual.terminalRestored,true);
    return fs.readFile(output,'utf8');
}

test('installed terminal continues the original request after process loss before model dispatch', {timeout:25000}, async t=>{
    const f=await fixture(t), tr=translator('en');
    const received=path.join(f.root,'received');
    await fs.writeFile(received,'0');
    const {requests,marker}=await startResponseProvider(t,f.home,undefined,undefined,undefined,received);
    const original='Retain the native input across process loss', draft='Separate unsent draft · 한국어';
    const hook=path.join(f.root,'crash-before-dispatch.mjs'), checkpoint=path.join(f.root,'crash-checkpoint.json');
    await fs.writeFile(hook,`import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Controller} from ${JSON.stringify(cliModule('controller/controller.js'))};
Controller.prototype.recordModelDispatch = function (id, cp) {
    const run=this.store.one('SELECT * FROM runs WHERE id=?',id), data=JSON.parse(run.data);
    assert.equal(data.nativeInputObserved,true);
    assert.equal(data.modelDispatchAttempted,undefined);
    assert.equal(data.nativeSessionId,cp.sessionId);
    const entries=readFileSync(data.historyRef,'utf8').trimEnd().split('\\n').map(line=>JSON.parse(line));
    assert.deepEqual(entries.filter(entry=>entry.type==='message' && entry.message.role!=='system').map(entry=>entry.message.role),['user']);
    // Bind the test ceiling to the already admitted first attempt. The original producer records all other evidence.
    this.store.run("UPDATE budgets SET lim=1 WHERE lineage=? AND kind='execution'",run.work);
    writeFileSync(${JSON.stringify(checkpoint)},JSON.stringify({run:id,work:run.work,input:data.initialInputId,file:data.historyRef}));
    process.kill(process.pid,'SIGKILL');
};`);
    await launch(f,'abrupt-original',[{wait:'/ready',send:original+'\r'}],['--import',hook],'en',140,-9);
    const saved=JSON.parse(await fs.readFile(checkpoint,'utf8')), history=await fs.readFile(saved.file,'utf8');
    assert.equal(requests.length,0);
    assert.ok(history.includes(original));
    const input=state=>({sql:'SELECT id,work,state,text FROM conversation_inputs',rows:[[saved.input,saved.work,state,original]]});
    const run={sql:"SELECT work,phase,reservation,json_extract(data,'$.cleanup'),json_extract(data,'$.modelDispatchAttempted') FROM runs WHERE id=?",params:[saved.run],
        rows:[[saved.work,'INTERRUPTED','consumed','not-allocated',null]]};
    const budget=(limit,consumed)=>({sql:"SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[saved.work],rows:[[limit,consumed,0]]});
    const attempts=count=>({sql:'SELECT COUNT(*),COUNT(DISTINCT work) FROM runs',rows:[[count,1]]});
    const receipt=limit=>({assertDraft:draft,expectedInputs:1,queries:[input('RECONCILIATION_REQUIRED'),run,budget(limit,1),attempts(1)],textFiles:[{path:received,value:'0'}]});
    const before=receipt(1), after=receipt(5), review=tr('ready.interruptedRequestNext');
    const allowance=tr('input.recoveryReviewAllowance'), execution=tr('workRecovery.execution');
    const kind=tr('workRecovery.executionKind'), confirm=tr('workRecovery.confirmAllowance',{kind,additional:4});
    const output=await launch(f,'abrupt-resumed',[
        {wait:'/ready',send:draft+'\x07t'},
        {wait:tr('ready.title'),frame:{contains:[review]},send:review+'\r'},
        {wait:tr('input.recoveryOpenActions'),...before,frame:{contains:[original,tr('input.recoveryAllowanceNext')]},send:'\r'},
        {wait:tr('input.recoveryAllowanceRequired'),...before,frame:{contains:[allowance],excludes:[tr('input.recoveryPreDispatchRetry')]},send:allowance+'\r'},
        {wait:execution,...before,send:execution+'\r'},
        {wait:tr('workRecovery.additional',{kind,available:0}),...before,send:'\r'},
        {wait:tr('workRecovery.allowanceReason'),...before,send:'Continue this original request\r'},
        {wait:tr('review.openConfirmation'),...before,send:'\r'},
        {wait:confirm,...before,send:confirm+'\r'},
        {wait:tr('workRecovery.extended',{kind}),...after,send:'\x1b'},
        {wait:tr('input.recoveryOpenActions'),...after,frame:{contains:[original,tr('input.recoveryPreDispatchNext').split('. ')[0]]},send:'\r'},
        {wait:tr('input.recoveryPreDispatchRetry'),...after,send:tr('input.recoveryPreDispatchRetry')+'\r'},
        {wait:tr('response.delivered'),waitIdle:true,assertDraft:draft,expectedInputs:1,
            queries:[input('CONSUMED'),run,budget(5,2),attempts(2)],textFiles:[{path:received,value:'1'}],send:'\x07q'},
    ]);
    assert.ok(output.includes(marker));
    assert.equal(await fs.readFile(saved.file,'utf8'),history);
    assert.equal(requests.length,1);
    const users=requests[0].messages.filter(message=>message.role==='user');
    assert.equal(users.length,1);
    assert.equal(typeof users[0].content==='string'?users[0].content:users[0].content.map(part=>part.text).join(''),original);
    f.pass();
});

async function startResponseProvider(t, home, release, failure, finish, received) {
    const requests = [], sockets = new Set();
    const marker='OWNED_DELAYED_RESPONSE';
    const server=http.createServer(async(req,res)=>{
        try {
            const chunks=[];for await(const chunk of req)chunks.push(chunk);
            requests.push(JSON.parse(Buffer.concat(chunks).toString()));
            if(received)await fs.writeFile(received,String(requests.length));
            // The terminal consumer, not a guessed delay, releases the first byte.
            while(release && !res.destroyed && !await fs.access(release).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));
            if(res.destroyed)return;
            if(failure) {
                res.writeHead(400, {'content-type':'application/json'});
                res.end(JSON.stringify({error:{message:failure, type:'invalid_request_error'}}));
                return;
            }
            res.writeHead(200,{'content-type':'text/event-stream'});
            const chunk=(delta,finish_reason=null)=>({id:'activity-owned',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
            res.write(`data: ${JSON.stringify(chunk({role:'assistant',content:marker}))}\n\n`);
            while(finish && !res.destroyed && !await fs.access(finish).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));
            if(res.destroyed)return;
            res.write(`data: ${JSON.stringify(chunk({},'stop'))}\n\n`);res.end('data: [DONE]\n\n');
        } catch(error){res.destroy(error);}
    });
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
    const c=await openController({installationHome:home}),accounts=ApplicationAccounts.open(c);
    await accounts.configure({providers:{'activity-owned':{api:'openai-completions',apiKey:'DUMMY_ACTIVITY',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture'}]}}});
    await accounts.setDefault('activity-owned','fixture');const view=await new ApplicationModels(c).newConversation();c.setConversationView({selectedId:view.conversationId});await c.close();
    return { requests, marker, view };
}

for (const locale of ['en','ko']) test('readiness reopens the exact cleanly interrupted request in '+locale,{timeout:25000},async t=>{
    const f=await fixture(t), tr=translator(locale);
    const release=path.join(f.root,'release-response'), received=path.join(f.root,'received');
    const {requests}=await startResponseProvider(t,f.home,release,undefined,undefined,received);
    const original='Send the same original request', draft='New separate draft · 한국어';
    const review=tr('ready.interruptedRequestNext'), title=tr('ready.title');
    const waiting=tr('activity.stage.model'), completed=tr('response.delivered');
    const retained=[
        {sql:'SELECT state,text FROM conversation_inputs',rows:[['QUEUED',original]]},
        {sql:'SELECT phase,json_extract(data,\'$.outcome\') FROM runs',rows:[['SETTLED','interrupted']]},
        {sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[1,0]]},
    ];
    const receipt={assertDraft:draft,expectedInputs:1,queries:retained};
    await launch(f,'readiness-interrupted',[
        {wait:'/ready',send:original+'\r'},
        {wait:waiting,waitFiles:[{path:received,value:'1'}],send:draft+'\x1b'},
        {wait:tr('response.interrupted'),waitIdle:true,...receipt,send:'\x07t'},
        {wait:title,frame:{contains:[review],editorFocused:false},...receipt,send:'\r'},
        {wait:tr('input.recoveryOpenActions'),frame:{contains:[original,tr('input.recoveryAttemptRecorded'),tr('input.recoveryAttemptCharged')],editorFocused:false},...receipt,send:'\x1b'},
        {wait:title,frame:{contains:[review],editorFocused:false},...receipt,send:'\r'},
        {wait:tr('input.recoveryOpenActions'),...receipt,send:'\r'},
        {wait:tr('input.recoveryChoose'),...receipt,send:tr('input.recoveryInspectOriginal')+'\r'},
        {wait:tr('workRecovery.details'),...receipt,send:tr('workRecovery.details')+'\r'},
        {wait:tr('workRecovery.detailsTitle'),frame:{contains:[original],editorFocused:false},...receipt,send:'\x1b'},
        {wait:tr('workRecovery.details'),...receipt,send:'\x1b'},
        {wait:tr('input.recoveryOpenActions'),...receipt,send:'\r'},
        {wait:tr('input.recoveryChoose'),...receipt,send:tr('input.recoveryRetry')+'\r'},
        {wait:waiting,waitFiles:[{path:received,value:'2'}],assertDraft:draft,expectedInputs:1,releaseFile:release,send:''},
        {wait:completed,waitIdle:true,assertDraft:draft,expectedInputs:1,queries:[
            {sql:'SELECT state,text FROM conversation_inputs',rows:[['CONSUMED',original]]},
            {sql:'SELECT COUNT(*),COUNT(DISTINCT work) FROM runs',rows:[[2,1]]},
            {sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[2,0]]},
        ],send:'\x07q'},
    ],[],locale);
    assert.equal(requests.length,2);
    for(const request of requests) {
        const user=request.messages.filter(message=>message.role==='user').at(-1);
        assert.equal(typeof user.content==='string'?user.content:user.content.map(item=>item.text).join(''),original);
    }
    f.pass();
});

for (const locale of ['en','ko']) test('native block starts update the terminal before any content arrives in '+locale,{timeout:25000},async t=>{
    const f=await fixture(t),tr=translator(locale), releases=['thinking','writing','content'].map(phase=>path.join(f.root,phase));
    const marker='OWNED_NATIVE_BLOCK_TEXT', requests=[];
    const server=http.createServer(async(req,res)=>{
        const parts=[];
        for await (const part of req) parts.push(part);
        requests.push(JSON.parse(Buffer.concat(parts).toString()));
        const release=async index=>{
            while (!res.destroyed && !await fs.access(releases[index]).then(()=>true,()=>false))
                await new Promise(resolve=>setTimeout(resolve,10));
            return !res.destroyed;
        };
        const send=(type,details={})=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...details})}\n\n`);
        if (!await release(0)) return;
        res.writeHead(200,{'content-type':'text/event-stream'});
        send('message_start',{message:{id:'owned-native-block',type:'message',role:'assistant',model:'fixture',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});
        send('content_block_start',{index:0,content_block:{type:'thinking',thinking:''}});
        if (!await release(1)) return;
        send('content_block_stop',{index:0});
        send('content_block_start',{index:1,content_block:{type:'text',text:''}});
        if (!await release(2)) return;
        send('content_block_delta',{index:1,delta:{type:'text_delta',text:marker}});
        send('content_block_stop',{index:1});
        send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});
        send('message_stop');
        res.end();
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
    const c=await openController({installationHome:f.home});
    try {
        const accounts=ApplicationAccounts.open(c);
        await accounts.configure({providers:{'block-start-owned':{api:'anthropic-messages',apiKey:'DUMMY_BLOCK_START',baseUrl:`http://127.0.0.1:${server.address().port}`,models:[{id:'fixture'}]}}});
        await accounts.setDefault('block-start-owned','fixture');
        const view=await new ApplicationModels(c).newConversation();
        c.setConversationView({selectedId:view.conversationId});
    } finally {await c.close();}
    const request='Observe the original request beginning';
    const output=await launch(f,'native-block-start',[
        {wait:tr('footer.setup'),send:request+'\x1b\r'},
        {wait:tr('activity.stage.model'),expectedInputs:1,releaseFile:releases[0],send:''},
        {wait:tr('activity.thinking'),expectedInputs:1,send:'\x07c'},
        {wait:tr('navigation.title'),expectedInputs:1,send:'\x1b'},
        {wait:tr('activity.thinking'),expectedInputs:1,send:'\x1b[27;1:2u'},
        {wait:tr('activity.thinking'),expectedInputs:1,releaseFile:releases[1],send:''},
        {wait:tr('activity.writing'),expectedInputs:1,releaseFile:releases[2],send:''},
        {wait:tr('response.delivered'),waitIdle:true,expectedInputs:1,send:'\x07q'},
    ],[],locale);
    assert.equal(requests.length,1);
    assert.ok(output.includes(marker));
    f.pass();
});

for (const locale of ['en','ko']) test('reopen shows the original provider failure and keeps the newer draft in '+locale, {timeout:25000}, async t => {
    const f = await fixture(t), release = path.join(f.root,'reject-request');
    const failure = 'Owned provider rejected this exact request before answering';
    const {requests, view} = await startResponseProvider(t,f.home,release,failure);
    const original = 'Original request whose response failed', draft = 'Keep this unsent draft · 한글';
    const tr = translator(locale);
    const records = [
        {sql:'SELECT conversation,text,state FROM conversation_inputs',rows:[[view.conversationId,original,'CONSUMED']]},
        {sql:"SELECT phase,json_extract(data,'$.outcome') FROM runs",rows:[['SETTLED','unavailable']]},
        {sql:'SELECT COUNT(*) FROM conversation_results',rows:[[1]]},
    ];
    await launch(f,'reject-original',[
        {wait:tr('footer.setup'),send:original+'\x1b\r'},
        {wait:tr('activity.stage.model'),send:draft},
        {wait:draft,assertDraft:draft,expectedInputs:1,releaseFile:release,send:''},
        {wait:failure,waitIdle:true,queries:records,assertDraft:draft,expectedInputs:1,send:'\x07q'},
    ],[],locale);

    const c = await openController({installationHome:f.home});
    let persisted;
    try {
        persisted = c.inspectConversationResponseFailure(view.conversationId);
        assert.ok(persisted?.failure.includes(failure));
        if (locale === 'en') {
            const rollback = Error('Discard the changed diagnostic fixture');
            for (const [reason,sql] of [
                ['a newer direction','UPDATE conversation_state SET direction=direction+1'],
                ['a newer successful outcome',"UPDATE runs SET data=json_set(data,'$.outcome','delivered')"],
                ['a manual run',"UPDATE runs SET data=json_set(data,'$.manualAction',json('{}'))"],
                ['a different generation','UPDATE conversations SET generation=generation+1'],
                ['an assigned work',"UPDATE works SET data=json_set(data,'$.assignmentId','other-assignment')"],
                ['a missing current result','DELETE FROM conversation_results'],
                ['changed publication data',"UPDATE conversation_results SET data=json_set(data,'$.result.failure','Changed result')"],
            ]) assert.throws(() => c.store.tx(() => {
                c.store.run(sql);
                assert.equal(c.inspectConversationResponseFailure(view.conversationId),null,reason);
                throw rollback;
            }), error => error === rollback);
            assert.deepEqual(c.inspectConversationResponseFailure(view.conversationId),persisted);
        }
    } finally { await c.close(); }

    const output = await launch(f,'reopen-rejected-original',[
        {wait:tr('footer.setup'),queries:records,assertDraft:draft,expectedInputs:1,send:'\x07e'},
        {wait:tr('error.title'),send:tr('error.details')+'\r'},
        {wait:tr('error.detailsTitle'),queries:records,assertDraft:draft,expectedInputs:1,terminate:true,send:''},
    ],[],locale);
    const details = output.slice(output.lastIndexOf(tr('error.detailsTitle')));
    for (const expected of [failure,persisted.workId,persisted.runId,tr('error.responseRecovery').split('. ')[0]])
        assert.ok(details.includes(expected),expected);
    assert.equal(requests.length,1);
    f.pass();
});

for (const locale of ['en','ko']) test(`navigator and pane follow the original response from first-byte wait to writing in ${locale}`, {timeout:25000}, async t => {
    const f = await fixture(t), release = path.join(f.root,'first-output'), finish = path.join(f.root,'finish');
    const {requests, marker, view} = await startResponseProvider(t,f.home,release,undefined,finish);
    const original = 'Preserve my original request', draft = 'Unsent draft in the other conversation · 한글';
    const project = path.join(f.root,'Q');
    await fs.mkdir(project,{mode:0o700});
    const c = await openController({installationHome:f.home});
    let other, child;
    try {
        c.setConversationName({conversationId:view.conversationId,expectedGeneration:0,name:'Original response'});
        other = c.createConversation().conversationId;
        c.setConversationName({conversationId:other,expectedGeneration:0,name:'Other conversation'});
        c.setDraft({conversationId:other,expectedRevision:0,text:draft});
        child = c.createConversation().conversationId;
        c.setConversationParent({childId:child,parentId:view.conversationId,expectedRevision:0});
        c.store.run("UPDATE conversation_state SET resource='UNKNOWN' WHERE conversation=?",child);
        await c.registerProject({id:'Q',sourceRoot:project});
    } finally { await c.close(); }
    const tr = translator(locale), waiting = tr('activity.stage.model'), writing = tr('activity.writing'), input = tr('pane.input');
    const ownership = [
        {sql:'SELECT conversation,text FROM conversation_inputs',rows:[[view.conversationId,original]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[1]]},
        {sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[other],rows:[[draft]]},
        {sql:'SELECT resource FROM conversation_state WHERE conversation=?',params:[child],rows:[['UNKNOWN']]},
    ];
    const otherSelected = {sql:'SELECT selected FROM interaction_view',rows:[[other]]};
    const navigatorTitle = locale === 'ko' ? '대화 목록' : 'Conversations';
    const attention = tr('task.relatedAttention',{count:1}), suffix = ' · ' + attention + ' · ' + tr('pane.noProject');
    const name = 'navigator-first-output', selectedProject = tr('project.selected',{id:'Q'});
    const steps = [
        {wait:tr('footer.setup'),send:original+'\x1b\r'},
        {wait:input+' · '+waiting,queries:ownership,send:'\x07c'},
        {wait:waiting+suffix,queries:ownership,send:'\x1b'},
        {wait:input+' · '+waiting,queries:ownership,send:'\x07c'},
        {wait:waiting+suffix,queries:ownership,send:other+'\r'},
        {wait:draft,queries:[...ownership,otherSelected],send:'\x07c'},
        {wait:navigatorTitle,queries:[...ownership,otherSelected],send:view.conversationId},
        {wait:waiting+suffix,queries:[...ownership,otherSelected],releaseFile:release,send:''},
        {wait:writing+suffix,queries:[...ownership,otherSelected],send:'\r'},
        {wait:input+' · '+writing,queries:[...ownership,{sql:'SELECT selected FROM interaction_view',rows:[[view.conversationId]]}],
            releaseFile:finish,send:''},
        {wait:tr('response.delivered'),queries:[...ownership,
            {sql:"SELECT phase,json_extract(data,'$.outcome') FROM runs",rows:[['SETTLED','delivered']]}],
            frame:{contains:[tr('response.delivered'),attention],selected:view.conversationId,editorFocused:true},
            waitIdle:true,send:'\x07j'},
        {wait:tr('project.title',{project:tr('value.none')}),queries:ownership,send:'Q\r'},
        {wait:selectedProject,queries:[...ownership,
            {sql:'SELECT c.project,c.generation,s.work=r.work FROM conversations c JOIN conversation_state s ON s.conversation=c.id JOIN runs r ON r.work=s.work WHERE c.id=?',params:[view.conversationId],rows:[['Q',view.generation+2,1]]}],
            frame:{contains:[selectedProject,attention],selected:view.conversationId,editorFocused:true},send:'\x07q'},
    ];
    const output = await launch(f,name,steps,[],locale);
    const changedFrame = JSON.parse(await fs.readFile(path.join(f.root,`${name}.terminal.frame-${steps.length-1}.json`),'utf8')).frame;
    assert.ok(changedFrame.every(line=>!line.includes(tr('response.delivered'))));
    const answerRow = changedFrame.findIndex(line=>line.includes(marker));
    assert.ok(answerRow >= 0 && changedFrame.findIndex(line=>line.includes(attention)) > answerRow);
    assert.ok(output.includes(marker));
    assert.equal(requests.length,1);
    f.pass();
});

for (const locale of ['en','ko']) test(`cold reopen separates its last delivered response from a saved draft in ${locale}`,{timeout:25000},async t=>{
    const f=await fixture(t), release=path.join(f.root,'release');
    const {requests,marker,view}=await startResponseProvider(t,f.home,release);
    const tr=translator(locale), original='Original request', additional='Follow-up request', draft='Draft to send later · 한글';
    const followUp=locale==='ko', expectedInputs=followUp?2:1;
    const inputs={sql:'SELECT text,state FROM conversation_inputs ORDER BY rowid',rows:[
        [original,'CONSUMED'],...(followUp?[[additional,'CONSUMED']]:[]),
    ]};
    const settled={sql:"SELECT phase,json_extract(data,'$.outcome') FROM runs",rows:[['SETTLED','delivered']]};
    await launch(f,'first-response',[
        {wait:tr('footer.setup'),send:original+'\x1b\r'},
        {wait:tr('activity.stage.model'),send:followUp?additional+'\x1b\r':draft,...followUp?{}:{releaseFile:release}},
        ...followUp?[{wait:tr('pane.outgoing',{preview:additional}),send:draft,releaseFile:release}]:[],
        {wait:tr('response.delivered'),queries:[inputs,settled],waitIdle:true,assertDraft:draft,expectedInputs,send:'\x07q'},
    ],[],locale);
    const last=locale==='ko'?'지난 응답 완료':'Last response completed';
    const ready=tr('activity.ready',{submit:'Enter'});
    await launch(f,'reopen-response',[
        {wait:last,queries:[inputs,settled],assertDraft:draft,expectedInputs,
            frame:{contains:[last,ready,draft,marker],selected:view.conversationId,editorFocused:true},
            ...(followUp?{send:'\x07q'}:{
                mutations:[{sql:'UPDATE conversation_state SET direction=direction+1 WHERE conversation=?',params:[view.conversationId]}],
                send:'\x07c',
            })},
        ...(followUp?[]:[
            {wait:'Conversations',send:'\x1b'},
            {wait:ready,frame:{contains:[ready,draft,marker],selected:view.conversationId,editorFocused:true},send:'\x07q'},
        ]),
    ],[],locale);
    if (!followUp) {
        const currentFrame=JSON.parse(await fs.readFile(path.join(f.root,'reopen-response.terminal.frame-2.json'),'utf8')).frame;
        assert.ok(currentFrame.every(line=>!line.includes(last)));
    }
    const c=await openController({installationHome:f.home});
    const next='A newer retained request';
    try {
        const read=()=>c.inspectRetainedConversationCompletion(view.conversationId);
        if (!followUp) {
            assert.equal(read(),undefined);
            c.store.run('UPDATE conversation_state SET direction=direction-1 WHERE conversation=?',view.conversationId);
        }
        const current=c.inspectConversation(view.conversationId);
        const receipt=read();
        assert.deepEqual(receipt,{status:'delivered',generation:current.generation,workId:current.workId,
            runId:c.store.one('SELECT id FROM runs').id,cleanup:'unbound',directionRevision:current.directionRevision});
        if (followUp) {
            const row=c.store.one('SELECT data FROM runs WHERE id=?',receipt.runId);
            c.store.run("UPDATE runs SET data=json_set(data,'$.routedInputs[0].sourceId','other-source') WHERE id=?",receipt.runId);
            assert.equal(read(),undefined);
            c.store.run('UPDATE runs SET data=? WHERE id=?',row.data,receipt.runId);
            const input=c.store.one("SELECT id FROM conversation_inputs WHERE mode='follow-up'");
            c.store.run('UPDATE conversation_inputs SET text=? WHERE id=?','Changed follow-up',input.id);
            assert.equal(read(),undefined);
            c.store.run('UPDATE conversation_inputs SET text=? WHERE id=?',additional,input.id);
        } else {
            const publication=c.store.one('SELECT id,data FROM conversation_results WHERE work=?',receipt.workId);
            c.store.run("UPDATE conversation_results SET data=json_set(data,'$.publicationHash','different') WHERE id=?",publication.id);
            assert.equal(read(),undefined);
            c.store.run('UPDATE conversation_results SET data=? WHERE id=?',publication.data,publication.id);
            c.store.run('UPDATE conversations SET generation=generation+1 WHERE id=?',view.conversationId);
            assert.equal(read(),undefined);
            c.store.run('UPDATE conversations SET generation=? WHERE id=?',current.generation,view.conversationId);
        }
        assert.deepEqual(read(),receipt);
        await c.queueConversationInput({conversationId:view.conversationId,expectedGeneration:current.generation,text:next,mode:'idle'});
        assert.equal(read(),undefined);
    } finally {await c.close();}
    const retained=tr('activity.retained');
    await launch(f,'reopen-pending',[
        {wait:retained,queries:[{...inputs,rows:[...inputs.rows,[next,'QUEUED']]},settled],
            assertDraft:draft,expectedInputs:expectedInputs+1,
            frame:{contains:[retained,draft,marker],selected:view.conversationId,editorFocused:true},send:'\x07q'},
    ],[],locale);
    const pendingFrame=JSON.parse(await fs.readFile(path.join(f.root,'reopen-pending.terminal.frame-0.json'),'utf8')).frame;
    assert.ok(pendingFrame.every(line=>!line.includes(last)));
    assert.equal(requests.length,expectedInputs);
    f.pass();
});

for (const locale of ['en', 'ko']) for (const action of ['Escape', 'Quit', 'Queue']) test(
    `${action} preserves an already returned response during cleanup in ${locale}`, {timeout:25000}, async t => {
    const f = await fixture(t);
    const {requests, marker, view} = await startResponseProvider(t, f.home);
    const entered = path.join(f.root,'cleanup-entered'), release = path.join(f.root,'release-cleanup');
    const interrupted = path.join(f.root,'interrupt-called'), guard = path.join(f.root,'hold-cleanup.mjs');
    const dist = path.resolve(path.dirname(await fs.realpath(cli)), '..');
    await fs.writeFile(guard, `import fs from 'node:fs/promises';
import {Interactions} from ${JSON.stringify(pathToFileURL(path.join(dist,'controller/interaction.js')).href)};
import {Controller} from ${JSON.stringify(pathToFileURL(path.join(dist,'controller/controller.js')).href)};
const drain = Interactions.prototype.drainNativeInputs;
let held = false;
Interactions.prototype.drainNativeInputs = async function(identity) {
    if (!held && identity?.conversationId === ${JSON.stringify(view.conversationId)}) {
        held = true;
        await fs.writeFile(${JSON.stringify(entered)}, 'held');
        while (!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))
            await new Promise(resolve=>setTimeout(resolve,10));
    }
    return drain.call(this, identity);
};
const stop = Controller.prototype.interruptConversation;
Controller.prototype.interruptConversation = async function(...args) {
    await fs.writeFile(${JSON.stringify(interrupted)}, 'called');
    return stop.apply(this,args);
};`);
    const copy = locale === 'ko'
        ? {ready:'/ready 설정', cleanup:'응답 마무리 · 자원 정리 중', idle:'입력 · 대화 대기', complete:'응답 완료', interrupt:'Esc 응답 중단', closing:'Gitjig 종료 중'}
        : {ready:'/ready setup', cleanup:'Finishing response · cleaning up', idle:'INPUT · Conversation idle', complete:'Response complete', interrupt:'Esc interrupt', closing:'Closing Gitjig'};
    const original = 'Keep the already returned answer', draft = 'Next unsent 한글 draft';
    const settling = [
        {sql:'SELECT resource FROM conversation_state',rows:[['SETTLING']]},
        {sql:'SELECT text,state FROM conversation_inputs',rows:[[original,'CONSUMED']]},
    ];
    const quit = action === 'Quit';
    const queue = action === 'Queue';
    const ready = translator(locale);
    const cleanupNext = locale === 'ko' ? '정리 진행 중 · 대화에서 상태 확인' : 'Cleanup is in progress · follow it in the conversation';
    const retained = {sql:'SELECT text,state,mode FROM conversation_inputs ORDER BY rowid',
        rows:[[original,'CONSUMED','idle'],[draft,'QUEUED','idle']]};
    const output = await launch(f,'settling-terminal',[
        {wait:copy.ready,send:original+'\x1b\r'},
        {wait:queue ? (locale === 'ko' ? 'Enter 요청 보관 후 검토' : 'Enter queue for review') : copy.cleanup,
            waitFiles:[{path:entered,value:'held'}],queries:settling,
            assertDraft:'',expectedInputs:1,send:(quit || queue ? '' : '\x1b[27;1u')+draft},
        {wait:draft,queries:settling,assertDraft:draft,expectedInputs:1,
            send:queue ? (locale === 'en' ? '\r' : '\x1b\r') : quit?'\x07q':'\x07t'},
        ...queue ? [
            {wait:locale === 'ko' ? '보관된 요청 · 1개 보류' : 'Retained request · 1 pending',queries:[settling[0],retained],
                assertDraft:'',expectedInputs:2,releaseFile:release,send:''},
            {wait:(locale === 'ko' ? '입력' : 'INPUT') + ' · ' + ready('activity.retained'),
                queries:[retained],waitIdle:true,assertDraft:'',expectedInputs:2,send:'\x07q'},
        ] : quit ? [] : [
            {wait:cleanupNext,queries:settling,assertDraft:draft,expectedInputs:1,send:'\r'},
            {wait:copy.cleanup,queries:settling,assertDraft:draft,expectedInputs:1,releaseFile:release,send:''},
        ],
        ...queue ? [] : [quit?{wait:copy.closing,queries:settling,releaseFile:release,send:''}
            :{wait:copy.idle,waitIdle:true,assertDraft:draft,expectedInputs:1,send:'\x07q'}],
    ],['--import',guard],locale);
    const reopened = await openController({installationHome:f.home});
    try {
        assert.deepEqual(reopened.store.all('SELECT text,state FROM conversation_inputs').map(row=>[row.text,row.state]),
            [[original,'CONSUMED'], ...queue ? [[draft,'QUEUED']] : []]);
        assert.equal(reopened.store.one("SELECT json_extract(data,'$.outcome') AS outcome FROM runs").outcome,'delivered');
        assert.equal(reopened.inspectConversation(view.conversationId).draft.text,queue?'':draft);
    } finally {await reopened.close();}
    assert.equal(requests.length,1);
    assert.match(output,new RegExp(marker));
    if (!quit && !queue) {
        assert.ok(output.includes(copy.complete));
        assert.ok(!output.slice(output.indexOf(ready('ready.title')),output.indexOf(copy.idle,output.indexOf(cleanupNext))).includes(ready('ready.waitNext')));
    }
    assert.doesNotMatch(output.slice(output.indexOf(copy.cleanup),output.indexOf(draft)),new RegExp(copy.interrupt));
    if (queue)
        assert.ok(!output.slice(output.indexOf(copy.cleanup)).includes(ready('footer.liveInput', {submit:'Enter'})));
    await assert.rejects(fs.access(interrupted),{code:'ENOENT'});
    f.pass();
});

for (const locale of ['en', 'ko']) test(`an active response preserves its source while opening the intended project in ${locale}`, {timeout:25000}, async t => {
    const f = await fixture(t), release = path.join(f.root, 'release-original-response');
    const {requests, marker, view} = await startResponseProvider(t, f.home, release);
    const project = path.join(f.root, 'Q');
    await fs.mkdir(project, {mode:0o700});
    const controller = await openController({installationHome:f.home});
    try { await controller.registerProject({id:'Q', sourceRoot:project}); }
    finally { await controller.close(); }

    const tr = translator(locale), ko = locale === 'ko';
    const original = 'Original response stays here', draft = 'Keep this unsent · 한글';
    const source = view.conversationId;
    const originalOnly = [
        {sql:'SELECT project FROM conversations WHERE id=?', params:[source], rows:[[null]]},
        {sql:'SELECT draft FROM conversation_views WHERE conversation=?', params:[source], rows:[[draft]]},
        {sql:'SELECT phase FROM runs', rows:[['RUNNING']]},
        {sql:'SELECT conversation,text FROM conversation_inputs', rows:[[source,original]]},
    ];
    const held = ko ? '프로젝트 변경 보류 · 이 대화에서 응답이 진행 중입니다' : 'Project unchanged · a response is active in this conversation';
    const copy = {
        ready:ko ? '/ready 설정' : '/ready setup',
        waiting:ko ? '모델 응답 기다리는 중' : 'Waiting for model response',
        complete:ko ? '응답 완료' : 'Response complete',
    };
    const output = await launch(f, 'active-project', [
        {wait:copy.ready, send:original+'\x1b\r'},
        {wait:copy.waiting, send:draft+'\x07j'},
        {wait:tr('project.title',{project:tr('value.none')}), queries:originalOnly, send:'Q\r'},
        {wait:held, queries:originalOnly, send:'\x1b'},
        {wait:tr('activity.projectRecovery',{key:'Ctrl+G',project:'Q'}), queries:originalOnly, send:'\x07e'},
        {wait:held, queries:originalOnly, send:tr('error.independentSelectedProject',{project:'Q'})+'\r'},
        {wait:tr('newConversation.opened',{project:'Q'}), queries:[
            ...originalOnly,
            {sql:'SELECT project FROM conversations JOIN interaction_view ON selected=conversations.id', rows:[['Q']]},
        ], assertDraft:'', expectedInputs:1, send:'\x07c'},
        {wait:ko?'대화 목록':'Conversations', queries:originalOnly, send:source+'\r'},
        {wait:copy.waiting, queries:originalOnly, assertDraft:draft, expectedInputs:1, releaseFile:release, send:''},
        {wait:copy.complete, waitIdle:true, expectedInputs:1, assertDraft:draft, send:'\x07e'},
        {wait:tr('error.previousTitle'), send:'\x1b'},
        {wait:copy.complete, waitIdle:true, expectedInputs:1, assertDraft:draft, send:'\x07q'},
    ], [], locale);
    assert.match(output, new RegExp(marker));
    assert.equal(requests.length, 1);
    const reopened = await openController({installationHome:f.home});
    try {
        const newContext = reopened.listConversations().find(candidate => candidate.projectId === 'Q');
        assert.ok(newContext);
        assert.equal(newContext.parentId, null);
        assert.equal(newContext.workId, null);
        assert.equal(newContext.historyRef, null);
        assert.equal(reopened.inspectConversation(source).projectId, null);
        assert.equal(reopened.inspectConversation(source).draft.text, draft);
    } finally { await reopened.close(); }
    f.pass();
});

for (const [locale, scenario] of [['en', 'provider'], ['ko', 'provider'], ['en', 'unrelated'], ['en', 'open menu'], ['ko', 'open menu']]) test(
    `failed response after a project hold keeps the current diagnostic in ${locale} with ${scenario}`, {timeout:25000}, async t => {
        const f = await fixture(t), release = path.join(f.root, 'release-provider-error');
        const newerError = scenario === 'unrelated', oldMenu = scenario === 'open menu';
        const failure = 'Owned provider rejected the original request';
        const unrelated = 'Unknown registered project; open /project to select or register one';
        const {requests, view} = await startResponseProvider(t, f.home, release, failure);
        const project = path.join(f.root, 'Q');
        await fs.mkdir(project, {mode:0o700});
        const controller = await openController({installationHome:f.home});
        try { await controller.registerProject({id:'Q', sourceRoot:project}); }
        finally { await controller.close(); }

        const tr = translator(locale), ko = locale === 'ko';
        const original = 'Read from the original response';
        const draft = newerError ? '/project missing-fixture-project' : oldMenu ? 'Unsent 한글 draft' : '';
        const settled = [
            {sql:"SELECT phase,json_extract(data,'$.outcome') FROM runs", rows:[['SETTLED','unavailable']]},
            {sql:'SELECT conversation,text FROM conversation_inputs', rows:[[view.conversationId,original]]},
            {sql:'SELECT project FROM conversations', rows:[[null]]},
        ];
        const hold = {wait:tr('project.responseActive'), send:'\x1b',
            ...newerError ? {} : {releaseFile:release}};
        const resultReported = path.join(f.root, 'result-reported'), extra = [];
        const openProject = tr('error.independentSelectedProject',{project:'Q'});
        const updated = ko ? '복구 선택지가 바뀌었습니다 · 다시 선택하세요' : 'Recovery options updated · choose again';
        if (oldMenu) {
            const guard = path.join(f.root, 'observe-original-return.mjs');
            const installedController = path.resolve(path.dirname(await fs.realpath(cli)), '../controller/controller.js');
            await fs.writeFile(guard, `import {writeFileSync} from 'node:fs';
import {Controller} from ${JSON.stringify(pathToFileURL(installedController).href)};
const original = Controller.prototype.runConversation;
Controller.prototype.runConversation = async function(...args) {
    const result = await original.apply(this, args);
    setImmediate(() => writeFileSync(${JSON.stringify(resultReported)}, 'reported'));
    return result;
};`);
            extra.push('--import', guard);
        }
        const output = await launch(f, 'project-provider-error', [
            {wait:ko ? '/ready 설정' : '/ready setup', send:original+'\x1b\r'},
            {wait:ko ? '모델 응답 기다리는 중' : 'Waiting for model response', send:(oldMenu ? draft : '')+'\x07j'},
            {wait:tr('project.title',{project:tr('value.none')}), send:'Q\r'},
            ...oldMenu ? [] : [hold],
            ...newerError ? [{wait:tr('activity.projectRecovery',{key:'Ctrl+G',project:'Q'}), send:draft+'\x1b\r'}] : [],
            ...newerError ? [{wait:unrelated, releaseFile:release, send:''}] : [],
            ...oldMenu ? [
                {wait:tr('error.title'), releaseFile:release, send:openProject},
                {wait:openProject, queries:settled, waitFiles:[{path:resultReported,value:'reported'}], send:'\r'},
                {wait:updated, queries:settled, assertDraft:draft, expectedInputs:1, send:tr('error.details')+'\r'},
            ] : [
                {wait:ko ? '입력 · 대화 대기' : 'INPUT · Conversation idle', waitIdle:true,
                    queries:settled, assertDraft:draft, expectedInputs:1, send:'\x07e'},
                {wait:tr('error.title'), send:tr('error.details')+'\r'},
            ],
            {wait:tr('error.detailsTitle'), terminate:true, send:''},
        ], extra, locale);
        const details = output.slice(output.lastIndexOf(tr('error.detailsTitle')));
        assert.ok(details.includes(newerError ? unrelated : failure), details);
        if (oldMenu) assert.ok(output.includes(updated));
        assert.equal(requests.length, 1);
        f.pass();
    });

for(const locale of ['en','ko'])test(locale+' original CLI distinguishes a received input from first provider output and preserves typing until completion',{timeout:25000},async t=>{
    const f=await fixture(t),release=path.join(f.root,'release');
    const {requests, marker, view} = await startResponseProvider(t, f.home, release);
    const enteredRun=path.join(f.root,'entered-run'),releaseRun=path.join(f.root,'release-run'),guard=path.join(f.root,'hold-run.mjs');
    const cliResources=path.resolve(path.dirname(await fs.realpath(cli)),'../controller/completed-resources.js');
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {CompletedResources} from ${JSON.stringify(pathToFileURL(cliResources).href)};
const nativeNow=performance.now.bind(performance);
let heldMilliseconds=0;
Object.defineProperty(performance,'now',{value:()=>nativeNow()+heldMilliseconds});
const beforeFresh=CompletedResources.prototype.beforeFresh;
CompletedResources.prototype.beforeFresh=async function(...args){
    await fs.writeFile(${JSON.stringify(enteredRun)},'queued');
    heldMilliseconds+=20000;
    const deadline=Date.now()+14000;
    while(!await fs.access(${JSON.stringify(releaseRun)}).then(()=>true,()=>false)){
        if(Date.now()>=deadline)throw Error('Controlled admission barrier expired');
        await new Promise(resolve=>setTimeout(resolve,10));
    }
    return beforeFresh.apply(this,args);
};
`);
    const copy=locale==='ko'?{ready:'/ready 설정',queued:'요청 접수됨 · 실행 시작 대기',waiting:'모델 응답 기다리는 중',complete:'응답 완료',interrupt:'Esc 응답 중단'}:
        {ready:'/ready setup',queued:'Request received · waiting to start',waiting:'Waiting for model response',complete:'Response complete',interrupt:'Esc interrupt'};
    const original='  응답 전에도 상태를 확인  ';
    const tr=translator(locale);
    const waitingNext=locale==='ko'? '다음 단계 · 요청 접수됨 · 실행 시작 대기 · 대화로 돌아가기'
        : 'Next step · Request received · waiting to start · return to the conversation';
    const beforeRun=[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},{sql:'SELECT state,mode FROM conversation_inputs',rows:[['QUEUED','idle']]}];
    const output=await launch(f,'silent',[
        {wait:copy.ready,send:original+'\x1b\r'},
        {wait:copy.queued,waitFiles:[{path:enteredRun,value:'queued'}],queries:beforeRun,assertDraft:'',expectedInputs:1,send:'\x07t'},
        {wait:tr('ready.title'),frame:{contains:[waitingNext]},queries:beforeRun,assertDraft:'',expectedInputs:1,send:'\r'},
        {wait:copy.queued,frame:{editorFocused:true,contains:[copy.queued]},queries:beforeRun,assertDraft:'',expectedInputs:1,send:'\x07t'},
        {wait:tr('ready.title'),frame:{contains:[waitingNext]},queries:beforeRun,assertDraft:'',expectedInputs:1,releaseFile:releaseRun,send:''},
        // Hold the provider after dispatch, so selecting the refreshed row does not race another startup transition.
        {wait:'',frame:{editorFocused:false,contains:[waitingNext]},queries:[{sql:"SELECT json_extract(data,'$.modelDispatchAttempted') FROM runs",rows:[[1]]}],send:'\r'},
        {wait:locale==='ko'?'준비 상태가 바뀌었습니다':'Readiness updated',frame:{contains:[tr('ready.waitNext')],editorFocused:false},send:'\r'},
        {wait:copy.waiting,queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}],assertDraft:'',expectedInputs:1,send:'Newer unsent draft'},
        {wait:locale==='ko'?'· 22초':'· 22s',releaseFile:release,send:''},
        {wait:copy.complete,waitIdle:true,assertDraft:'Newer unsent draft',expectedInputs:1,terminate:true,send:''},
    ],['--import',guard],locale);
    const receivedAt=output.indexOf(copy.queued), waitingAt=output.indexOf(copy.waiting);
    assert.ok(receivedAt<waitingAt&&waitingAt<output.indexOf(marker));
    assert.ok(output.includes(copy.interrupt));assert.match(output,/Newer unsent draft/);
    assert.doesNotMatch(output,/No new output|새 출력 없음/);
    // The request being answered is progress; the retained-input warning is reserved for inputs that need /inputs.
    assert.doesNotMatch(output,/Retained request ·|\/inputs to inspect/);
    assert.ok(!output.includes(tr('ready.inputsNext')));
    assert.equal(requests.length,1);
    const user=requests[0].messages.filter(message=>message.role==='user').at(-1);
    assert.equal(typeof user.content==='string'?user.content:user.content.filter(item=>item.type==='text').map(item=>item.text).join(''),original);
    const reopened=await openController({installationHome:f.home});try{
        assert.equal(reopened.inspectConversation(view.conversationId).draft.text,'Newer unsent draft');
        assert.equal(reopened.inspectConversation(view.conversationId).state,'IDLE');
    } finally {await reopened.close();}f.pass();
});

async function failFirstCapacity(f, failure, exhaust = false) {
    const capacity = path.resolve(path.dirname(await fs.realpath(cli)), '../controller/capacity.js');
    const guard = path.join(f.root, 'fail-first.mjs');
    await fs.writeFile(guard, `import { Capacity } from ${JSON.stringify(pathToFileURL(capacity).href)};
const acquire = Capacity.prototype.acquire;
let first = true;
Capacity.prototype.acquire = async function (...args) {
    if (first) {
        first = false;
        ${exhaust ? `this.store.run("UPDATE budgets SET lim=consumed+reserved WHERE lineage=? AND kind='execution'",
            this.store.one("SELECT lineage FROM works WHERE id=?",args[0].workId).lineage);` : ''}
        throw Error(${JSON.stringify(failure)});
    }
    return acquire.apply(this, args);
};
`);
    return guard;
}

test('a retained startup request returns from explicit allowance extension and runs only on retry', {timeout:25000}, async t=>{
    const f=await fixture(t), tr=translator('en');
    const {requests}=await startResponseProvider(t,f.home);
    const original='Resume the original request after extending its allowance', draft='Separate unsent draft · 한국어';
    const failure='Controlled original startup refusal at the exhausted limit';
    const guard=await failFirstCapacity(f,failure,true);
    const originalInput={sql:'SELECT state,text FROM conversation_inputs',rows:[['INITIAL_RESERVED',original]]};
    const originalRun={sql:'SELECT phase,json_extract(data,\'$.outcome\') FROM runs',rows:[['SETTLED','unavailable']]};
    const budget=(limit,consumed)=>({sql:"SELECT lim,consumed,reserved FROM budgets WHERE kind='execution'",rows:[[limit,consumed,0]]});
    const before={assertDraft:draft,expectedInputs:1,queries:[originalInput,originalRun,budget(1,1)]};
    const after={...before,queries:[originalInput,originalRun,budget(5,1)]};
    const allowance=tr('input.recoveryReviewAllowance'), execution=tr('workRecovery.execution');
    const kind=tr('workRecovery.executionKind'), confirm=tr('workRecovery.confirmAllowance',{kind,additional:4});
    const openActions=tr('input.recoveryOpenActions'), retry=tr('input.recoveryRetry');
    await launch(f,'startup-request-allowance',[
        {wait:'/ready',send:original+'\r'},
        {wait:failure,waitIdle:true,send:draft},
        {wait:draft,...before,send:'\x07t'},
        {wait:tr('ready.title'),...before,frame:{contains:[tr('ready.failedRequestNext')]},send:'\r'},
        {wait:openActions,...before,frame:{contains:[original,failure]},send:'\r'},
        {wait:tr('input.recoveryAllowanceRequired'),...before,frame:{contains:[allowance],excludes:[retry]},send:allowance+'\r'},
        {wait:execution,...before,send:execution+'\r'},
        {wait:tr('workRecovery.additional',{kind,available:0}),...before,send:'\r'},
        {wait:tr('workRecovery.allowanceReason'),...before,send:'Continue the original request\r'},
        {wait:tr('review.openConfirmation'),...before,send:'\r'},
        {wait:confirm,...before,send:confirm+'\r'},
        {wait:tr('workRecovery.extended',{kind}),...after,send:'\x1b'},
        {wait:openActions,...after,frame:{contains:[original,failure]},send:'\r'},
        {wait:tr('input.recoveryChoose'),...after,frame:{contains:[retry]},send:retry+'\r'},
        {wait:tr('response.delivered'),waitIdle:true,assertDraft:draft,expectedInputs:1,queries:[
            {sql:'SELECT state,text FROM conversation_inputs',rows:[['CONSUMED',original]]},
            {sql:'SELECT COUNT(*),COUNT(DISTINCT work) FROM runs',rows:[[2,1]]},budget(5,2),
        ],send:'\x07q'},
    ],['--import',guard]);
    assert.equal(requests.length,1);
    const user=requests[0].messages.filter(message=>message.role==='user').at(-1);
    assert.equal(typeof user.content==='string'?user.content:user.content.map(part=>part.text).join(''),original);
    f.pass();
});

for (const locale of ['en', 'ko']) test('readiness reports exact queued execution stage in '+locale, {timeout:25000}, async t=>{
    const f = await fixture(t), tr = translator(locale);
    const releaseCapacity = path.join(f.root,'release-capacity'), releaseModel = path.join(f.root,'release-model');
    const guard = path.join(f.root,'hold-capacity.mjs');
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {Capacity} from ${JSON.stringify(cliModule('controller/capacity.js'))};
const acquire=Capacity.prototype.acquire;
Capacity.prototype.acquire=async function (...args) {
    const pump=this.pump;
    this.pump=()=>{};
    let queued;
    try {queued=acquire.apply(this,args);} finally {this.pump=pump;}
    void queued.catch(()=>{});
    while(!await fs.access(${JSON.stringify(releaseCapacity)}).then(()=>true,()=>false))
        await new Promise(resolve=>setTimeout(resolve,10));
    this.pump();
    return queued;
};
`);
    const {requests} = await startResponseProvider(t,f.home,releaseModel);
    const label = tr('activity.stage.capacity');
    const recommendation = tr('ready.localRequestNext',{status:label});
    const waiting = [{sql:'SELECT phase FROM runs',rows:[['WAITING_CAPACITY']]}];
    await launch(f,'readiness-capacity',[
        {wait:'/ready',send:'Check preparation and response stages\r'},
        {wait:label,queries:waiting,assertDraft:'',expectedInputs:1,send:'\x07t'},
        {wait:tr('ready.title'),frame:{contains:[recommendation],editorFocused:false},queries:waiting,send:'\r'},
        {wait:label,frame:{contains:[label],editorFocused:true},queries:waiting,releaseFile:releaseCapacity,send:''},
        {wait:tr('activity.stage.model'),releaseFile:releaseModel,send:''},
        {wait:tr('response.delivered'),waitIdle:true,assertDraft:'',expectedInputs:1,send:'\x07q'},
    ],['--import',guard],locale);
    assert.equal(requests.length,1);
    f.pass();
});

test('a delayed rejected dispatch keeps the newer pane diagnostic', {timeout:25000}, async t=>{
    const f=await fixture(t), release=path.join(f.root,'release-refusal'), settled=path.join(f.root,'settled-refusal');
    const {requests}=await startResponseProvider(t,f.home);
    const guard=path.join(f.root,'refuse-original.mjs');
    const original='Keep this earlier received input', earlier='OWNED_EARLIER_REQUEST_REFUSAL';
    const later='Unknown registered project; open /project to select or register one';
    await fs.writeFile(guard,`import fs from 'node:fs';
import {Controller} from ${JSON.stringify(cliModule('controller/controller.js'))};
Controller.prototype.runConversation=async function () {
    while(!fs.existsSync(${JSON.stringify(release)}))
        await new Promise(resolve=>setTimeout(resolve,10));
    setTimeout(()=>fs.writeFileSync(${JSON.stringify(settled)},'settled'),0);
    throw Error(${JSON.stringify(earlier)});
};
`);
    const retained=[
        {sql:'SELECT state,text FROM conversation_inputs',rows:[['QUEUED',original]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
    ];
    const output=await launch(f,'stale-dispatch-refusal',[
        {wait:'/ready',send:original+'\r'},
        {wait:'Request received · waiting to start',queries:retained,send:'/project missing-fixture-project\x1b\r'},
        {wait:later,queries:retained,releaseFile:release,send:''},
        {wait:'',waitFiles:[{path:settled,value:'settled'}],frame:{contains:[later],excludes:[earlier],editorFocused:true},queries:retained,send:'\x07e'},
        {wait:'Error recovery · choose a next step',send:'Error details\r'},
        {wait:'Error details · inspection only',frame:{contains:[later],excludes:[earlier]},send:'\x1b'},
        {wait:'Error recovery · choose a next step',send:'\x1b'},
        {wait:later,frame:{contains:[later],editorFocused:true},queries:retained,send:'\x07q'},
    ],['--import',guard]);
    assert.doesNotMatch(output,new RegExp(earlier));
    assert.equal(requests.length,0);
    f.pass();
});

test('file-completion feedback leaves the active submitted capture failure and its exact recovery available', {timeout:20000}, async t=>{
    const f=await fixture(t),project=path.join(f.root,'project'),many=path.join(project,'many');
    await fs.mkdir(many,{recursive:true,mode:0o700});
    await Promise.all(Array.from({length:51},(_,i)=>fs.writeFile(path.join(many,'f'+i),'owned fixture')));
    await fs.symlink('many/f0',path.join(project,'unsupported-link'));
    const controller=await openController({installationHome:f.home}),accounts=ApplicationAccounts.open(controller);
    try {
        await controller.registerProject({id:'P',sourceRoot:project});
        await accounts.configure({providers:{'capture-owned':{api:'openai-completions',apiKey:'UNUSED',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
        await accounts.setDefault('capture-owned','fixture');
        const view=await new ApplicationModels(controller).newConversation({projectId:'P'});
        controller.setConversationView({selectedId:view.conversationId});
        const {ApplicationStartup}=await import('../../dist/app/startup.js');
        await ApplicationStartup.open(controller).save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'UNUSED_CAPTURE',image:'sha256:'+'0'.repeat(64)}});
    } finally {await controller.close();}
    const original='Read the original project',draft='Inspect @many/f';
    const retained={
        assertDraft:draft,expectedInputs:1,
        queries:[
            {sql:'SELECT text FROM conversation_inputs',rows:[[original]]},
            {sql:'SELECT phase FROM runs',rows:[['SETTLED']]},
        ],
    };
    const output=await launch(f,'capture-failure-completion',[
        {wait:'/ready setup',send:original+'\x1b\r'},
        {wait:'Project capture stopped at a symbolic link',waitIdle:true,send:draft+'\t'},
        {wait:'Showing 50 file matches · type more of the path',...retained,send:'\x07'},
        {wait:'Commands · Ctrl+G, then a letter',send:'e'},
        {wait:'Error recovery · choose a next step',...retained,send:'Review original request\r'},
        {wait:'Open recovery actions',...retained,terminate:true,send:''},
    ],['--import',path.resolve('tests/cli/account-ui-no-network.mjs')]);
    assert.match(output,/unsupported-link/);
    assert.doesNotMatch(output,/Previous error/);
    f.pass();
});

test('reopened pre-dispatch failure offers the exact retained request and honors withdrawal', {timeout:25000}, async t => {
    const f = await fixture(t), failure = 'Controlled capacity failure before dispatch';
    const {requests, view} = await startResponseProvider(t,f.home);
    const guard = await failFirstCapacity(f,failure);
    const original = 'Retain me before provider dispatch';
    const retained = [
        {sql:'SELECT state,text FROM conversation_inputs',rows:[['INITIAL_RESERVED',original]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[1]]},
    ];
    await launch(f,'predispatch-original',[
        {wait:'/ready setup',send:original+'\x1b\r'},
        {wait:failure,waitIdle:true,queries:retained,send:'\x07q'},
    ],['--import',guard]);
    await launch(f,'predispatch-reopen',[
        {wait:failure,queries:retained,send:'\x07e'},
        {wait:'Review original request',send:'Review original request\r'},
        {wait:'Open recovery actions',queries:retained,send:'\r'},
        {wait:'This exact request · choose explicitly',send:'Withdraw original request\r'},
        {wait:'Request withdrawn. Its text and attempts are kept.',queries:[
            {sql:'SELECT state,text FROM conversation_inputs',rows:[['CONFLICTED',original]]},
            retained[1],
        ],send:'\x07q'},
    ]);
    const c = await openController({installationHome:f.home});
    try { assert.equal(c.inspectConversationResponseFailure(view.conversationId),null); }
    finally { await c.close(); }
    assert.equal(requests.length,0);
    f.pass();
});

for (const locale of ['en', 'ko']) test(`${locale} additional send cancellation leaves the accepted request and its clock visible`, {timeout: 25000}, async t => {
    const f = await fixture(t);
    const {requests, marker} = await startResponseProvider(t, f.home);
    const dist = path.resolve(path.dirname(await fs.realpath(cli)), '..');
    const guard = path.join(f.root, 'hold-overlapping-input.mjs');
    const holdModel = path.join(f.root, 'hold-model'), enteredModel = path.join(f.root, 'entered-model');
    const releaseModel = path.join(f.root, 'release-model'), enterCapacity = path.join(f.root, 'enter-capacity');
    const releaseCapacity = path.join(f.root, 'release-capacity'), releaseStartup = path.join(f.root, 'release-startup');
    await fs.writeFile(guard, `import fs from 'node:fs/promises';
import {Capacity} from ${JSON.stringify(pathToFileURL(path.join(dist,'controller/capacity.js')).href)};
import {ApplicationModels} from ${JSON.stringify(pathToFileURL(path.join(dist,'app/models.js')).href)};
let clock = performance.now();
Object.defineProperty(performance, 'now', {value: () => clock});
const acquire = Capacity.prototype.acquire;
Capacity.prototype.acquire = async function(options) {
    clock += 20000;
    while (!options.signal.aborted && !await present(${JSON.stringify(enterCapacity)})) await pause();
    const limit = this.limit;
    this.limit = 0; // Hold the real capacity queue until the terminal observes it.
    let pending;
    try { pending = acquire.call(this, options); }
    finally { this.limit = limit; }
    while (!options.signal.aborted && !await present(${JSON.stringify(releaseCapacity)})) await pause();
    this.changed();
    const lease = await pending;
    while (!options.signal.aborted && !await present(${JSON.stringify(releaseStartup)})) await pause();
    return lease;
};
const resolve = ApplicationModels.prototype.resolve;
let held = false;
ApplicationModels.prototype.resolve = async function(...args) {
    if (!held && await present(${JSON.stringify(holdModel)})) {
        held = true;
        clock += 10000;
        await fs.writeFile(${JSON.stringify(enteredModel)}, 'checking');
        while (!await present(${JSON.stringify(releaseModel)})) await pause();
    }
    return resolve.apply(this, args);
};
const present = file => fs.access(file).then(() => true, () => false);
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
`);
    const copy = locale === 'ko'
        ? {ready:'/ready 설정', received:'요청 접수됨 · 실행 시작 대기', capacity:'실행 차례 기다리는 중', starting:'요청 실행 시작 중', extra:'추가 입력 · ', checking:'선택한 모델 확인 중', cancelling:'준비 취소 중', cancelled:'요청 준비 취소됨', complete:'응답 완료', seconds:'초'}
        : {ready:'/ready setup', received:'Request received · waiting to start', capacity:'Waiting for execution capacity', starting:'Starting request', extra:'Additional input · ', checking:'Checking selected model', cancelling:'Cancelling preparation', cancelled:'Request preparation cancelled', complete:'Response complete', seconds:'s'};
    const first = 'First accepted request 한글', second = 'Second unsent request';
    const originalOnly = [
        {sql:'SELECT COUNT(*) FROM runs', rows:[[1]]},
        {sql:'SELECT text,state FROM conversation_inputs', rows:[[first,'INITIAL_RESERVED']]},
    ];
    const output = await launch(f, 'overlapping', [
        {wait:copy.ready, send:first+'\x1b\r'},
        {wait:copy.received+' · 20'+copy.seconds, queries:[...originalOnly, {sql:'SELECT COUNT(*) FROM capacity_leases',rows:[[0]]}], releaseFile:enterCapacity, send:''},
        {wait:copy.capacity, queries:[...originalOnly, {sql:'SELECT state FROM capacity_leases',rows:[['QUEUED']]}], releaseFile:holdModel, send:second+'\x1b\r'},
        {wait:copy.extra+copy.checking, waitFiles:[{path:enteredModel,value:'checking'}], queries:originalOnly, assertDraft:second, expectedInputs:1, send:''},
        {wait:copy.capacity+' · 30'+copy.seconds, queries:originalOnly, send:'\x1b'},
        {wait:copy.extra+copy.cancelling, queries:originalOnly, releaseFile:releaseModel, send:''},
        {wait:copy.cancelled, queries:originalOnly, releaseFile:releaseCapacity, send:''},
        {wait:copy.starting+' · 30'+copy.seconds, queries:[...originalOnly, {sql:'SELECT state FROM capacity_leases',rows:[['ADMITTED']]}], releaseFile:releaseStartup, send:''},
        {wait:copy.complete, waitIdle:true, assertDraft:second, expectedInputs:1, terminate:true, send:''},
    ], ['--import',guard], locale);
    const {actionOutputOffsets} = JSON.parse(await fs.readFile(path.join(f.root,'overlapping.terminal.progress.json'),'utf8'));
    const beforeResponse = Buffer.from(output).subarray(0, actionOutputOffsets[6]).toString();
    assert.ok(beforeResponse.includes(translator(locale)('pane.outgoing', {preview:first})),
        'Durably accepted original text is visible before native model entry');
    const overlapping = Buffer.from(output).subarray(actionOutputOffsets[2], actionOutputOffsets[5]).toString();
    assert.doesNotMatch(overlapping.replaceAll(copy.extra + copy.cancelling, ''), new RegExp(copy.cancelling + '.*· \\d+' + copy.seconds));
    const ages = [...overlapping.matchAll(new RegExp(copy.capacity + ' · (\\d+)'+copy.seconds, 'g'))].map(match => Number(match[1]));
    assert.ok(ages.length && ages.every(age => age >= 20), `Original capacity wait elapsed times: ${ages}`);
    assert.equal(requests.length, 1);
    assert.match(output, new RegExp(marker));
    f.pass();
});

for (const locale of ['en', 'ko']) test(`narrow request activity keeps the full phase and response interrupt in ${locale}`, {timeout: 25000}, async t => {
    const f=await fixture(t), tr=translator(locale), {requests,marker,view}=await startResponseProvider(t,f.home);
    const guard=path.join(f.root,'narrow-capacity.mjs');
    const enter=path.join(f.root,'enter-capacity'), admit=path.join(f.root,'admit-capacity'), start=path.join(f.root,'start-response');
    const names=['accepted','capacity','starting'];
    const samples=Object.fromEntries(names.map(name=>[name,path.join(f.root,name+'.activity')]));
    const original='Keep status visible',draft='Independent 한글 draft', interrupt=tr('activity.interrupt').trim();
    const copy=locale==='ko'?{
        acceptedMarker:'요청 접수',capacityMarker:'실행 차례',startingMarker:'요청 실행 시작 중',
        accepted:['접수 · 실행 대기','요청 접수됨 · 실행 시작 대기'],capacity:['실행 차례 대기','실행 차례 기다리는 중'],starting:['요청 실행 시작 중'],
    }:{
        acceptedMarker:'Request',capacityMarker:'execution',startingMarker:'Starting request',
        accepted:['Request queued'],capacity:['In execution queue'],starting:['Starting request'],
    };
    const phaseLabels={accepted:[tr('activity.queued'),...copy.accepted],capacity:[tr('activity.stage.capacity'),...copy.capacity],starting:copy.starting};
    const headings={
        accepted:locale==='en' ? copy.accepted[0] : tr('activity.queued'),
        capacity:tr('activity.stage.capacity'),
        starting:tr('activity.stage.starting'),
    };
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {stripVTControlCharacters} from 'node:util';
import {Capacity} from ${JSON.stringify(cliModule('controller/capacity.js'))};
import {ConversationActivity} from ${JSON.stringify(cliModule('ui/conversation-activity.js'))};
const acquire=Capacity.prototype.acquire;
let stage;
const render=ConversationActivity.prototype.render;
const sampled=new Set(), paths=${JSON.stringify(samples)}, labels=${JSON.stringify(phaseLabels)};
ConversationActivity.prototype.render=function(width){
 const lines=render.call(this,width);
 if(stage&&!sampled.has(stage)&&labels[stage].includes(this.statusLabel())){
  const line=lines.map(stripVTControlCharacters).find(value=>/^[◐◓◑◒]/u.test(value.trim()));
  if(line){writeFileSync(paths[stage],line);writeFileSync(paths[stage]+'.ready','rendered');sampled.add(stage);}
 }
 return lines;
};
let clock=performance.now();
Object.defineProperty(performance,'now',{value:()=>clock});
Capacity.prototype.acquire=async function(options){
 const wait=async file=>{while(!options.signal.aborted&&!await fs.access(file).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));};
 stage='accepted';
 clock+=20000;
 await wait(${JSON.stringify(enter)});
 stage='capacity';
 clock+=1000;
 const limit=this.limit; this.limit=0;
 let pending;
 try{pending=acquire.call(this,options);}finally{this.limit=limit;}
 await wait(${JSON.stringify(admit)});
 stage='starting';
 clock+=1000;
 this.changed();
 const lease=await pending;
 await wait(${JSON.stringify(start)});
 return lease;
};
`);
    const reserved=[{sql:'SELECT text,state FROM conversation_inputs',rows:[[original,'INITIAL_RESERVED']]},{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}];
    const lease=state=>({sql:'SELECT state FROM capacity_leases',rows:state===null?[]:[[state]]});
    const stage=(phase,wait,state,releaseFile,send='')=>({wait,queries:[...reserved,lease(state)],releaseFile,send,waitFiles:[{path:samples[phase]+'.ready',value:'rendered'}],
        frame:{contains:[interrupt,tr('pane.input')+' · '+headings[phase]],editorFocused:true,selected:view.conversationId,draft:''},assertDraft:'',expectedInputs:1});
    const name='narrow-request';
    const output=await launch(f,name,[
        {wait:tr('footer.setup'),send:original+'\x1b\r'},
        stage('accepted',copy.acceptedMarker,null,enter),
        stage('capacity',copy.capacityMarker,'QUEUED',admit),
        stage('starting',copy.startingMarker,'ADMITTED',start,draft),
        {wait:tr('response.delivered'),waitIdle:true,assertDraft:draft,expectedInputs:1,queries:[
            {sql:'SELECT text,state FROM conversation_inputs',rows:[[original,'CONSUMED']]},
            {sql:"SELECT phase,json_extract(data,'$.outcome') FROM runs",rows:[['SETTLED','delivered']]},
        ],send:'\x07q'},
    ],['--import',guard],locale,42);
    const activity=await Promise.all(names.map(async phase=>({phase,line:await fs.readFile(samples[phase],'utf8')})));
    assert.ok(activity.every(({phase,line})=>line.includes(interrupt)&&!line.includes('…')&&copy[phase].some(label=>line.includes(label))),
        'Narrow activity must preserve each full stage and Escape hint: '+JSON.stringify(activity));
    for(const [index,{line}] of activity.entries())
        assert.ok(line.includes(' · '+(20+index)+(locale==='ko'?'초':'s')), 'Keep the original elapsed clock when it fits: '+line);
    assert.equal(requests.length,1);
    assert.ok(output.includes(marker));
    f.pass();
});

test('a split response and both drafts keep their owners across terminal resize', {timeout: 20000}, async t => {
    const f = await fixture(t), release = path.join(f.root, 'release-response');
    const {requests, marker, view} = await startResponseProvider(t, f.home, release);
    const otherDraft = 'Other pane draft', original = 'Respond only in the first pane', waitingDraft = 'Unsent first pane draft';
    const c = await openController({installationHome:f.home});
    const {conversationId:other} = c.createConversation();
    c.setDraft({conversationId:other, expectedRevision:0, text:otherDraft});
    c.setConversationView({selectedId:view.conversationId, secondId:other});
    await c.close();

    const pair = (id, companion) => ({sql:'SELECT selected,second FROM interaction_view', rows:[[id,companion]]});
    const owner = view.conversationId;
    const active = (id, draft, contains, rows = 36) => ({selected:id, draft, editorFocused:true, contains, rows});
    const modelWait = 'Waiting for model response', shortcut = 'Esc interrupt';
    const run = {sql:'SELECT text,state FROM conversation_inputs', rows:[[original,'CONSUMED']]};
    await launch(f, 'live-split', [
        {wait:otherDraft, frame:active(owner,'',[otherDraft]), queries:[pair(owner,other)], send:original+'\x1b\r'},
        {wait:modelWait, frame:active(owner,'',[modelWait,shortcut,otherDraft]), queries:[run], send:'\x07w'},
        {wait:'VIEW · '+modelWait, frame:active(other,otherDraft,['VIEW · '+modelWait]), queries:[pair(other,owner),run],
            resize:{columns:42,rows:24}, send:''},
        {wait:'', frame:active(other,otherDraft,[otherDraft],24), queries:[pair(other,owner),run], send:'\x05 edited'},
        {wait:otherDraft+' edited', frame:active(other,otherDraft+' edited',[],24), send:'\x07w'},
        {wait:'Awaiting model', frame:active(owner,'',[modelWait,'Awaiting model',shortcut],24),
            queries:[pair(owner,other),run], send:waitingDraft},
        {wait:waitingDraft, frame:active(owner,waitingDraft,['Awaiting model'],24), resize:{columns:100,rows:32}, send:''},
        {wait:'', frame:active(owner,waitingDraft,[modelWait,shortcut,otherDraft+' edited'],32), queries:[pair(owner,other),run],
            releaseFile:release, send:''},
        {wait:marker, assertDraft:waitingDraft, expectedInputs:1, waitIdle:true, queries:[pair(owner,other),run,
            {sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[other],rows:[[otherDraft+' edited']]},
            {sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}], send:'\x07q'},
    ], [], 'en', 100);
    const frame = async stage => (JSON.parse(await fs.readFile(path.join(f.root,'live-split.terminal.frame-'+stage+'.json'),'utf8'))).frame.join('\n');
    assert.ok(!(await frame(2)).includes(shortcut), 'Only the focused pane may advertise interrupt');
    assert.ok(!(await frame(3)).includes(modelWait), 'The inactive response pane stays hidden at 42 columns');
    assert.equal(requests.length,1);
    f.pass();
});

for (const newerError of [false, true]) test(newerError
    ? 'terminal keeps a newer active error when an older retained request succeeds'
    : 'terminal readiness opens the exact startup failure and preserves it as history after retry', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const release = newerError ? path.join(f.root, 'release') : undefined;
    const { requests, marker } = await startResponseProvider(t, f.home, release);
    const original = 'Retry this exact original request';
    const separateDraft = 'Separate draft 한국어';
    const keptDraft = newerError ? '' : separateDraft;
    const failure = 'Controlled first startup failure';
    const replacement = 'Unknown registered project; open /project to select or register one';
    const guard = await failFirstCapacity(f, failure);
    const tr = translator('en');
    const recoveryTitle = newerError ? tr('error.title') : tr('ready.title');
    const recoveryAction = newerError ? tr('error.originalInput') : tr('ready.failedRequestNext');
    const reserved = [
        { sql: 'SELECT state,text FROM conversation_inputs', rows: [['INITIAL_RESERVED', original]] },
        { sql: 'SELECT COUNT(*) FROM runs', rows: [[1]] },
        { sql: "SELECT consumed,reserved FROM budgets WHERE kind='execution'", rows: [[1, 0]] },
    ];
    const openRecovery = { wait: recoveryTitle, assertDraft: keptDraft, expectedInputs: 1, queries: reserved,
        frame: { contains: [recoveryAction], editorFocused: false }, send: recoveryAction+'\r' };
    const output = await launch(f, 'retry-settlement', [
        { wait: '/ready setup', send: original + '\x1b\r' },
        { wait: failure, waitIdle: true, assertDraft: '', expectedInputs: 1, send: newerError ? '\x07e' : separateDraft },
        ...newerError ? [] : [{ wait: separateDraft, assertDraft: separateDraft, expectedInputs: 1, send: '\x07t' }],
        openRecovery,
        { wait: 'Open recovery actions', frame:{contains:[original, failure]}, queries:reserved, send: '\x1b' },
        openRecovery,
        { wait: 'Open recovery actions', send: '\r' },
        { wait: 'This exact request · choose explicitly', send: 'Retry original request\r' },
        ...release ? [
            { wait: 'Waiting for model response', send: '/project missing-fixture-project\x1b\r' },
            { wait: replacement, releaseFile: release, send: '' },
        ] : [],
        { wait: newerError ? marker : 'Response complete', waitIdle: true, queries: [
            { sql: 'SELECT state,text FROM conversation_inputs', rows: [['CONSUMED', original]] },
            { sql: 'SELECT COUNT(*),COUNT(DISTINCT work) FROM runs', rows: [[2, 1]] },
            { sql: "SELECT consumed,reserved FROM budgets WHERE kind='execution'", rows: [[2, 0]] },
        ], ...newerError ? {} : {assertDraft: keptDraft, expectedInputs: 1}, send: '\x07e' },
        { wait: newerError ? 'Error recovery · choose a next step' : 'Previous error · choose a next step', send: 'Error details\r' },
        { wait: newerError ? 'Error details · inspection only' : 'Previous error details', terminate: true, send: '' },
    ], ['--import', guard]);
    assert.ok(output.includes(marker));
    const detailTitle = newerError ? 'Error details · inspection only' : 'Previous error details';
    assert.ok(output.slice(output.lastIndexOf(detailTitle)).includes(newerError ? replacement : failure));
    assert.equal(requests.length, 1);
    const user = requests[0].messages.filter(message => message.role === 'user').at(-1);
    assert.equal(typeof user.content === 'string' ? user.content : user.content.map(item => item.text).join(''), original);
    f.pass();
});

test('withdrawing an older failed request keeps a newer unrelated error active', { timeout: 25000 }, async t => {
    const f = await fixture(t);
    const { requests } = await startResponseProvider(t, f.home);
    const original = 'Withdraw only this original request';
    const failure = 'Controlled first startup failure';
    const replacement = 'Unknown registered project; open /project to select or register one';
    const guard = await failFirstCapacity(f, failure);
    const output = await launch(f, 'withdraw-unrelated', [
        { wait: '/ready setup', send: original + '\x1b\r' },
        { wait: failure, waitIdle: true, send: '/project missing-fixture-project\x1b\r' },
        { wait: replacement, send: '\x07e' },
        { wait: 'Error recovery · choose a next step', send: 'Review retained requests\r' },
        { wait: 'Retained requests · separate', send: '\r' },
        { wait: 'Open recovery actions', send: '\r' },
        { wait: 'This exact request · choose explicitly', send: 'Withdraw original request\r' },
        { wait: 'Request withdrawn. Its text and attempts are kept.', queries: [
            { sql: 'SELECT state,text FROM conversation_inputs', rows: [['CONFLICTED', original]] },
            { sql: 'SELECT COUNT(*) FROM runs', rows: [[1]] },
        ], send: '\x07e' },
        { wait: 'Error recovery · choose a next step', send: 'Error details\r' },
        { wait: 'Error details · inspection only', terminate: true, send: '' },
    ], ['--import', guard]);
    assert.ok(output.slice(output.lastIndexOf('Error details · inspection only')).includes(replacement));
    assert.equal(requests.length, 0);
    f.pass();
});

test('held request preparation stays attributed across navigation and rejects duplicate Enter without losing a newer draft',{timeout:25000},async t=>{
    const f=await fixture(t),hold=path.join(f.root,'hold'),entered=path.join(f.root,'entered'),release=path.join(f.root,'release');
    const c=await openController({installationHome:f.home}),accounts=ApplicationAccounts.open(c);
    await accounts.configure({providers:{'activity-preflight':{api:'openai-completions',apiKey:'DUMMY_ACTIVITY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
    await accounts.setDefault('activity-preflight','fixture');const models=new ApplicationModels(c),first=await models.newConversation(),second=await models.newConversation();
    c.setConversationName({conversationId:first.conversationId,expectedGeneration:0,name:'Preparation owner'});
    c.setConversationName({conversationId:second.conversationId,expectedGeneration:0,name:'Other pane'});
    c.setConversationView({selectedId:first.conversationId});await c.close();
    const guard=path.join(f.root,'guard.mjs');
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {ApplicationModels} from ${JSON.stringify(cliModule('app/models.js'))};
const original=ApplicationModels.prototype.resolve;let calls=0;
ApplicationModels.prototype.resolve=async function(...args){if(await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false)){await fs.writeFile(${JSON.stringify(entered)},String(++calls));while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));}return original.apply(this,args);};
`);
    const output=await launch(f,'preparation',[
        {wait:'/ready setup',releaseFile:hold,send:'Original held request\x1b\r'},
        {wait:'Checking selected model',waitFiles:[{path:entered,value:'1'}],queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\r\x07c'},
        {wait:'Conversations',send:'Other pane\r'},
        {wait:'Other pane',expectedSelected:second.conversationId,assertDraft:'',send:'\x07c'},
        // The incremental redraw can retain the chooser title when reopening immediately.
        {wait:'Search: name, ID or project',send:'Preparation owner\r'},
        {wait:'Checking selected model',expectedSelected:first.conversationId,assertDraft:'Original held request',send:'\r\x15NEWER exact draft'},
        {wait:'NEWER exact draft',textFiles:[{path:entered,value:'1'}],releaseFile:release,send:''},
        {wait:'Input target or exact draft changed before file capture',waitIdle:true,expectedSelected:first.conversationId,assertDraft:'NEWER exact draft',expectedInputs:0,queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],terminate:true,send:''},
    ],['--import',guard]);
    assert.match(output,/Checking selected model/);assert.match(output,/Error details and recovery/);
    assert.equal(await fs.readFile(entered,'utf8'),'1');f.pass();
});

test('project folder and model checks share one visible preparation clock before admission', {timeout:20000}, async t=>{
    const f = await fixture(t), project = path.join(f.root, 'project');
    await fs.mkdir(project, {mode:0o700});
    const {ApplicationStartup} = await import('../../dist/app/startup.js');
    const c = await openController({installationHome:f.home}), accounts = ApplicationAccounts.open(c);
    try {
        await c.registerProject({id:'P',sourceRoot:project});
        await accounts.configure({providers:{'project-send':{api:'openai-completions',apiKey:'UNUSED',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
        await accounts.setDefault('project-send','fixture');
        c.setConversationView({selectedId:(await new ApplicationModels(c).newConversation({projectId:'P'})).conversationId});
        await ApplicationStartup.open(c).save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'UNUSED_SEND',image:'sha256:'+'0'.repeat(64)}});
    } finally { await c.close(); }
    const [arm, source, model, releaseSource, releaseModel, guard] = ['arm','source','model','release-source','release-model','send-guard.mjs'].map(name=>path.join(f.root,name));
    await fs.writeFile(guard, `import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {ApplicationModels} from ${JSON.stringify(cliModule('app/models.js'))};
let clock=performance.now(), held=false;
Object.defineProperty(performance,'now',{value:()=>clock});
const present=file=>fs.access(file).then(()=>true,()=>false);
const until=async file=>{while(!await present(file))await new Promise(resolve=>setTimeout(resolve,10));};
const lstat=fs.lstat;
fs.lstat=async function(directory,...args){
    if(directory===${JSON.stringify(project)}&&!held&&await present(${JSON.stringify(arm)})){
        held=true;
        clock+=12000;
        await fs.writeFile(${JSON.stringify(source)},'checking');
        await until(${JSON.stringify(releaseSource)});
    }
    return lstat.call(this,directory,...args);
};
syncBuiltinESMExports();
const resolve=ApplicationModels.prototype.resolve;
ApplicationModels.prototype.resolve=async function(...args){
    await fs.writeFile(${JSON.stringify(model)},'checking');
    await until(${JSON.stringify(releaseModel)});
    return resolve.apply(this,args);
};`);
    const draft = 'Keep this project request', empty = ['runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    await launch(f,'project-send',[
        {wait:'/ready setup',releaseFile:arm,send:draft+'\x1b\r'},
        {wait:'Checking project folder · 12s',waitFiles:[{path:source,value:'checking'}],queries:empty,assertDraft:draft,send:'\x07t'},
        {wait:'Setup and next actions',frame:{contains:['Next step · Checking project folder · return to the conversation']},queries:empty,assertDraft:draft,send:'\r'},
        {wait:'Checking project folder',frame:{editorFocused:true,contains:['Checking project folder']},queries:empty,assertDraft:draft,releaseFile:releaseSource,send:''},
        {wait:'Checking selected model · 12s',waitFiles:[{path:model,value:'checking'}],queries:empty,assertDraft:draft,send:'\x1b'},
        {wait:'Cancelling preparation',releaseFile:releaseModel,send:''},
        {wait:'Request preparation cancelled',queries:empty,assertDraft:draft,send:'\x07q'},
    ],['--import',guard]);
    f.pass();
});

test('admitted capture updates the heading without input, then Escape shows interruption instead of capture', {timeout:20000}, async t=>{
    const f=await fixture(t),project=path.join(f.root,'project'),entered=path.join(f.root,'capture-entered'),release=path.join(f.root,'capture-release');
    await fs.mkdir(project,{mode:0o700});
    await fs.writeFile(path.join(project,'owned.txt'),'owned project content');
    const controller=await openController({installationHome:f.home}),accounts=ApplicationAccounts.open(controller);
    try {
        await controller.registerProject({id:'P',sourceRoot:project});
        await accounts.configure({providers:{'capture-owned':{api:'openai-completions',apiKey:'UNUSED',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
        await accounts.setDefault('capture-owned','fixture');
        const view=await new ApplicationModels(controller).newConversation({projectId:'P'});
        controller.setConversationView({selectedId:view.conversationId});
        const {ApplicationStartup}=await import('../../dist/app/startup.js');
        await ApplicationStartup.open(controller).save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'UNUSED_CAPTURE',image:'sha256:'+'0'.repeat(64)}});
    } finally {await controller.close();}
    const guard=path.join(f.root,'capture-guard.mjs'),staging=path.join(f.home,'inputs')+path.sep;
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const mkdir=fs.mkdir;
fs.mkdir=async function(directory,...options){
 const result=await mkdir.call(this,directory,...options);
 if(!String(directory).startsWith(${JSON.stringify(staging)}))return result;
 await fs.writeFile(${JSON.stringify(entered)},'capture');
 while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await delay(15);
 return result;
};`);
    const admitted=[{sql:'SELECT phase FROM runs',rows:[['CAPTURING']]}];
    await launch(f,'capture-heading',[
        {wait:'/ready setup',send:'Original capture request\x1b\r'},
        {wait:'INPUT · Reading project snapshot',queries:admitted,waitFiles:[{path:entered,value:'capture'}],assertDraft:'',expectedInputs:1,send:'\x1b'},
        {wait:'INPUT · Stopping request · waiting for cleanup',queries:admitted,releaseFile:release,send:''},
        {wait:'Retained request · 1 pending',waitIdle:true,queries:[{sql:'SELECT phase FROM runs',rows:[['SETTLED']]},{sql:'SELECT text,state FROM conversation_inputs',rows:[['Original capture request','QUEUED']]}],send:'\x07q'},
    ],['--import',guard]);
    f.pass();
});

for (const settlement of [{status:'interrupted',cleanup:'unbound'}, {status:'delivered',cleanup:'quarantined'}, {status:'delivered',cleanup:'unbound'}]) {
    test(`actual shell UI reports ${settlement.status}/${settlement.cleanup} and settles its activity without duplicate dispatch`,{timeout:15000},async t=>{
        const f=await fixture(t),entered=path.join(f.root,'entered'),release=path.join(f.root,'release');
        const c=await openController({installationHome:f.home}),accounts=ApplicationAccounts.open(c);
        await accounts.configure({providers:{'activity-shell':{api:'openai-completions',apiKey:'DUMMY_ACTIVITY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
        await accounts.setDefault('activity-shell','fixture');const view=await new ApplicationModels(c).newConversation();c.setConversationView({selectedId:view.conversationId});await c.close();
        const guard=path.join(f.root,'shell-guard.mjs');
        // Synthetic receipt at the changed UI boundary; no shell/runtime/engine claim.
        await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {Controller} from ${JSON.stringify(cliModule('controller/controller.js'))};
let calls=0;Controller.prototype.executeConversationBash=async function(options){await fs.writeFile(${JSON.stringify(entered)},JSON.stringify({calls:++calls,command:options.command}));while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));return ${JSON.stringify({...settlement,nativeResult:{exitCode:1}})};};
`);
        const completed=settlement.status==='delivered'&&settlement.cleanup==='unbound';
        const output=await launch(f,'shell',[
            {wait:'/ready setup',send:'!owned command\x1b\r'},
            {wait:'Running shell command',waitFiles:[{path:entered,value:'{"calls":1,"command":"owned command"}'}],send:'\r'},
            {wait:'· 1s',textFiles:[{path:entered,value:'{"calls":1,"command":"owned command"}'}],releaseFile:release,send:''},
            {wait:completed?'Shell command finished':settlement.status==='interrupted'?'Shell command interrupted':'Shell command needs attention',assertDraft:completed?'':'!owned command',expectedInputs:0,
                queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],terminate:true,send:''},
        ],['--import',guard]);
        assert.match(output,/Running shell command/);assert.equal(JSON.parse(await fs.readFile(entered,'utf8')).calls,1);
        const reopened=await openController({installationHome:f.home});try{assert.equal(reopened.inspectConversation(view.conversationId).draft.text,completed?'':'!owned command');}finally{await reopened.close();}
        f.pass();
    });
}

for (const [mode, statusUnavailable] of [['steer',false],['follow-up',false],['follow-up',true]]) test(
    `a ${mode} sent during a response is shown with its own pending meaning${statusUnavailable?' when the receipt status read fails':''}`,{timeout:25000},async t=>{
    const f=await fixture(t),release=path.join(f.root,'release'),requests=[],sockets=new Set();
    const routing=path.join(f.root,'routing'),releaseRouting=path.join(f.root,'release-routing'),guard=path.join(f.root,'routing.mjs');
    const marker='OWNED_DELAYED_RESPONSE';
    const server=http.createServer(async(req,res)=>{
        try {
            const chunks=[];for await(const chunk of req)chunks.push(chunk);
            requests.push(JSON.parse(Buffer.concat(chunks).toString()));
            // The terminal consumer, not a guessed delay, releases the first byte.
            while(!res.destroyed && !await fs.access(release).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));
            if(res.destroyed)return;
            res.writeHead(200,{'content-type':'text/event-stream'});
            const chunk=(delta,finish_reason=null)=>({id:'activity-owned',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
            res.write(`data: ${JSON.stringify(chunk({role:'assistant',content:marker}))}\n\n`);
            res.write(`data: ${JSON.stringify(chunk({},'stop'))}\n\n`);res.end('data: [DONE]\n\n');
        } catch(error){res.destroy(error);}
    });
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
    const c=await openController({installationHome:f.home}),accounts=ApplicationAccounts.open(c);
    await accounts.configure({providers:{'activity-owned':{api:'openai-completions',apiKey:'DUMMY_ACTIVITY',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture'}]}}});
    await accounts.setDefault('activity-owned','fixture');const view=await new ApplicationModels(c).newConversation();c.setConversationView({selectedId:view.conversationId});await c.close();
    const controllerDir=path.resolve(path.dirname(await fs.realpath(cli)),'../controller');
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {Interactions} from ${JSON.stringify(pathToFileURL(path.join(controllerDir,'interaction.js')).href)};
import {Controller} from ${JSON.stringify(pathToFileURL(path.join(controllerDir,'controller.js')).href)};
const pending=(store,id)=>store.one("SELECT id FROM conversation_inputs WHERE conversation=? AND state='QUEUED' AND mode=?", id, ${JSON.stringify(mode)});
if (${statusUnavailable}) {
    const inspect=Controller.prototype.hasLiveInputTarget;
    Controller.prototype.hasLiveInputTarget=function(id) {
        if (pending(this.store,id)) {
            Controller.prototype.hasLiveInputTarget=inspect;
            throw Error('Controlled receipt status read failure');
        }
        return inspect.call(this,id);
    };
}
const route = Interactions.prototype.route;
Interactions.prototype.route = async function(id) {
    if (this.hasLiveInputTarget(id) && pending(this.store,id)) {
        await fs.writeFile(${JSON.stringify(routing)}, 'entered');
        while (!await fs.access(${JSON.stringify(releaseRouting)}).then(()=>true,()=>false))
            await new Promise(resolve=>setTimeout(resolve,10));
    }
    return route.call(this,id);
};
`);
    const output=await launch(f,'follow-up',[
        {wait:'/ready setup',send:'Please summarize the README\x1b\r'},
        {wait:'Waiting for model response',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}],send:'Then list open issues'+(mode==='steer'?'\r':'\x1b\r')},
        {wait:'Additional input · Request received'+(statusUnavailable?'':' · checking delivery'),waitFiles:[{path:routing,value:'entered'}],
            queries:[{sql:'SELECT state FROM conversation_inputs WHERE mode=?',params:[mode],rows:[['QUEUED']]}],
            assertDraft:'',expectedInputs:2,releaseFile:releaseRouting,send:''},
        {wait:'Sent inputs waiting · 1 · '+(mode==='steer'?'Add to current response':'After current response'),releaseFile:release,send:''},
        {wait:'Response complete',terminate:true,send:''},
    ],['--import',guard]);
    assert.doesNotMatch(output,/Retained request ·|\/inputs to inspect/);
    if (statusUnavailable)
        assert.doesNotMatch(output,/checking delivery|Controlled receipt status read failure/);
    f.pass();
});

test('overlapping input preparation keeps its own clock across an earlier response settlement',{timeout:25000},async t=>{
 const f=await fixture(t),hold=path.join(f.root,'hold'),entered=path.join(f.root,'entered'),elapsed=path.join(f.root,'elapsed'),release=path.join(f.root,'release'),finishFirst=path.join(f.root,'finish-first'),finishSecond=path.join(f.root,'finish-second'),trace=path.join(f.root,'clock.jsonl'),requests=[],sockets=new Set();
 const server=http.createServer(async(req,res)=>{try{
  let body='';for await(const bytes of req)body+=bytes;const index=requests.length;requests.push(JSON.parse(body));res.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=(delta,finish_reason=null)=>({id:'clock-'+index,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
  if(index===0)res.write('data: '+JSON.stringify(chunk({role:'assistant',content:'FIRST_CLOCK_TOKEN'}))+'\n\n');
  while(!res.destroyed&&!await fs.access(index===0?finishFirst:finishSecond).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));
  if(res.destroyed)return;if(index!==0)res.write('data: '+JSON.stringify(chunk({role:'assistant',content:'SECOND_CLOCK_TOKEN'}))+'\n\n');
  res.write('data: '+JSON.stringify(chunk({},'stop'))+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){res.destroy(error);}});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 const c=await openController({installationHome:f.home}),accounts=ApplicationAccounts.open(c);await accounts.configure({providers:{'clock-owned':{api:'openai-completions',apiKey:'DUMMY_ACTIVITY_CLOCK',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture'}]}}});await accounts.setDefault('clock-owned','fixture');const view=await new ApplicationModels(c).newConversation();c.setConversationView({selectedId:view.conversationId});await c.close();
 const guard=path.join(f.root,'clock-guard.mjs');await fs.writeFile(guard,`import fs from 'node:fs';
import {ApplicationModels} from ${JSON.stringify(cliModule('app/models.js'))};
import {Controller} from ${JSON.stringify(cliModule('controller/controller.js'))};
import {ConversationActivity} from ${JSON.stringify(cliModule('ui/conversation-activity.js'))};
const write=row=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(row)+'\\n',{mode:0o600});let progress;
const inspect=Controller.prototype.inspectConversationProgress;Controller.prototype.inspectConversationProgress=function(...args){progress=Reflect.apply(inspect,this,args);return progress;};
const begin=ConversationActivity.prototype.beginPreparation;ConversationActivity.prototype.beginPreparation=function(owner){const value=Reflect.apply(begin,this,[owner]);write({kind:'prepare',started:this.preparation.started});return value;};
const update=ConversationActivity.prototype.update;ConversationActivity.prototype.update=function(...args){const value=Reflect.apply(update,this,args);write({kind:'update',runId:progress?.runId??null,active:this.active,started:this.started});return value;};
const render=ConversationActivity.prototype.render;ConversationActivity.prototype.render=function(width){
 const lines=Reflect.apply(render,this,[width]);
 if(this.preparation&&lines.some(line=>/Checking selected model · (?:[3-9]|[1-9]\\d+)s/u.test(line)))fs.writeFileSync(${JSON.stringify(elapsed)},'1');
 return lines;
};
const resolve=ApplicationModels.prototype.resolve;ApplicationModels.prototype.resolve=async function(...args){if(fs.existsSync(${JSON.stringify(hold)})&&!fs.existsSync(${JSON.stringify(release)})){fs.writeFileSync(${JSON.stringify(entered)},'1');while(!fs.existsSync(${JSON.stringify(release)}))await new Promise(r=>setTimeout(r,10));}return Reflect.apply(resolve,this,args);};
 `);
 const output=await launch(f,'clock',[
  {wait:'/ready setup',send:'First owned request\x1b\r'},
  {wait:'FIRST_CLOCK_TOKEN',send:''},
  {wait:'· 2s',releaseFile:hold,send:'Second owned request\x1b\r'},
  {wait:'Additional input · Checking selected model',waitFiles:[{path:entered,value:'1'}],releaseFile:finishFirst,send:''},
  {wait:'Checking selected model',queries:[{sql:"SELECT COUNT(*) FROM runs WHERE phase='SETTLED'",rows:[[1]]}],send:''},
  {wait:'',waitFiles:[{path:elapsed,value:'1'}],releaseFile:release,send:''},
  {wait:'Waiting for model response',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[2]]}],expectedInputs:2,releaseFile:finishSecond,send:''},
  {wait:'Response complete',waitIdle:true,send:'\x07q'},
 ],['--import',guard]);
 assert.match(output,/SECOND_CLOCK_TOKEN/);
 const rows=(await fs.readFile(trace,'utf8')).trim().split('\n').map(JSON.parse),preparations=rows.filter(r=>r.kind==='prepare'),ids=[...new Set(rows.filter(r=>r.runId).map(r=>r.runId))];assert.equal(requests.length,2);assert.equal(preparations.length,2);assert.equal(ids.length,2);
 const first=rows.find(r=>r.runId===ids[0]&&r.active),second=rows.find(r=>r.runId===ids[1]&&r.active);assert.equal(rows.slice(rows.indexOf(first),rows.indexOf(second)).some(r=>r.kind==='update'&&!r.active),false,'Actual updates overlap without an inactive reset');assert.equal(first.started,preparations[0].started);assert.equal(second.started,preparations[1].started);assert.notEqual(second.started,first.started);f.pass();
});
