import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installationProcessRunner} from './offline-source-fixture.mjs';
async function world(t,signal){
 const root=await fs.mkdtemp(path.join(process.env.GITJIG_INSTALLATION_FIXTURE_ROOT??os.tmpdir(),'installation-runner-')),invocations=[],groups=new Set();
 t.after(async()=>{await fs.writeFile(path.join(root,'runner-evidence.json'),JSON.stringify({invocations,remainingGroups:[...groups]},null,2),{mode:0o600});if(!groups.size&&process.env.GITJIG_RETAIN_INSTALLATION_FIXTURE!=='1')await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained owned runner evidence: '+root);});
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TMPDIR:root};
 return {root,invocations,groups,run:installationProcessRunner({root,env,invocations,groups,signal})};
}
test('owned installation runner observes fast original completions before receipt IO finishes',async t=>{
 const f=await world(t,t.signal);
 for(let i=0;i<10;i++)assert.equal(await f.run(process.execPath,['-e',"process.stdout.write('fast')"],'fast-'+i),'fast');
 assert.equal(f.invocations.length,10);assert.equal(f.groups.size,0);
});
test('aggregate abort interrupts and joins the original fixture process and seals later admission',async t=>{
 const controller=new AbortController(),f=await world(t,controller.signal);
 const pending=f.run(process.execPath,['--input-type=module','-e',"import fs from 'node:fs';process.on('SIGINT',()=>process.exit(0));fs.writeFileSync('ready','ready');setInterval(()=>{},1000);"],'original',{timeout:3000});
 const failed=assert.rejects(pending,/aggregate cancellation/);
 const deadline=Date.now()+2000;
 while(true){try{await fs.access(path.join(f.root,'ready'));break;}catch(error){assert.equal(error.code,'ENOENT');assert.ok(Date.now()<deadline,'original child did not start');await new Promise(resolve=>setTimeout(resolve,10));}}
 controller.abort();await failed;assert.equal(f.groups.size,0);assert.equal(f.invocations.length,1);assert.equal(f.invocations[0].aborted,true);assert.equal(f.invocations[0].expired,false);
 for(const pid of [f.invocations[0].pid,-f.invocations[0].pid])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 await assert.rejects(f.run(process.execPath,['-e',"process.stdout.write('later')"],'later'),{name:'AbortError'});
 await assert.rejects(fs.access(path.join(f.root,'later.started.json')),{code:'ENOENT'});assert.equal(f.invocations.length,1);
});
test('pre-aborted and first-await cancellation cannot leave an admitted process behind',async t=>{
 const controller=new AbortController();controller.abort();const f=await world(t,controller.signal);
 await assert.rejects(f.run(process.execPath,['-e','0'],'never'),{name:'AbortError'});assert.equal(f.invocations.length,0);assert.equal(f.groups.size,0);
 const next=new AbortController(),g=await world(t,next.signal);queueMicrotask(()=>next.abort());
 await assert.rejects(g.run(process.execPath,['-e','setInterval(()=>{},1000)'],'racing'),/aggregate cancellation/);
 assert.equal(g.invocations[0].aborted,true);assert.equal(g.groups.size,0);
 for(const pid of [g.invocations[0].pid,-g.invocations[0].pid])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
