import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
async function until(read){const deadline=Date.now()+3000;while(Date.now()<deadline){const value=read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Owned run did not reach queued admission');}
async function fixture(t){
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-runtime-snapshot-'))),home=path.join(root,'home'),source=path.join(root,'source');let passed=false,c;
    t.after(async()=>{await c?.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained runtime snapshot fixture '+root);});
    await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.txt'),'Owned source for runtime admission');
    const runtime=async label=>{const binary=path.join(root,'docker-'+label),config=path.join(root,'config-'+label);await fs.mkdir(config,{mode:0o700});
        // Finite owned native rejection, not a Docker daemon or sandbox emulator.
        // Original createScope runs through real native process ownership, exact
        // route/CPU operands and preallocation-rejection settlement without a container.
        await fs.writeFile(binary,`#!/bin/sh
printf '%s\\n' "$*" >> "$0.log"
for arg do
  case "$arg" in
    type=bind,source=*,target=/work*)
      source="\${arg#type=bind,source=}"
      source="\${source%%,target=*}"
      printf 'Error response from daemon: invalid mount config for type "bind": bind source path does not exist: %s\\n' "$source" >&2
      exit 1;;
  esac
done
exit 1
`,{mode:0o700});return{dockerBinary:binary,dockerConfigDirectory:config,dockerContext:'route-'+label,image:'sha256:'+(label==='A'?'a':'b').repeat(64),uid:process.getuid(),gid:process.getgid(),cpus:label==='A'?0.5:2,memoryMiB:label==='A'?128:256};};
    const A=await runtime('A'),B=await runtime('B');c=await openController({installationHome:home,runtimeProfile:A,capacityLimit:1});await c.registerProject({id:'P',sourceRoot:source});
    let providerCalls=0;const model={provider:'runtime-snapshot-fixture',modelId:'fixture',definition:{apiKey:'UNUSED',baseUrl:'http://unused.invalid',api:'runtime-snapshot-api',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:32000,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(){providerCalls++;throw Error('No provider may run after owned preallocation rejection');}}};
    const blocker=await c.beginChange({projectId:'P',request:'Owned capacity blocker metadata; no execution'}),s=c.store;
    s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','owned-block-run',blocker.workId,1,1,'RUNNING',root,'consumed','{}');s.run('INSERT INTO capacity_leases VALUES(?,?,?,?,?,?,?)','owned-block-lease',blocker.workId,'owned-block-run',1,1,'ADMITTED',JSON.stringify({admitted:true}));
    return{c,A,B,model,get providerCalls(){return providerCalls;},release(){s.run("UPDATE capacity_leases SET state='RELEASED' WHERE id='owned-block-lease'");s.run("UPDATE runs SET phase='SETTLED',data=? WHERE id='owned-block-run'",JSON.stringify({cleanup:'not-allocated'}));c.capacity.changed();},async log(runtime){return fs.readFile(runtime.dockerBinary+'.log','utf8').catch(error=>{if(error.code==='ENOENT')return'';throw error;});},pass(){passed=true;}};
}
for(const kind of ['ordinary-conversation','governed-role','governed-check'])test(`${kind} queued before runtime apply retains A while later admission uses B`,{timeout:15000},async t=>{
    const f=await fixture(t),{c,A,B,model}=f;
    const dispatch=async()=>{
        if(kind==='ordinary-conversation'){
            const cid=c.createConversation({projectId:'P'}).conversationId;await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:'Exercise owned runtime admission',mode:'idle'});
            return{pending:c.runConversation({conversationId:cid,model})};
        }
        const work=await c.beginChange({projectId:'P',request:'Exercise owned governed runtime admission'});
        if(kind==='governed-role')return{pending:c.planChange({workId:work.workId,model})};
        // Controlled selected-version premise isolates the actual checker reservation,
        // capacity admission and scope creation; it claims no accepted check/plan.
        const base=c.store.one('SELECT base FROM change_state WHERE work=?',work.workId).base;c.store.run('UPDATE change_state SET verification=? WHERE work=?',base,work.workId);
        const check={id:'owned-runtime-check',command:'Never executes',timeoutMs:1000,assertions:['owned'],guaranteeIds:['owned'],fixturePaths:[]};
        return{pending:c.changeCore.operation({workId:work.workId},'plan',()=>c.changeCore.executeCheck(work.workId,check,{},base))};
    };
    const first=await dispatch(),queued=await until(()=>c.store.one("SELECT * FROM runs WHERE phase='WAITING_CAPACITY' AND json_extract(data,'$.kind')=?",kind));
    assert.deepEqual(JSON.parse(queued.data).runtimeProfile,A);assert.equal(await f.log(A),'');assert.equal(await f.log(B),'');
    await c.applyRuntimeProfile(B);assert.deepEqual(JSON.parse(c.store.one('SELECT data FROM runs WHERE id=?',queued.id).data).runtimeProfile,A);
    f.release();await first.pending;
    const oldLog=await f.log(A);assert.match(oldLog,/--context route-A/);assert.match(oldLog,/--cpus 0\.5/);assert.match(oldLog,/--memory 128m/);assert.match(oldLog,new RegExp(A.image));assert.equal(await f.log(B),'');
    const second=await dispatch();await second.pending;
    const newer=c.store.one("SELECT * FROM runs WHERE json_extract(data,'$.kind')=? ORDER BY rowid DESC LIMIT 1",kind);assert.notEqual(newer.id,queued.id);assert.deepEqual(JSON.parse(newer.data).runtimeProfile,B);
    const nextLog=await f.log(B);assert.match(nextLog,/--context route-B/);assert.match(nextLog,/--cpus 2/);assert.match(nextLog,/--memory 256m/);assert.match(nextLog,new RegExp(B.image));assert.equal(f.providerCalls,0);f.pass();
});
