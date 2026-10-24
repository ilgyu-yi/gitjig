import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
const execute=promisify(execFile);

for(const locale of ['en','ko'])for(const boundary of ['model','context','receipt','admission','autocomplete','close','receipt-race'])
test(`Escape cancels ${boundary} preparation without late dispatch or losing newer text in ${locale}`,{timeout:20000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-cancel-pty-'))),home=path.join(root,'home'),source=path.join(root,'source');
    await fs.mkdir(source);await fs.writeFile(path.join(source,'context.txt'),'owned context bytes');
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained cancellation terminal '+root);});
    const c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)}});
    await c.registerProject({id:'P',sourceRoot:source});
    const accounts=ApplicationAccounts.open(c);
    await accounts.configure({providers:{'cancel-owned':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',apiKey:'UNUSED',models:[{id:'fixture'}]}}});
    await accounts.setDefault('cancel-owned','fixture');
    const view=await new ApplicationModels(c).newConversation({projectId:boundary==='context'?'P':null});
    const {ApplicationStartup}=await import('../../dist/app/startup.js');
    if(boundary==='context')await ApplicationStartup.open(c).save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)}});
    await c.close();
    const hold=path.join(root,'hold'),entered=path.join(root,'entered'),release=path.join(root,'release'),guard=path.join(root,'hold.mjs');
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js',import.meta.url).href)};
const wait=async()=>{if(!await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false))return;await fs.writeFile(${JSON.stringify(entered)},'entered');while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));};
${boundary==='model'||boundary==='autocomplete'||boundary==='close'?`const original=ApplicationModels.prototype.resolve;ApplicationModels.prototype.resolve=async function(...args){await wait();return original.apply(this,args);};`:boundary==='context'?`const original=fs.open;fs.open=async function(file,...args){if(String(file)===${JSON.stringify(path.join(source,'context.txt'))})await wait();return original.call(this,file,...args);};`:boundary==='admission'?`const {Controller}=await import(${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)});const original=Controller.prototype.runConversation;let calls=0;Controller.prototype.runConversation=async function(...args){await fs.writeFile(${JSON.stringify(path.join(root,'calls'))},String(++calls));await wait();return original.apply(this,args);};`:`const {Controller}=await import(${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)});const original=Controller.prototype.queueConversationInputWithContext;Controller.prototype.queueConversationInputWithContext=async function(...args){${boundary==='receipt-race'?`await this.queueConversationInput({conversationId:args[0].conversationId,expectedGeneration:args[0].expectedGeneration,text:'Older retained original',mode:'follow-up'});`:''}const receipt=await original.apply(this,args);await wait();return receipt;};`}
`);
    const observation=path.join(root,'current'),output=path.join(root,'terminal'),config=path.join(root,'config.json');
    const copy=locale==='ko'?['이 입력 준비 중','준비 취소 중','요청 준비 취소됨']:['Preparing this input','Cancelling preparation','Request preparation cancelled'];
    const draft=boundary==='autocomplete'?'/':'NEWER 한글 draft',original=boundary==='context'?'Read @context.txt':'Original request';
    const step=(text,contains,send,extra={})=>({editorFocused:true,draft:text,contains,send,...extra});
    await fs.writeFile(config,JSON.stringify({cid:view.conversationId,observation,output,timeoutSeconds:12,releaseFilesOnFailure:[release],
        command:[process.execPath,'--import',guard,'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',view.conversationId],
        env:{...process.env,LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},
        steps:boundary==='receipt-race'?[
            step('',[],original+'\x1b\r',{releaseFile:hold}),
            step(original,[copy[0]],'\x15'+draft,{waitFiles:[{path:entered}]}),
            step(draft,[copy[0]],'',{releaseFile:release}),
            step(draft,[locale==='ko'?'접수된 입력 보존':'Received input kept'],'\x07q'),
        ]:boundary==='close'?[
            step('',[],original+'\x1b\r',{baseline:true,releaseFile:hold}),
            step(original,[copy[0]],'\x15'+draft+'\x07q',{unchanged:true,waitFiles:[{path:entered}]}),
            {editorFocused:false,draft,contains:[locale==='ko'?'Gitjig 종료 중':'Closing Gitjig'],unchanged:true,releaseFile:release},
        ]:boundary==='autocomplete'?[
            step('',[],original+'\x1b\r',{baseline:true,releaseFile:hold}),
            step(original,[copy[0]],'\x15/',{unchanged:true,waitFiles:[{path:entered}]}),
            step('/',[copy[0]],'\x1b',{unchanged:true,autocomplete:true}),
            step('/',[copy[0]],'\x1b',{unchanged:true,autocomplete:false,absent:[copy[1]]}),
            step('/',[copy[1]],'',{unchanged:true,releaseFile:release}),
            step('/',[copy[2]],'\x07q',{unchanged:true}),
        ]:boundary==='admission'?[
            step('',[],original+'\x1b\r',{releaseFile:hold}),
            step('',[locale==='ko'?'Enter 현재 응답에 추가':'Enter add to current response'],'Second input\x1b\r',{waitFiles:[{path:entered}]}),
            step('',[locale==='ko'?'전송된 입력 대기':'Sent inputs waiting'],'\x1b'),
            step('',[locale==='ko'?'요청 중단 중':'Stopping request'],'',{releaseFile:release}),
            step('',[locale==='ko'?'이미 접수된 입력':'Send already received'],'Fresh new request\x1b\r'),
            step('Fresh new request',[locale==='ko'?'이전 전송 입력이 남아 있습니다':'Earlier sent input is pending'],'\x07q'),
        ]:[
            step('',[],original+'\x1b\r',{baseline:true,releaseFile:hold}),
            step(original,[copy[0]],'\x15'+draft+'\x1b',{unchanged:boundary!=='receipt',waitFiles:[{path:entered}]}),
            step(draft,[copy[1]],'',{unchanged:boundary!=='receipt',releaseFile:release}),
            step(draft,[boundary==='receipt'?(locale==='ko'?'이미 접수된 입력':'Send already received'):copy[2]],'\x07q',{unchanged:boundary!=='receipt',absent:['Needs attention','상태 확인 필요']}),
        ]}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,boundary==='admission'?6:boundary==='close'?3:boundary==='autocomplete'?6:4);assert.equal(receipt.terminalRestored,true);
    const reopened=await openController({installationHome:home});
    try{assert.equal(reopened.inspectConversation(view.conversationId).draft.text,boundary==='admission'?'Fresh new request':draft);for(const table of ['runs','works','conversation_inputs'])assert.equal(reopened.store.one('SELECT COUNT(*) AS count FROM '+table).count,table==='conversation_inputs'?(boundary==='receipt'?1:boundary==='admission'||boundary==='receipt-race'?2:0):0);if(boundary==='admission'){assert.equal(await fs.readFile(path.join(root,'calls'),'utf8'),'1');assert.deepEqual(reopened.store.all('SELECT mode FROM conversation_inputs ORDER BY rowid').map(row=>row.mode),['idle','follow-up']);}if(boundary==='receipt-race'){assert.deepEqual(reopened.store.all('SELECT text,state FROM conversation_inputs ORDER BY rowid').map(row=>[row.text,row.state]),[['Older retained original','QUEUED'],[original,'QUEUED']]);}if(boundary==='receipt'){const input=reopened.store.one('SELECT * FROM conversation_inputs');assert.equal(input.state,'QUEUED');assert.equal(input.text,original);}}
    finally{await reopened.close();}passed=true;
});
