import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {ApplicationKeybindings} from '../../dist/app/keybindings.js';
import {uiText} from '../../dist/ui/i18n.js';

const execute=promisify(execFile);
const cli=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js');
const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
for(const {locale,postReceipt=false,retainAtSettlement=false} of [
    {locale:'en'},{locale:'en',postReceipt:true},{locale:'ko'},{locale:'en',retainAtSettlement:true},
])test(retainAtSettlement?'A send during finalization stays retained when the original response finishes before admission':
    `A response keeps its actual status when stopping another send ${postReceipt?'after':'before'} receipt in ${locale}`,{timeout:25000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-live-input-'))),home=path.join(root,'home');
    let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained live input terminal '+root);});
    const providerEntered=path.join(root,'provider-entered'),firstOutput=path.join(root,'first-output'),releaseProvider=path.join(root,'provider-release'),requests=[],sockets=new Set();
    const finishingEntered=path.join(root,'finishing-entered'),releaseFinishing=path.join(root,'finishing-release');
    const server=http.createServer(async(req,res)=>{
        try {
            const chunks=[];for await(const chunk of req)chunks.push(chunk);
            requests.push(JSON.parse(Buffer.concat(chunks).toString()));
            res.writeHead(200,{'content-type':'text/event-stream'});
            const chunk=(delta,finish_reason=null)=>({id:'live-input-owned',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
            await fs.writeFile(providerEntered,'entered');
            while(!res.destroyed&&!await fs.access(firstOutput).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));
            if(res.destroyed)return;
            res.write(`data: ${JSON.stringify(chunk({role:'assistant',content:'OWNED_LIVE_RESPONSE '}))}\n\n`);
            while(!res.destroyed&&!await fs.access(releaseProvider).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));
            if(res.destroyed)return;
            res.write(`data: ${JSON.stringify(chunk({content:'COMPLETE'}))}\n\n`);
            res.write(`data: ${JSON.stringify(chunk({},'stop'))}\n\n`);res.end('data: [DONE]\n\n');
        } catch(error){res.destroy(error);}
    });
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
    const c=await openController({installationHome:home}),accounts=ApplicationAccounts.open(c);
    await accounts.configure({providers:{'live-input-owned':{api:'openai-completions',apiKey:'UNUSED',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'fixture'}]}}});
    await accounts.setDefault('live-input-owned','fixture');const view=await new ApplicationModels(c).newConversation();
    if(locale==='en'){
        const keys = new ApplicationKeybindings(c).file;
        await fs.mkdir(path.dirname(keys),{recursive:true,mode:0o700});
        await fs.writeFile(keys,JSON.stringify({'tui.input.submit':'ctrl+t'}),{mode:0o600});
    }
    await c.close();
    const hold=path.join(root,'hold-next'),entered=path.join(root,'next-entered'),release=path.join(root,'next-release'),released=path.join(root,'next-released'),guard=path.join(root,'hold.mjs');
    const originalJoined=path.join(root,'original-joined'),retainedText='Request sent while the original response is finalizing';
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {ApplicationModels} from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(cli),'../app/models.js')).href)};
import {Interactions} from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(cli),'../controller/interaction.js')).href)};
const original=ApplicationModels.prototype.resolve;
ApplicationModels.prototype.resolve=async function(...args){
 if(${postReceipt}||!await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false))return original.apply(this,args);
 await fs.writeFile(${JSON.stringify(entered)},'entered');
 while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));
 const result=await original.apply(this,args);await fs.writeFile(${JSON.stringify(released)},'released');return result;
};
${postReceipt?`const {Controller}=await import(${JSON.stringify(pathToFileURL(path.resolve(path.dirname(cli),'../controller/controller.js')).href)});
const enqueue = Controller.prototype.queueConversationInputWithContext;
Controller.prototype.queueConversationInputWithContext = async function (...args) {
 const receipt = await enqueue.apply(this,args);
 if(args[0].mode==='steer'){
  await fs.writeFile(${JSON.stringify(entered)},this.store.one('SELECT state FROM conversation_inputs WHERE id=?',receipt.inputId).state);
  while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));
  await fs.writeFile(${JSON.stringify(released)},'released');
 }
 return receipt;
};`:''}
${retainAtSettlement?`const {Controller}=await import(${JSON.stringify(pathToFileURL(path.resolve(path.dirname(cli),'../controller/controller.js')).href)});
const enqueue=Controller.prototype.queueConversationInputWithContext;
Controller.prototype.queueConversationInputWithContext=async function(...args){
 if(args[0].text===${JSON.stringify(retainedText)}){
  await fs.writeFile(${JSON.stringify(entered)},'before durable admission');
  while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));
 }
 return enqueue.apply(this,args);
};
const run=Controller.prototype.runConversation;
let calls=0;
Controller.prototype.runConversation=async function(...args){
 const first=++calls===1;
 const result=await run.apply(this,args);
 // The terminal clears its original dispatch ownership in the promise tail before this marker.
 if(first)setImmediate(()=>{void fs.writeFile(${JSON.stringify(originalJoined)},'joined');});
 return result;
};`:''}
const deliver = Interactions.prototype.deliverNotices;
Interactions.prototype.deliverNotices = async function(conversationId) {
 if (conversationId === undefined && this.store.one("SELECT id FROM runs WHERE phase='SETTLED'") &&
     this.store.one("SELECT id FROM conversation_results LIMIT 1")) {
  await fs.writeFile(${JSON.stringify(finishingEntered)},'settled response and retained result');
  while(!await fs.access(${JSON.stringify(releaseFinishing)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));
 }
 return deliver.apply(this, arguments);
};
`);
    const observation=path.join(root,'current'),output=path.join(root,'terminal'),config=path.join(root,'config.json');
    const copy=locale==='ko'?{waiting:'모델 응답 기다리는 중',writing:'응답 작성 중',cancelled:'요청 준비 취소됨',stopping:'요청 중단 중',finishing:'응답 결과 정리 중',complete:'응답 완료',hint:'Enter 현재 응답에 추가'}:
        {waiting:'Waiting for model response',writing:'Writing response',cancelled:'Request preparation cancelled',stopping:'Stopping request',finishing:'Finalizing response',complete:'Response complete',hint:'ctrl+t add to current response'};
    const prepare=uiText(locale,'input.concurrentStage',{stage:uiText(locale,postReceipt?'input.stage.routing':'input.stage.model')});
    const cancelling=uiText(locale,'input.concurrentStage',{stage:uiText(locale,postReceipt?'input.stoppingReceived':'input.cancelling')});
    const responseInterrupt=uiText(locale,'activity.interrupt').replace(/^ · /u,'');
    const sendInterrupt=uiText(locale,postReceipt?'footer.stopReceivedSend':'footer.cancelSend');
    const closeSuggestions=uiText(locale,'footer.closeSuggestions',{key:'Esc'});
    const submitKey=locale==='en'?'ctrl+t':'Enter';
    const retainInput=uiText(locale,'footer.retainInput',{submit:submitKey});
    const queueInput=uiText(locale,'footer.queueInput',{submit:submitKey}).split(' · ')[0];
    const absent=[copy.stopping,responseInterrupt,uiText(locale,'footer.interrupt')];
    const newer='NEWER 한글 draft',next='A new steering input',submit=locale==='en'?'\x14':'\r';
    const step=(draft,contains,send,extra={})=>({editorFocused:true,draft,contains,send,...extra});
    const settledSteps=[
        step('',[copy.writing],'',{releaseFile:releaseProvider}),
        step('',[copy.finishing,'OWNED_LIVE_RESPONSE COMPLETE'],retainedText+submit,{waitFiles:[{path:finishingEntered}]}),
        step(retainedText,[copy.finishing],'',{waitFiles:[{path:entered}],releaseFile:releaseFinishing}),
        step(retainedText,[],'',{waitFiles:[{path:originalJoined}],releaseFile:release}),
        step('',[uiText(locale,'input.receivedReview')],newer),
        step(newer,[uiText(locale,'activity.retained'),uiText(locale,'input.reviewBeforeSend',{submit:submitKey})],'\x07q'),
    ];
    await fs.writeFile(config,JSON.stringify({cid:view.conversationId,observation,output,columns:96,timeoutSeconds:12,
        releaseFilesOnFailure:[release,firstOutput,releaseProvider,releaseFinishing],
        command:[process.execPath,...moduleGuard,'--import',guard,'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),cli,'conversation','ui','--home',home,'--conversation',view.conversationId],
        env:{...process.env,HOME:root,GITJIG_HOME:home,LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},
        steps:[
            step('',[locale==='en'?'Ready · ctrl+t send':'입력 대기 · Enter 전송'],'Original live request'+submit),
            step('',[copy.waiting],'',{waitFiles:[{path:providerEntered}],releaseFile:firstOutput}),
            ...retainAtSettlement?settledSteps:[
            step('',[copy.writing,copy.hint,'Alt+Enter'],'/',{baseline:true}),
            step('/',[copy.writing,closeSuggestions],'\x1b',{autocomplete:true,unchanged:true,absent:[copy.hint,responseInterrupt]}),
            step('/',[copy.writing,copy.hint,responseInterrupt],'\x15'+next+submit,{autocomplete:false,unchanged:true,releaseFile:hold,absent:[closeSuggestions]}),
            step(postReceipt?'':next,[copy.writing,prepare,sendInterrupt],'\x15'+newer+'\x1b',
                {baseline:postReceipt,unchanged:!postReceipt,waitFiles:[postReceipt?{path:entered,value:'NATIVE_PENDING'}:{path:entered}],absent}),
            step(newer,[copy.writing,cancelling],'\x1b',{unchanged:true,absent}),
            step(newer,[copy.writing,cancelling],'',{unchanged:true,releaseFile:release,absent}),
            step(newer,[copy.writing,postReceipt?uiText(locale,'input.receivedCheckDelivery'):copy.cancelled,responseInterrupt],'',
                {unchanged:true,waitFiles:[{path:released}],releaseFile:releaseProvider,absent:[copy.stopping,sendInterrupt,uiText(locale,'input.receivedCancelled')]}),
            step(newer,[copy.finishing,'OWNED_LIVE_RESPONSE COMPLETE'],'\x1b',{waitFiles:[{path:finishingEntered}],absent:[copy.stopping,copy.complete,uiText(locale,'activity.preparing'),uiText(locale,'input.waitForAdmission')]}),
            step(newer,[copy.finishing],'',{releaseFile:releaseFinishing,absent:[copy.stopping]}),
            step(newer,[copy.complete,'OWNED_LIVE_RESPONSE COMPLETE'],'\x07q',{absent:[copy.stopping,copy.finishing]}),
            ],
        ]}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:22000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,retainAtSettlement?settledSteps.length+2:12);assert.equal(receipt.terminalRestored,true);assert.ok(postReceipt?requests.length>=1:requests.length===1);
    const frames=JSON.parse(await fs.readFile(output+'.frames.json','utf8')).snapshots;
    const stages=retainAtSettlement?[[1,copy.waiting],[2,copy.writing],[3,copy.finishing]]:
        [[1,copy.waiting],[2,copy.writing],[3,copy.writing],[4,copy.writing],[5,copy.writing],
            [6,copy.writing],[7,copy.writing],[8,copy.writing],[9,copy.finishing],[10,copy.finishing]];
    for(const [index,status] of stages) {
        assert.ok(frames[index].frame[0].includes(status),frames[index].frame[0]);
        assert.ok(frames[index].frame.slice(1).some(line=>line.includes(status)),frames[index].frame.join('\n'));
    }
    for(const index of retainAtSettlement?[3]:[9,10]) {
        const footer=frames[index].frame.find(line=>line.includes(retainInput)||line.includes(queueInput));
        assert.ok(footer?.includes(retainInput),'Finalizing the original response must offer retained review. Footer: '+footer);
        assert.ok(!footer.includes(queueInput),'Finalizing the original response must not advertise live additional input');
    }
    const reopened=await openController({installationHome:home});
    try {
        assert.equal(reopened.inspectConversation(view.conversationId).draft.text,newer);
        assert.equal(reopened.inspectConversation(view.conversationId).state,'IDLE');
        const inputs=reopened.store.all('SELECT * FROM conversation_inputs ORDER BY rowid');
        assert.deepEqual(inputs.map(row=>row.text),retainAtSettlement?['Original live request',retainedText]:postReceipt?['Original live request',next]:['Original live request']);
        assert.equal(inputs[0].state,'CONSUMED');
        if(retainAtSettlement)assert.deepEqual([inputs[1].state,inputs[1].mode],['QUEUED','idle']);
        const runs=reopened.store.all('SELECT * FROM runs');assert.equal(runs.length,1);assert.equal(runs[0].phase,'SETTLED');assert.equal(JSON.parse(runs[0].data).outcome,'delivered');
        if(retainAtSettlement) {
            const allowance=reopened.store.one("SELECT consumed,reserved FROM budgets WHERE kind='execution' AND lineage=(SELECT lineage FROM works WHERE id=?)",runs[0].work);
            assert.deepEqual([allowance.consumed,allowance.reserved],[1,0]);
            assert.equal(reopened.store.one('SELECT COUNT(*) n FROM conversation_results').n,1);
        }
    } finally {await reopened.close();}
    passed=true;
});
