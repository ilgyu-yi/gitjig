import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createScope,reconcileScope} from '../../dist/execution/container-scope.js';

// Controlled native response/transport negatives, separate from actual-engine
// and installed interruption qualification. Bindings are produced by createScope.
async function fixture(t,{mode='valid',explicitConfig=true}={}){
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/scope-absence-'))),state=path.join(root,'native.json'),calls=path.join(root,'calls.json'),binary=path.join(root,'docker'),config=path.join(root,'config'),workRoot=path.join(root,'work'),stateRoot=path.join(root,'runtime');
    for(const directory of [config,workRoot,stateRoot])await fs.mkdir(directory,{mode:0o700});
    await fs.writeFile(state,JSON.stringify({mode,id:'a'.repeat(64),exists:false,running:false,infoCount:0,listMode:'empty'}),{mode:0o600});await fs.writeFile(calls,'[]',{mode:0o600});
    await fs.writeFile(binary,`#!${process.execPath}
import fs from 'node:fs';
import {spawn} from 'node:child_process';
const file=${JSON.stringify(state)},log=${JSON.stringify(calls)},config=${JSON.stringify(config)},args=process.argv.slice(2),command=args.slice(args.indexOf('--context')+2),s=JSON.parse(fs.readFileSync(file)),calls=JSON.parse(fs.readFileSync(log));calls.push(command);fs.writeFileSync(log,JSON.stringify(calls));
const save=()=>fs.writeFileSync(file,JSON.stringify(s)),out=(value,code=0)=>{save();if(value)process.stdout.write(value);process.exitCode=code;};
if(command[0]==='info'&&(['infoInherited','infoHang','infoEscaped'].includes(s.mode)||s.mode==='infoEscapedAfterCreate'&&s.infoCount>=1)||command[0]==='exec'&&s.mode==='execEscaped'){
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2],detached:['infoEscaped','infoEscapedAfterCreate','execEscaped'].includes(s.mode)});
 s.nativePid=process.pid;s.helperPid=child.pid;save();
 if(s.mode==='infoHang')setInterval(()=>{},1000);else setTimeout(()=>process.exit(0),30);
}
else if(command[0]==='info'){s.infoCount++;if(s.mode==='infoStderr')process.stderr.write('native warning');if(s.mode==='infoDenied')out('',13);else if(s.mode==='infoMalformed')out('{}\\n');else out(JSON.stringify((s.mode==='daemonMismatch'&&s.infoCount>=2||s.mode==='wrongDaemon'||s.mode==='lateDaemonChange'&&s.infoCount>=4)?'DAEMON-B':'DAEMON-A')+'\\n');}
else if(command[0]==='create'){s.createCount=(s.createCount??0)+1;if(s.createCount>1)s.id=s.createCount.toString(16).padStart(64,'0');s.exists=true;s.labels=Object.fromEntries(command.filter((x,i)=>command[i-1]==='--label').map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));out(s.id+'\\n');}
else if(command[0]==='start'){s.running=true;out(s.id+'\\n');}
else if(command[0]==='inspect'){if(!s.exists)out('',1);else out(JSON.stringify([{Id:s.foreignId??s.id,Image:'sha256:'+'1'.repeat(64),State:{Running:s.running},Config:{Labels:s.labels}}])+'\\n');}
else if(command[0]==='stop'||command[0]==='kill'){s.running=false;out(s.id+'\\n');}
else if(command[0]==='rm'){if(s.running)out('',1);else{s.exists=false;out(s.id+'\\n');}}
else if(command[0]==='container'&&command[1]==='ls'){
 if(!['--all','--no-trunc','--quiet'].every(flag=>command.includes(flag)))out('',2);
 else if(s.listMode==='failure')out('',1);
 else if(s.listMode==='stderr'){process.stderr.write('native warning');out('');}
 else if(s.listMode==='present')out(s.id+'\\n');
 else if(s.listMode==='unrelated')out('b'.repeat(64)+'\\n');
 else if(s.listMode==='duplicate')out(('b'.repeat(64)+'\\n').repeat(2));
 else if(s.listMode==='partial')out('b'.repeat(64));
 else if(s.listMode==='malformed')out('[]\\n');
 else if(s.listMode==='overflow')out('b'.repeat(2*1024*1024));
 else if(s.listMode==='routeChange'){fs.writeFileSync(config+'/changed','Observed metadata drift');out('');}
 else out('');
}else out('',2);
`,{mode:0o700});
    // .mjs is not needed for a shebang entry under this repository's module package.
    await fs.writeFile(path.join(root,'package.json'),'{"type":"module"}',{mode:0o600});
    let passed=false;
    t.after(async()=>{
      const saved=JSON.parse(await fs.readFile(state,'utf8'));
      for(const pid of [saved.helperPid,saved.nativePid])if(pid)try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
      if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained controlled scope fixture: '+root);});
    const options={dockerBinary:binary,dockerContext:'fixture',...(explicitConfig?{dockerConfigDirectory:config}:{}),image:'sha256:'+'1'.repeat(64),workRoot,stateRoot,workId:'original-work',runId:'original-run'};
    const read=async()=>JSON.parse(await fs.readFile(state,'utf8')),change=async values=>fs.writeFile(state,JSON.stringify({...await read(),...values}));
    return {root,binary,config,stateRoot,options,read,change,calls:async()=>JSON.parse(await fs.readFile(calls,'utf8')),journal:async()=>path.join(stateRoot,(await fs.readdir(stateRoot)).find(name=>name.endsWith('.json'))),pass(){passed=true;}};
}

test('settled full-ID creation binds its original daemon and successful complete absence changes cleanup only',async t=>{
    const f=await fixture(t),scope=await createScope(f.options),file=await f.journal(),before=JSON.parse(await fs.readFile(file,'utf8'));
    assert.equal(before.creationBinding.state,'VERIFIED');assert.equal(before.creationBinding.createSettled,true);assert.equal(before.creationBinding.daemonId,'DAEMON-A');
    await f.change({exists:false,running:false,listMode:'unrelated'});const recovered=await reconcileScope(file,f.binary,f.config),after=JSON.parse(await fs.readFile(file,'utf8'));
    assert.equal(recovered.state,'removed');assert.deepEqual(after.creationBinding,before.creationBinding);assert.equal(after.id,scope.containerId);assert.equal(after.runId,before.runId);assert.equal(after.workId,before.workId);assert.equal(after.absenceEvidence.inventoryCount,1);
    assert.ok((await f.calls()).filter(args=>args[0]==='container').every(args=>['--all','--no-trunc','--quiet'].every(flag=>args.includes(flag))));assert.equal((await f.calls()).some(args=>args[0]==='rm'),false);f.pass();
});

for(const listMode of ['failure','stderr','present','duplicate','partial','malformed','overflow','routeChange'])test('absence refuses '+listMode+' inventory without removal or a false receipt',async t=>{
    const f=await fixture(t);await createScope(f.options);const file=await f.journal(),before=JSON.parse(await fs.readFile(file,'utf8'));
    await f.change({exists:false,running:false,listMode});const result=await reconcileScope(file,f.binary,f.config),after=JSON.parse(await fs.readFile(file,'utf8'));
    assert.equal(result.state,'quarantined');assert.equal(after.absenceEvidence,undefined);assert.deepEqual(after.creationBinding,before.creationBinding);assert.equal((await f.calls()).some(args=>args[0]==='rm'),false);f.pass();
});

for(const mode of ['wrongDaemon','lateDaemonChange'])test('absence refuses '+mode+' while preserving the original binding',async t=>{
    const f=await fixture(t);await createScope(f.options);const file=await f.journal(),before=JSON.parse(await fs.readFile(file,'utf8'));await f.change({exists:false,running:false,mode});
    assert.equal((await reconcileScope(file,f.binary,f.config)).state,'quarantined');assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')).creationBinding,before.creationBinding);f.pass();
});

for(const mode of ['infoDenied','infoMalformed','infoStderr'])test(mode+' preserves normal positive owned cleanup without granting retrospective absence',async t=>{
    const f=await fixture(t,{mode}),scope=await createScope(f.options),file=await f.journal();assert.equal(JSON.parse(await fs.readFile(file,'utf8')).creationBinding.state,'UNAVAILABLE');
    assert.equal((await scope.close()).state,'removed');
    const other=await createScope(f.options),otherFile=(await fs.readdir(f.stateRoot)).map(name=>path.join(f.stateRoot,name)).find(name=>name!==file),before=JSON.parse(await fs.readFile(otherFile,'utf8'));
    assert.notEqual(other.containerId,scope.containerId);await f.change({mode:'valid',exists:false,running:false});assert.equal((await reconcileScope(otherFile,f.binary,f.config)).state,'quarantined');assert.deepEqual(JSON.parse(await fs.readFile(otherFile,'utf8')).creationBinding,before.creationBinding);f.pass();
});

test('changed daemon during create aborts before project execution and cleans only the positively owned ID',async t=>{
    const f=await fixture(t,{mode:'daemonMismatch'});await assert.rejects(createScope(f.options),/daemon changed/);const saved=JSON.parse(await fs.readFile(await f.journal(),'utf8'));
    assert.equal(saved.state,'removed');assert.equal(saved.creationBinding.state,'UNAVAILABLE');assert.equal((await f.calls()).some(args=>args[0]==='start'),false);assert.equal((await f.calls()).filter(args=>args[0]==='rm').length,1);f.pass();
});

test('legacy, missing and name-only journals never acquire a daemon identity from current observations',async t=>{
    const f=await fixture(t);await createScope(f.options);const file=await f.journal(),original=JSON.parse(await fs.readFile(file,'utf8'));await f.change({exists:false,running:false});
    for(const saved of [{...original,creationBinding:undefined},{...original,id:undefined,creationBinding:undefined}]){
        await fs.writeFile(file,JSON.stringify(saved));const calls=(await f.calls()).length;assert.equal((await reconcileScope(file,f.binary,f.config)).state,'quarantined');assert.equal(JSON.parse(await fs.readFile(file,'utf8')).creationBinding,undefined);assert.ok((await f.calls()).slice(calls).every(args=>args[0]==='inspect'));
    }
    f.pass();
});

test('foreign binding, client and config correspondence cannot authorize absence or foreign positive cleanup',async t=>{
    const f=await fixture(t);await createScope(f.options);const file=await f.journal(),original=JSON.parse(await fs.readFile(file,'utf8'));await f.change({exists:false,running:false});
    await fs.writeFile(file,JSON.stringify({...original,creationBinding:{...original.creationBinding,scopeHash:'0'.repeat(64)}}));await assert.rejects(reconcileScope(file,f.binary,f.config),/creation binding/);
    await fs.writeFile(file,JSON.stringify(original));const alternate=path.join(f.root,'other-docker');await fs.copyFile(f.binary,alternate);await fs.chmod(alternate,0o700);assert.equal((await reconcileScope(file,alternate,f.config)).state,'quarantined');
    const otherConfig=path.join(f.root,'other-config');await fs.mkdir(otherConfig,{mode:0o700});await assert.rejects(reconcileScope(file,f.binary,otherConfig),/configuration route differs/);
    await f.change({exists:true,foreignId:'b'.repeat(64)});await assert.rejects(reconcileScope(file,f.binary,f.config),/ownership mismatch/);assert.equal((await f.calls()).some(args=>args[0]==='rm'),false);f.pass();
});

test('benign metadata changes before a new stable observation do not pin historical mtimes forever',async t=>{
    const f=await fixture(t);await createScope(f.options);const file=await f.journal();await fs.writeFile(path.join(f.config,'cache'),'Benign local update');await f.change({exists:false,running:false});assert.equal((await reconcileScope(file,f.binary,f.config)).state,'removed');f.pass();
});

test('implicit configuration retains the existing positive cleanup path without new info permission',async t=>{
    const f=await fixture(t,{explicitConfig:false}),scope=await createScope(f.options);assert.equal((await scope.close()).state,'removed');assert.equal((await f.calls()).some(args=>args[0]==='info'),false);f.pass();
});


// Native transport lifetime regressions use owned local processes only. These
// are not claims about a real engine, daemon or remote Docker helper.
async function bounded(promise,ms=9000){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native fixture exceeded settlement bound')),ms);})]);}finally{clearTimeout(timer);}
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
for(const mode of ['infoInherited','infoHang'])test(mode+' settles owned descendants without granting daemon absence proof',async t=>{
 const f=await fixture(t,{mode});
 const scope=await bounded(createScope(f.options)),saved=await f.read();
 assert.equal(alive(saved.helperPid),false,'owned descendant must be gone before success');
 assert.equal(JSON.parse(await fs.readFile(await f.journal(),'utf8')).creationBinding.state,'UNAVAILABLE');
 assert.equal((await scope.close()).state,'removed');f.pass();
});
test('native cancellation terminates descendants and returns before allocation',async t=>{
 const f=await fixture(t,{mode:'infoHang'}),abort=new AbortController();
 const pending=createScope({...f.options,signal:abort.signal});
 await bounded((async()=>{while(!(await f.read()).helperPid)await new Promise(resolve=>setTimeout(resolve,10));})());
 abort.abort();await assert.rejects(bounded(pending),/aborted before allocation/);
 assert.equal(alive((await f.read()).helperPid),false);
 assert.equal((await f.calls()).some(args=>args[0]==='create'),false);
 assert.equal(JSON.parse(await fs.readFile(await f.journal(),'utf8')).state,'removed');f.pass();
});
test('unconfirmed native pipe cleanup refuses optional observation fallback and allocation',async t=>{
 const f=await fixture(t,{mode:'infoEscaped'});
 await assert.rejects(bounded(createScope(f.options)),/Native process cleanup unconfirmed/);
 assert.equal((await f.calls()).some(args=>args[0]==='create'),false);
 assert.notEqual(JSON.parse(await fs.readFile(await f.journal(),'utf8')).state,'removed');f.pass();
});

for(const mode of ['infoEscapedAfterCreate','execEscaped'])test(mode+' retains native uncertainty after positive container removal',async t=>{
 const f=await fixture(t,{mode});let scope;
 if(mode==='execEscaped'){
  scope=await createScope(f.options);
  await assert.rejects(bounded(scope.execute('fixture',{timeoutMs:60000}),5000),/Native process cleanup unconfirmed/);
  assert.equal((await scope.close()).state,'quarantined');
 }else await assert.rejects(bounded(createScope(f.options),5000),/Native process cleanup unconfirmed/);
 const file=await f.journal(),saved=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal((await f.read()).exists,false,'positive container removal still occurs');
 assert.equal(saved.state,'quarantined');assert.equal(saved.nativeCleanupUnknown.version,1);
 assert.equal(typeof saved.nativeCleanupUnknown.processGroup,'number');
 assert.equal((await reconcileScope(file,f.binary,f.config)).state,'quarantined','container absence cannot erase native uncertainty');
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),saved,'reconciliation must retain original checkpoint');f.pass();
});

test('late native uncertainty overrides a cached positive close',async t=>{
 const f=await fixture(t,{mode:'execEscaped'}),scope=await createScope(f.options);
 const pending=scope.execute('fixture',{timeoutMs:60000});void pending.catch(()=>{});
 await bounded((async()=>{while(!(await f.read()).helperPid)await new Promise(resolve=>setTimeout(resolve,10));})());
 assert.equal((await scope.close()).state,'removed');
 await assert.rejects(bounded(pending,5000),/Native process cleanup unconfirmed/);
 assert.equal((await scope.close()).state,'quarantined');
 assert.equal(JSON.parse(await fs.readFile(await f.journal(),'utf8')).state,'quarantined');f.pass();
});
test('one failed native quarantine write preserves its cause and still removes the exact owned container',async t=>{
 const f=await fixture(t,{mode:'infoEscapedAfterCreate'}),pending=createScope(f.options);void pending.catch(()=>{});
 await bounded((async()=>{while(!(await f.read()).helperPid)await new Promise(resolve=>setTimeout(resolve,10));})());
 const file=await f.journal(),originalOpen=fs.open;let injected=false;
 fs.open=async function(candidate,...args){
  if(candidate===file+'.next'&&!injected){injected=true;throw Object.assign(Error('Owned one-shot quarantine write failure'),{code:'EIO'});}
  return originalOpen.call(this,candidate,...args);
 };
 try{
  await assert.rejects(bounded(pending,5000),error=>/Native process cleanup unconfirmed/.test(error.message)&&error.cause?.code==='EIO');
 }finally{fs.open=originalOpen;}
 assert.equal(injected,true);assert.equal((await f.read()).exists,false);
 const saved=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(saved.state,'quarantined');assert.match(saved.nativeCleanupUnknown.reason,/original process group/);
 assert.match(saved.nativeCleanupUnknown.persistenceFailure,/one-shot quarantine write failure/);
 assert.equal((await reconcileScope(file,f.binary,f.config)).state,'quarantined');f.pass();
});
