import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {ApplicationKeybindings} from '../../dist/app/keybindings.js';
const execute=promisify(execFile);
const cli=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js');
const moduleUrl=file=>JSON.stringify(pathToFileURL(path.resolve(path.dirname(cli),'..',file)).href);

for(const locale of ['en','ko'])for(const boundary of ['source','model','context','receipt','admission','autocomplete','close','receipt-race','navigation'])
test(`Escape cancels ${boundary} preparation without late dispatch or losing newer text in ${locale}`,{timeout:20000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-cancel-pty-'))),home=path.join(root,'home'),source=path.join(root,'source');
    await fs.mkdir(source);await fs.writeFile(path.join(source,'context.txt'),'owned context bytes');
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained cancellation terminal '+root);});
    const c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)}});
    await c.registerProject({id:'P',sourceRoot:source});
    const accounts=ApplicationAccounts.open(c);
    await accounts.configure({providers:{'cancel-owned':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',apiKey:'UNUSED',models:[{id:'fixture'}]}}});
    await accounts.setDefault('cancel-owned','fixture');
    const projectRequest=boundary==='source'||boundary==='context';
    const view=await new ApplicationModels(c).newConversation({projectId:projectRequest?'P':null});
    const other=boundary==='navigation'?await new ApplicationModels(c).newConversation():null;
    const otherDraft='OTHER exact unsent draft';
    if(other){
        c.setConversationName({conversationId:view.conversationId,expectedGeneration:0,name:'Preparation owner'});
        c.setConversationName({conversationId:other.conversationId,expectedGeneration:0,name:'Other pane'});
        c.setDraft({conversationId:other.conversationId,expectedRevision:0,text:otherDraft});
    }
    const {ApplicationStartup}=await import('../../dist/app/startup.js');
    if(projectRequest)await ApplicationStartup.open(c).save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)}});
    const customCompletionCancel = boundary === 'autocomplete' && locale === 'en';
    if (customCompletionCancel) {
        const file = new ApplicationKeybindings(c).file;
        await fs.mkdir(path.dirname(file), {recursive:true,mode:0o700});
        await fs.writeFile(file, JSON.stringify({'tui.select.cancel':'f9'}), {mode:0o600});
    }
    await c.close();
    if (boundary === 'model' && locale === 'en') {
        const prior = new DatabaseSync(path.join(home, 'state/controller.sqlite'));
        try { prior.exec('ALTER TABLE conversation_views DROP COLUMN cancelled_send'); }
        finally { prior.close(); }
    }
    const hold=path.join(root,'hold'),entered=path.join(root,'entered'),release=path.join(root,'release'),guard=path.join(root,'hold.mjs'),joined=path.join(root,'joined');
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {ApplicationModels} from ${moduleUrl('app/models.js')};
const wait=async()=>{if(!await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false))return;await fs.writeFile(${JSON.stringify(entered)},'entered');while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));};
${boundary==='source'?`const {syncBuiltinESMExports}=await import('node:module');const original=fs.lstat;
fs.lstat=async function(file,...args){if(file===${JSON.stringify(source)}&&args[0]?.bigint)await wait();return original.call(this,file,...args);};syncBuiltinESMExports();`:`
${['model','autocomplete','close','navigation'].includes(boundary)?`const original=ApplicationModels.prototype.resolve;ApplicationModels.prototype.resolve=async function(...args){await wait();const result=await original.apply(this,args);${other?`await fs.writeFile(${JSON.stringify(joined)},'joined');`:''}return result;};`:boundary==='context'?`const original=fs.open;fs.open=async function(file,...args){if(String(file)===${JSON.stringify(path.join(source,'context.txt'))})await wait();return original.call(this,file,...args);};`:boundary==='admission'?`const {Controller}=await import(${moduleUrl('controller/controller.js')});const original=Controller.prototype.runConversation;let calls=0;Controller.prototype.runConversation=async function(...args){await fs.writeFile(${JSON.stringify(path.join(root,'calls'))},String(++calls));await wait();return original.apply(this,args);};`:`const {Controller}=await import(${moduleUrl('controller/controller.js')});const original=Controller.prototype.queueConversationInputWithContext;Controller.prototype.queueConversationInputWithContext=async function(...args){${boundary==='receipt-race'?`await this.queueConversationInput({conversationId:args[0].conversationId,expectedGeneration:args[0].expectedGeneration,text:'Older retained original',mode:'follow-up'});`:''}const receipt=await original.apply(this,args);await wait();return receipt;};`}
`}
`);
    const observation=path.join(root,'current'),output=path.join(root,'terminal'),config=path.join(root,'config.json');
    const contextStage=boundary==='context';
    const copy=locale==='ko'
        ?[boundary==='source'?'프로젝트 폴더 확인 중':contextStage?'요청과 파일 참조 확인 중':'선택한 모델 확인 중','준비 취소 중','요청 준비 취소됨']
        :[boundary==='source'?'Checking project folder':contextStage?'Checking request and file references':'Checking selected model','Cancelling preparation','Request preparation cancelled'];
    const stoppingReceived=locale==='ko'?'중단 요청됨 · 요청은 이미 접수됨':'Stop requested · request already received';
    const stopReceived=locale==='ko'?'Esc 중단 요청 · 입력은 이미 접수됨':'Esc requests stop · input already received';
    const received=locale==='ko'?'요청 접수됨':'Request received';
    const routing=locale==='ko'?'요청 접수됨 · 전달 확인 중':'Request received · checking delivery';
    const waitForAdmission=locale==='ko'?'실행 시작 후 전송 가능 · 초안 보존':'Send after execution starts · draft kept';
    const queued=locale==='ko'?'요청 접수됨 · 실행 시작 대기':'Request received · waiting to start';
    const cancelSend = locale === 'ko' ? 'Esc 이번 전송 취소' : 'Esc cancels this send';
    const closeSuggestions = customCompletionCancel ? 'f9 closes suggestions' : 'Esc 자동완성 닫기';
    const escapeRepeatAndRelease='\x1b[27;1:2u\x1b[27;1:3u';
    const draft=boundary==='autocomplete'?'/':'NEWER 한글 draft',original=boundary==='context'?'Read @context.txt':'Original request';
    const step=(text,contains,send,extra={})=>({editorFocused:true,draft:text,contains,send,...extra});
    await fs.writeFile(config,JSON.stringify({cid:view.conversationId,observation,output,timeoutSeconds:12,releaseFilesOnFailure:[release],
        command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD ? ['--import',process.env.GITJIG_UI_MODULE_GUARD] : []),
            '--import',guard,'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),cli,
            'conversation','ui','--home',home,'--conversation',view.conversationId],
        env:{...process.env,LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},
        steps:other?[
            step('',[],original+'\x1b\r',{baseline:true,releaseFile:hold}),
            step(original,[copy[0]],'\x15'+draft+'\x1b',{unchanged:true,waitFiles:[{path:entered}]}),
            step(draft,[copy[1]],'\x07c',{unchanged:true}),
            step(draft,[locale==='ko'?'대화 목록':'Conversations'],'Other pane\r',{editorFocused:false,unchanged:true}),
            step(otherDraft,['Other pane'],'',{selected:other.conversationId,unchanged:true,releaseFile:release}),
            step(otherDraft,['Other pane'],'\x07c',{selected:other.conversationId,unchanged:true,waitFiles:[{path:joined}],absent:[copy[2]]}),
            step(otherDraft,[locale==='ko'?'대화 목록':'Conversations'],'Preparation owner\r',{selected:other.conversationId,editorFocused:false,unchanged:true}),
            step(draft,['Preparation owner'],'\x07q',{unchanged:true,absent:[copy[1]]}),
        ]:boundary==='receipt-race'?[
            step('',[],original+'\x1b\r',{releaseFile:hold}),
            step('',[received],draft,{absent:[routing,queued],waitFiles:[{path:entered}]}),
            step(draft,[received],'',{absent:[routing,queued],releaseFile:release}),
            step(draft,[locale==='ko'?'접수된 입력 보존':'Received input kept'],'\x07q',{absent:[queued]}),
        ]:boundary==='close'?[
            step('',[],original+'\x1b\r',{baseline:true,releaseFile:hold}),
            step(original,[copy[0]],'\x15'+draft+'\x07q',{unchanged:true,waitFiles:[{path:entered}]}),
            {editorFocused:false,draft,contains:[locale==='ko'?'Gitjig 종료 중':'Closing Gitjig'],unchanged:true,releaseFile:release},
        ]:boundary==='autocomplete'?[
            step('',[],original+'\x1b\r',{baseline:true,releaseFile:hold}),
            step(original,[copy[0]],'\x15/',{unchanged:true,waitFiles:[{path:entered}]}),
            step('/',[copy[0],closeSuggestions],customCompletionCancel?'\x1b[20~':'\x1b',{unchanged:true,autocomplete:true,absent:[cancelSend]}),
            step('/',[copy[0],cancelSend],escapeRepeatAndRelease,{unchanged:true,autocomplete:false,absent:[copy[1],closeSuggestions]}),
            step('/',[copy[0],cancelSend],'\x1b',{unchanged:true,autocomplete:false,absent:[copy[1],closeSuggestions]}),
            step('/',[copy[1]],'',{unchanged:true,releaseFile:release}),
            step('/',[copy[2]],'\x07q',{unchanged:true}),
        ]:boundary==='admission'?[
            step('',[],original+'\x1b\r',{releaseFile:hold}),
            step('',[queued,waitForAdmission],'Second input\x1b\r',{waitFiles:[{path:entered}],absent:[locale==='ko'?'Enter 현재 응답에 추가':'Enter add to current response']}),
            step('Second input',[waitForAdmission],'\x1b'),
            step('Second input',[locale==='ko'?'요청 중단 중':'Stopping request'],'',{releaseFile:release}),
            step('Second input',[locale==='ko'?'이미 접수된 입력':'Send already received'],'\x15Fresh new request\x1b\r'),
            step('Fresh new request',[locale==='ko'?'앞서 접수된 요청 확인':'Earlier received request needs review','Original request'],'\x1b',{editorFocused:false}),
            step('Fresh new request',['/inputs'],'\x07q'),
        ]:[
            step('',[],original+'\x1b\r',{baseline:true,releaseFile:hold}),
            step(boundary==='receipt'?'':original,boundary==='receipt'?[received,stopReceived]:[copy[0]],'\x15'+draft+'\x1b',{unchanged:boundary!=='receipt',waitFiles:[{path:entered}]}),
            step(draft,[boundary==='receipt'?stoppingReceived:copy[1]],'',{unchanged:boundary!=='receipt',releaseFile:release}),
            step(draft,boundary==='receipt'?[locale==='ko'?'이미 접수된 입력':'Send already received']:
                [copy[2],(locale==='ko'?'접수되지 않음 · ':'Not received · ')+original],'\x07q',
                {unchanged:boundary!=='receipt',absent:['Needs attention','상태 확인 필요']}),
        ]}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,other?8:boundary==='admission'?7:boundary==='close'?3:boundary==='autocomplete'?7:4);assert.equal(receipt.terminalRestored,true);
    const frames=JSON.parse(await fs.readFile(output+'.frames.json','utf8')).snapshots;
    const preparing=boundary==='admission'?queued:['receipt','receipt-race'].includes(boundary)?received:copy[0];
    assert.ok(frames[1].frame[0].includes(preparing),frames[1].frame[0]);
    const cancellingIndex=boundary==='autocomplete'?5:boundary==='admission'?3:['source','model','context','receipt'].includes(boundary)?2:undefined;
    if(cancellingIndex!==undefined){
        const expected=boundary==='admission'?(locale==='ko'?'요청 중단 중':'Stopping request'):boundary==='receipt'?stoppingReceived:copy[1];
        assert.ok(frames[cancellingIndex].frame[0].includes(expected),frames[cancellingIndex].frame[0]);
    }
    const beforeReceipt = (locale==='ko'?'접수되지 않음 · ':'Not received · ')+original;
    if (['model', 'receipt', 'close'].includes(boundary)) {
        const cold = JSON.parse(await fs.readFile(config, 'utf8'));
        cold.output = output + '.cold';
        cold.command.splice(1, 0, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'));
        cold.steps = [step(draft, boundary === 'receipt' ? [original] : [beforeReceipt], '\x07q', {
            baseline: true, absent: boundary === 'receipt' ? [beforeReceipt] : [],
        })];
        const coldFile = config + '.cold';
        await fs.writeFile(coldFile, JSON.stringify(cold));
        const again = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/inspection-pty.py', coldFile], {timeout:10000,maxBuffer:2**20})).stdout);
        assert.deepEqual([again.exitCode, again.stages, again.terminalRestored], [0, 1, true]);
    }
    const reopened=await openController({installationHome:home});
    try{assert.equal(reopened.inspectConversation(view.conversationId).draft.text,boundary==='admission'?'Fresh new request':draft);for(const table of ['runs','works','conversation_inputs'])assert.equal(reopened.store.one('SELECT COUNT(*) AS count FROM '+table).count,table==='conversation_inputs'?(['receipt','admission'].includes(boundary)?1:boundary==='receipt-race'?2:0):0);if(boundary==='admission'){assert.equal(await fs.readFile(path.join(root,'calls'),'utf8'),'1');assert.deepEqual(reopened.store.all('SELECT mode FROM conversation_inputs ORDER BY rowid').map(row=>row.mode),['idle']);}if(boundary==='receipt-race'){assert.deepEqual(reopened.store.all('SELECT text,state FROM conversation_inputs ORDER BY rowid').map(row=>[row.text,row.state]),[['Older retained original','QUEUED'],[original,'QUEUED']]);}if(boundary==='receipt'){const input=reopened.store.one('SELECT * FROM conversation_inputs');assert.equal(input.state,'QUEUED');assert.equal(input.text,original);}}
    finally{await reopened.close();}
    if (boundary === 'model') {
        const app = await openController({installationHome:home});
        try {
            const current = app.inspectConversation(view.conversationId);
            assert.equal(current.cancelledSendPreview, original);
            await app.queueConversationInputWithContext({conversationId:view.conversationId, expectedGeneration:current.generation,
                draftRevision:current.draft.revision, text:draft, mode:'idle'}, undefined, 'retain', true);
            assert.equal(app.inspectConversation(view.conversationId).cancelledSendPreview, undefined);
            assert.equal(app.store.one('SELECT cancelled_send FROM conversation_views WHERE conversation=?',view.conversationId).cancelled_send,null);
        } finally { await app.close(); }
    }
    passed=true;
});
