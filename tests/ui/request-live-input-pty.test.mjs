import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {ApplicationKeybindings} from '../../dist/app/keybindings.js';

const execute=promisify(execFile);
for(const locale of ['en','ko'])test(`Escape during a new send preserves the live response and shows input effects in ${locale}`,{timeout:20000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-live-input-'))),home=path.join(root,'home');
    let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained live input terminal '+root);});
    const providerEntered=path.join(root,'provider-entered'),releaseProvider=path.join(root,'provider-release'),requests=[],sockets=new Set();
    const server=http.createServer(async(req,res)=>{
        try {
            const chunks=[];for await(const chunk of req)chunks.push(chunk);
            requests.push(JSON.parse(Buffer.concat(chunks).toString()));
            res.writeHead(200,{'content-type':'text/event-stream'});
            const chunk=(delta,finish_reason=null)=>({id:'live-input-owned',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
            res.write(`data: ${JSON.stringify(chunk({role:'assistant',content:'OWNED_LIVE_RESPONSE '}))}\n\n`);
            await fs.writeFile(providerEntered,'entered');
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
    if(locale==='en')await fs.writeFile(new ApplicationKeybindings(c).file,JSON.stringify({'tui.input.submit':'ctrl+t'}),{mode:0o600});
    await c.close();
    const hold=path.join(root,'hold-next'),entered=path.join(root,'next-entered'),release=path.join(root,'next-release'),released=path.join(root,'next-released'),guard=path.join(root,'hold.mjs');
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js',import.meta.url).href)};
const original=ApplicationModels.prototype.resolve;
ApplicationModels.prototype.resolve=async function(...args){
 if(!await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false))return original.apply(this,args);
 await fs.writeFile(${JSON.stringify(entered)},'entered');
 while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,10));
 const result=await original.apply(this,args);await fs.writeFile(${JSON.stringify(released)},'released');return result;
};
`);
    const observation=path.join(root,'current'),output=path.join(root,'terminal'),config=path.join(root,'config.json');
    const copy=locale==='ko'?{writing:'응답 작성 중',prepare:'이 입력 준비 중',cancel:'준비 취소 중',cancelled:'요청 준비 취소됨',stopping:'요청 중단 중',complete:'응답 완료',hint:'Enter 현재 응답에 추가'}:{writing:'Writing response',prepare:'Preparing this input',cancel:'Cancelling preparation',cancelled:'Request preparation cancelled',stopping:'Stopping request',complete:'Response complete',hint:'ctrl+t add to current response'};
    const newer='NEWER 한글 draft',next='A new steering input',submit=locale==='en'?'\x14':'\r';
    const step=(draft,contains,send,extra={})=>({editorFocused:true,draft,contains,send,...extra});
    await fs.writeFile(config,JSON.stringify({cid:view.conversationId,observation,output,timeoutSeconds:12,
        command:[process.execPath,'--import',guard,'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',view.conversationId],
        env:{...process.env,HOME:root,GITJIG_HOME:home,LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},
        steps:[
            step('',[locale==='en'?'Ready · ctrl+t send':'입력 대기 · Enter 전송'],'Original live request'+submit),
            step('',[copy.writing,copy.hint,'Alt+Enter'],next+submit,{baseline:true,waitFiles:[{path:providerEntered}],releaseFile:hold}),
            step(next,[copy.writing,copy.prepare],'\x15'+newer+'\x1b',{unchanged:true,waitFiles:[{path:entered}],absent:[copy.stopping]}),
            step(newer,[copy.writing,copy.cancel],'',{unchanged:true,releaseFile:release,absent:[copy.stopping]}),
            step(newer,[copy.writing,copy.cancelled],'',{unchanged:true,waitFiles:[{path:released}],releaseFile:releaseProvider,absent:[copy.stopping]}),
            step(newer,[copy.complete,'OWNED_LIVE_RESPONSE COMPLETE'],'\x07q',{absent:[copy.stopping]}),
        ]}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',config],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,6);assert.equal(receipt.terminalRestored,true);assert.equal(requests.length,1);
    const reopened=await openController({installationHome:home});
    try {
        assert.equal(reopened.inspectConversation(view.conversationId).draft.text,newer);
        assert.equal(reopened.inspectConversation(view.conversationId).state,'IDLE');
        const inputs=reopened.store.all('SELECT * FROM conversation_inputs');assert.equal(inputs.length,1);assert.equal(inputs[0].state,'CONSUMED');assert.equal(inputs[0].text,'Original live request');
        const runs=reopened.store.all('SELECT * FROM runs');assert.equal(runs.length,1);assert.equal(runs[0].phase,'SETTLED');assert.equal(JSON.parse(runs[0].data).outcome,'delivered');
    } finally {await reopened.close();}
    passed=true;
});
