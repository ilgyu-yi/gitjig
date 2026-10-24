import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';

const execute=promisify(execFile), cli=path.resolve('dist/cli/main.js');
async function fixture(t) {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-activity-pty-'))), home=path.join(root,'home');
    let passed=false;
    t.after(async()=>{if(passed) await fs.rm(root,{recursive:true,force:true}); else t.diagnostic('Retained activity terminal '+root);});
    return {root,home,pass(){passed=true;}};
}
async function launch(f,name,steps,extra=[]) {
    const output=path.join(f.root,name+'.terminal'), config=path.join(f.root,name+'.json');
    await fs.writeFile(config,JSON.stringify({command:[process.execPath,...extra,cli,'conversation','ui','--home',f.home,'--completed-view-limit','0','--view-idle-grace-ms','0'],
        env:{...process.env,TERM:'xterm-256color',TMPDIR:path.join(f.home,'artifacts')},database:path.join(f.home,'state','controller.sqlite'),output,timeoutSeconds:15,steps}));
    const actual=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',config],{timeout:20000,maxBuffer:2**20})).stdout);
    assert.equal(actual.exitCode,0); assert.equal(actual.stages,steps.length); assert.equal(actual.terminalRestored,true);
    return fs.readFile(output,'utf8');
}

test('original CLI shows elapsed waiting before the first provider token and preserves typing until completion',{timeout:25000},async t=>{
    const f=await fixture(t),release=path.join(f.root,'release'),requests=[],sockets=new Set();
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
    const original='  응답 전에도 상태를 확인  ';
    const output=await launch(f,'silent',[
        {wait:'/ready setup',send:original+'\x1b\r'},
        {wait:'Waiting for model response',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}],assertDraft:'',expectedInputs:1,send:'Newer unsent draft'},
        {wait:'· 2s',releaseFile:release,send:''},
        {wait:'Response complete',waitIdle:true,assertDraft:'Newer unsent draft',expectedInputs:1,terminate:true,send:''},
    ]);
    assert.ok(output.indexOf('Waiting for model response')<output.indexOf(marker));
    assert.match(output,/Esc interrupt/);assert.match(output,/Newer unsent draft/);
    // The request being answered is progress; the retained-input warning is reserved for inputs that need /inputs.
    assert.doesNotMatch(output,/Sent request ·|\/inputs to inspect/);
    assert.equal(requests.length,1);
    const user=requests[0].messages.filter(message=>message.role==='user').at(-1);
    assert.equal(typeof user.content==='string'?user.content:user.content.filter(item=>item.type==='text').map(item=>item.text).join(''),original);
    const reopened=await openController({installationHome:f.home});try{
        assert.equal(reopened.inspectConversation(view.conversationId).draft.text,'Newer unsent draft');
        assert.equal(reopened.inspectConversation(view.conversationId).state,'IDLE');
    } finally {await reopened.close();}f.pass();
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
import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js',import.meta.url).href)};
const original=ApplicationModels.prototype.resolve;let calls=0;
ApplicationModels.prototype.resolve=async function(...args){if(await fs.access(${JSON.stringify(hold)}).then(()=>true,()=>false)){await fs.writeFile(${JSON.stringify(entered)},String(++calls));while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,10));}return original.apply(this,args);};
`);
    const output=await launch(f,'preparation',[
        {wait:'/ready setup',releaseFile:hold,send:'Original held request\x1b\r'},
        {wait:'Preparing request',waitFiles:[{path:entered,value:'1'}],queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],send:'\r\x07c'},
        {wait:'Conversations',send:'Other pane\r'},
        {wait:'Other pane',expectedSelected:second.conversationId,assertDraft:'',send:'\x07c'},
        {wait:'Conversations',send:'Preparation owner\r'},
        {wait:'Preparing request',expectedSelected:first.conversationId,assertDraft:'Original held request',send:'\r\x15NEWER exact draft'},
        {wait:'NEWER exact draft',textFiles:[{path:entered,value:'1'}],releaseFile:release,send:''},
        {wait:'Input target or exact draft changed before file capture',waitIdle:true,expectedSelected:first.conversationId,assertDraft:'NEWER exact draft',expectedInputs:0,queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}],terminate:true,send:''},
    ],['--import',guard]);
    assert.match(output,/Preparing request/);assert.match(output,/Request retained|Needs attention/);
    assert.equal(await fs.readFile(entered,'utf8'),'1');f.pass();
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
import {Controller} from ${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)};
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

for (const mode of ['steer','follow-up']) test(`a ${mode} sent during a response is shown with its own pending meaning`,{timeout:25000},async t=>{
    const f=await fixture(t),release=path.join(f.root,'release'),requests=[],sockets=new Set();
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
    const output=await launch(f,'follow-up',[
        {wait:'/ready setup',send:'Please summarize the README\x1b\r'},
        {wait:'Waiting for model response',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[1]]}],send:'Then list open issues'+(mode==='steer'?'\r':'\x1b\r')},
        {wait:'Sent inputs waiting · 1 · '+(mode==='steer'?'Add to current response':'After current response'),releaseFile:release,send:''},
        {wait:'Response complete',terminate:true,send:''},
    ]);
    assert.doesNotMatch(output,/Sent request ·|\/inputs to inspect/);
    f.pass();
});
