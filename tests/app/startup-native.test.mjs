import {nativeOwnerHistory} from '../pi/native-owner-history.mjs';
// Source qualification with original Pi/SDK/bridge; private fake native, never real Claude/auth.
import{createReadStream}from'node:fs';import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const source=fileURLToPath(new URL('../../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),quote=text=>"'"+text.replaceAll("'","'\\''")+"'";
async function shaFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const absent=(pid,group=false)=>{try{process.kill(group?-pid:pid,0);return false;}catch(error){return error.code==='ESRCH';}};
const platform=process.platform==='darwin'&&process.arch==='arm64';
const mode='startup-two';test('saved startup actual CLI native dialogue survives normal relaunch',{timeout:60000,skip:platform?false:'Current source auxiliary fixture profile is Darwin arm64'},async t=>{
 const started=performance.now(),root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'gitjig-startup-native-'))),candidate=path.join(root,'candidate'),world=path.join(root,'world');await fs.mkdir(candidate,{mode:0o700});await fs.mkdir(world,{mode:0o700});
 console.log('Retained startup native world: '+root);
 await fs.cp(path.join(source,'dist'),path.join(candidate,'dist'),{recursive:true});await fs.copyFile(path.join(source,'package.json'),path.join(candidate,'package.json'));
 const nm=path.join(candidate,'node_modules');await fs.mkdir(nm,{mode:0o700});const links=[];
 for(const entry of await fs.readdir(path.join(source,'node_modules'),{withFileTypes:true})){
  const original=path.join(source,'node_modules',entry.name),target=path.join(nm,entry.name);
  if(['@anthropic-ai','@gitjig'].includes(entry.name)){
   await fs.mkdir(target,{mode:0o700});
   for(const pkg of await fs.readdir(original)){
    const from=path.join(original,pkg),to=path.join(target,pkg);
    if(['claude-agent-sdk','pi-claude-bridge-host'].includes(pkg))await fs.cp(from,to,{recursive:true});
    else if(pkg==='claude-agent-sdk-darwin-arm64'){
     await fs.mkdir(to,{mode:0o700});for(const item of await fs.readdir(from))if(item!=='claude')await fs.cp(path.join(from,item),path.join(to,item),{recursive:true});
    }else{await fs.symlink(from,to);links.push({path:to,target:from});}
   }
  }else{await fs.symlink(original,target);links.push({path:target,target:original});}
 }
 const protocol=path.join(root,'protocol.mjs'),protocolBytes=await fs.readFile(new URL('./bridge-native-protocol.mjs',import.meta.url));await fs.writeFile(protocol,protocolBytes,{mode:0o600});
 const executable=path.join(nm,'@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),originalNative=path.join(source,'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'),nativeOriginal=await shaFile(originalNative);
 const wrapper='#!/bin/sh\nexec '+quote(await fs.realpath(process.execPath))+' '+quote(protocol)+' '+quote(mode)+' "$@"\n';await fs.writeFile(executable,wrapper,{mode:0o700,flag:'wx'});
 const bindings=[];
 const bindTree=async relative=>{for(const item of await fs.readdir(path.join(candidate,relative),{withFileTypes:true})){const child=path.join(relative,item.name);if(item.isDirectory())await bindTree(child);else if(item.isFile()){const bytes=await fs.readFile(path.join(candidate,child));assert.equal(sha(bytes),sha(await fs.readFile(path.join(source,child))));bindings.push({path:child,sha256:sha(bytes)});}else throw Error('Unexpected link in copied source package');}};
 for(const relative of['dist','node_modules/@anthropic-ai/claude-agent-sdk','node_modules/@gitjig/pi-claude-bridge-host'])await bindTree(relative);
 for(const relative of['package.json','package-lock.json'])bindings.push({path:relative,sha256:sha(await fs.readFile(path.join(source,relative)))});
 const trace=path.join(root,'trace.json'),guard=path.join(root,'guard.mjs');
 await fs.writeFile(guard,`import fs from 'node:fs';import net from 'node:net';import http from 'node:http';import https from 'node:https';import {registerHooks,syncBuiltinESMExports} from 'node:module';const urls=new Set();let attempts=0;const deny=()=>{attempts++;throw Error('AUX_TEST_NO_NETWORK');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;for(const api of[http,https])for(const name of['request','get'])api[name]=deny;syncBuiltinESMExports();registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.includes('/dist/pi/')||result.url.includes('/@gitjig/pi-claude-bridge-host/')||result.url.includes('/@anthropic-ai/claude-agent-sdk/')){if(!result.url.startsWith(${JSON.stringify('file://'+candidate+'/')}))throw Error('AUX_WRONG_SOURCE_RESOLUTION');urls.add(result.url);}return result;}});process.on('exit',()=>{const bytes=JSON.stringify({urls:[...urls],attempts});if(bytes.length>1048576)process.exitCode=1;else fs.writeFileSync(${JSON.stringify(trace)},bytes,{mode:0o600});if(attempts)process.exitCode=1;});`,{mode:0o600});
 const guardProbe=spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',"import net from 'node:net';import http from 'node:http';try{await fetch('http://127.0.0.1:1')}catch{}try{new net.Socket().connect(1,'127.0.0.1')}catch{}try{http.get('http://127.0.0.1:1')}catch{}"],{env:{PATH:'/usr/bin:/bin',HOME:world},timeout:2000,maxBuffer:4096});
 assert.equal(guardProbe.status,1);assert.equal(guardProbe.signal,null);assert.equal(guardProbe.error,undefined);const guardControl=JSON.parse(await fs.readFile(trace,'utf8'));assert.equal(guardControl.attempts,3);await fs.rename(trace,path.join(root,'tripwire-control.json'));
 assert.ok(performance.now()-started<15000,'Selected setup budget15s');
 for(const relative of['host','agent','agent/home','native-account','native-account/private','bootstrap-temp'])await fs.mkdir(path.join(world,relative),{recursive:true,mode:0o700});
 await fs.writeFile(path.join(world,'agent/claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
 const home=path.join(world,'app'),main=path.join(candidate,'dist/cli/main.js');
 for(const name of ['stock-home','stock-agent'])await fs.mkdir(path.join(world,name),{mode:0o700});
 const stockFile=path.join(world,'stock-agent/settings.json'),stock='{"defaultModel":"MUST_NOT_INHERIT"}';await fs.writeFile(stockFile,stock,{mode:0o600});
 const baseEnv={PATH:'/usr/bin:/bin',USER:'owned',LOGNAME:'owned',LANG:'C',TERM:'xterm-256color',SHELL:'/bin/sh',HOME:path.join(world,'stock-home'),PI_CODING_AGENT_DIR:path.join(world,'stock-agent'),PI_PACKAGE_DIR:path.join(world,'MUST_NOT_LOAD_PACKAGE'),TMPDIR:path.join(world,'bootstrap-temp')};
 const bootstrapArgv=['--import',guard,main,'setup','inspect','--home',home],bootstrap=spawnSync(process.execPath,bootstrapArgv,{cwd:world,env:baseEnv,timeout:5000,maxBuffer:65536});
 await fs.writeFile(path.join(root,'bootstrap.json'),JSON.stringify({argv:bootstrapArgv,env:baseEnv,status:bootstrap.status,signal:bootstrap.signal,error:bootstrap.error?String(bootstrap.error):null,stdout:bootstrap.stdout?.toString(),stderr:bootstrap.stderr?.toString()},null,2));
 assert.equal(bootstrap.error,undefined);assert.equal(bootstrap.signal,null);assert.equal(bootstrap.status,0,bootstrap.stderr?.toString());assert.equal(JSON.parse(bootstrap.stdout.toString()).saved,null);await fs.rename(trace,path.join(root,'bootstrap-trace.json'));assert.equal(JSON.parse(await fs.readFile(path.join(root,'bootstrap-trace.json'),'utf8')).attempts,0);assert.equal(await fs.realpath(path.join(home,'artifacts')),path.join(home,'artifacts'));
 baseEnv.TMPDIR=path.join(home,'artifacts');
 assert.ok(performance.now()-started<15000,'Setup including original home bootstrap stays<=15s');
 const executionDeadline=started+40000,invocations=[],uiPids=new Set(),journals=[],failureCleanup=[];let receipt,problem;
 const run=async(binary,args,label,timeout=6000,expected=0)=>{
  timeout=Math.min(timeout,executionDeadline-performance.now());assert.ok(timeout>0,'Native startup operation deadline reached; no further child');
  const env={...baseEnv};await fs.writeFile(path.join(root,label+'.invocation.json'),JSON.stringify({binary,args,env,cwd:world}));
  timeout=Math.min(timeout,executionDeadline-performance.now());assert.ok(timeout>0,'Native startup deadline expired while recording invocation; no child');
  const child=spawn(binary,args,{cwd:world,env,detached:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',bytes=0,expired=false,overflow=false;
  const stop=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};const timer=setTimeout(()=>{expired=true;stop();},timeout);
  for(const [stream,key]of[[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>262144){overflow=true;stop();return;}if(key==='stdout')stdout+=chunk;else stderr+=chunk;});
  let result;try{result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(timer);}
  const record={label,pid:child.pid,args,...result,expired,overflow,stdout,stderr};invocations.push(record);await fs.writeFile(path.join(root,label+'.result.json'),JSON.stringify(record));
  assert.equal(expired,false,stderr);assert.equal(overflow,false);assert.equal(result.signal,null);assert.equal(result.code,expected,stderr);assert.equal(absent(child.pid,true),true);
  if(binary===process.execPath){const loaded=JSON.parse(await fs.readFile(trace,'utf8'));assert.equal(loaded.attempts,0);await fs.rename(trace,path.join(root,label+'.trace.json'));}
  return stdout?JSON.parse(stdout):null;
 };
 const cli=(words,label,expected=0)=>run(process.execPath,['--import',guard,main,...words,'--home',home],label,6000,expected);
 const readDb=action=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{return action(db);}finally{db.close();}};
 const snapshot=()=>readDb(db=>Object.fromEntries(['conversations','conversation_state','conversation_inputs','works','runs','budgets','capacity_leases','obligations'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 const ui=async(cid,number,model)=>{
  const file=path.join(root,'ui-'+number+'.json'),pidFile=file+'.pid',output=file+'.terminal';
  await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,main,'conversation','ui','--home',home,...(cid?['--conversation',cid]:[])],env:baseEnv,steps:[{wait:'Model: '+model,send:'B_NATIVE_TURN_'+number+'\r'},{wait:'SYNTHETIC_BRIDGE_TURN_'+number,waitIdle:true,send:'/quit\u001b\r'}],timeoutSeconds:7,database:path.join(home,'state/controller.sqlite'),output,pidFile}),{mode:0o600});
  const result=await run('/usr/bin/python3',[path.join(source,'tests/cli/managed-ui-pty.py'),file],'ui-'+number,9000);
  const pid=Number(await fs.readFile(pidFile,'utf8'));uiPids.add(pid);assert.equal(absent(pid),true);assert.equal(result.exitCode,0);assert.equal(result.stages,2);assert.equal(result.terminalRestored,true);
  const loaded=JSON.parse(await fs.readFile(trace,'utf8'));assert.equal(loaded.attempts,0);await fs.rename(trace,file+'.trace.json');return result;
 };
 try{
  const setup={version:1,bridge:{profile:{kind:'installed-claude-bridge',cwd:path.join(world,'host'),agentDir:path.join(world,'agent'),executable:{file:executable,sha256:sha(wrapper)}},nativeAccountDirectory:path.join(world,'native-account/private')}},setupFile=path.join(root,'setup.json');await fs.writeFile(setupFile,JSON.stringify(setup),{mode:0o600});
  await cli(['setup','save','--file',setupFile],'setup-save');const saved=await cli(['setup','inspect'],'setup-inspect');assert.deepEqual(saved.saved,setup);
  const roster=(await cli(['models','list','--search','claude-bridge/'],'models')).models,model=roster.find(m=>m.id!=='claude-opus-5-5'&&m.reasoning);assert.ok(model);
  await cli(['models','default','--provider','claude-bridge','--model',model.id],'default');await cli(['settings','set','--key','defaultThinkingLevel','--value','"high"'],'thinking');
  const rootCases=[['child-host',path.join(world,'host/project-child')],['child-agent',path.join(world,'agent/project-child')],['parent-account',path.join(world,'native-account')],['contains-native-executable',path.dirname(executable)]];
  for(const [id,directory]of rootCases){await fs.mkdir(directory,{recursive:true,mode:0o700});await cli(['project','register','--id',id,'--root',directory],'refuse-'+id,2);assert.match(invocations.at(-1).stderr,/disjoint from active startup authority paths/);}
  const project=path.join(world,'ordinary-project');await fs.mkdir(project,{mode:0o700});await fs.writeFile(path.join(project,'source.txt'),'ORDINARY PROJECT');await cli(['project','register','--id','VALID','--root',project],'valid-project');assert.equal((await cli(['project','list'],'project-list')).length,1);
  const startupBytes=await fs.readFile(path.join(home,'config/startup.json'));await ui(undefined,1,model.id);
  let first=snapshot();assert.equal(first.conversations.length,1);const cid=first.conversations[0].id,work=first.runs[0].work;assert.equal(first.runs.length,1);assert.equal(first.runs[0].phase,'SETTLED');assert.equal(JSON.parse(first.runs[0].data).outcome,'delivered');assert.equal(first.runs[0].reservation,'consumed');
  const historyFile=first.conversations[0].history,before=await fs.readFile(historyFile),choice=JSON.parse(first.conversation_state[0].data).modelChoice;assert.equal(choice.modelId,model.id);assert.equal(choice.thinkingLevel,'high');assert.ok(before.includes(Buffer.from('B_NATIVE_TURN_1')));await fs.writeFile(path.join(root,'first-history.jsonl'),before);
  // A genuine separate pending owner input is created through the original public
  // controller. This helper does not project saved startup or generate any work.
  const pendingWorker=path.join(root,'pending.mjs');await fs.writeFile(pendingWorker,`import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';for(const key of['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=()=>{throw Error('PENDING_NO_PRODUCER');};syncBuiltinESMExports();const{openController}=await import(${JSON.stringify('file://'+candidate+'/dist/controller/index.js')});const c=await openController({installationHome:${JSON.stringify(home)}});try{const v=c.createConversation();const input=await c.queueConversationInput({conversationId:v.conversationId,expectedGeneration:0,text:'RETAIN_SIBLING_PENDING_NATIVE_RELAUNCH',mode:'idle'});console.log(JSON.stringify({conversationId:v.conversationId,input}));}finally{await c.close();}`,{mode:0o600});
  const pending=await run(process.execPath,['--import',guard,pendingWorker],'pending'),retained=snapshot();await fs.writeFile(path.join(root,'before-relaunch.json'),JSON.stringify(retained));
  await ui(cid,2,model.id);const after=snapshot();await fs.writeFile(path.join(root,'after-relaunch.json'),JSON.stringify(after));
  assert.equal(after.runs.length,2);for(const row of after.runs){assert.equal(row.work,work);assert.equal(row.phase,'SETTLED');assert.equal(row.reservation,'consumed');const data=JSON.parse(row.data);assert.equal(data.outcome,'delivered');assert.equal(data.conversationModelMode.kind,'application');}
  assert.deepEqual(after.runs[0],first.runs[0]);const current=after.conversation_state.find(row=>row.conversation===cid);assert.deepEqual(JSON.parse(current.data).modelChoice,choice);assert.equal(current.native_id,first.conversation_state[0].native_id);
  const afterBytes=await fs.readFile(historyFile);assert.ok(afterBytes.subarray(0,before.length).equals(before));assert.ok(afterBytes.includes(Buffer.from('B_NATIVE_TURN_2')));
  for(const table of['conversations','conversation_state','conversation_inputs']){const key=table==='conversations'?'id':'conversation';assert.deepEqual(after[table].filter(row=>row[key]===pending.conversationId),retained[table].filter(row=>row[key]===pending.conversationId));}
  assert.equal(after.conversation_inputs.filter(row=>row.conversation===cid&&row.state==='CONSUMED').length,2);assert.equal(after.conversation_inputs.find(row=>row.conversation===pending.conversationId).state,'QUEUED');
  assert.ok(after.capacity_leases.every(row=>row.state==='RELEASED'));const budget=after.budgets.find(row=>row.lineage===work&&row.kind==='execution');assert.equal(budget.consumed,2);assert.equal(budget.reserved,0);assert.ok((await fs.readFile(path.join(home,'config/startup.json'))).equals(startupBytes));assert.equal(await fs.readFile(stockFile,'utf8'),stock);
  const owners=path.join(home,'state/runtime/native-owners/v1'),dirs=await nativeOwnerHistory(owners);
  for(const {nonce,dir} of dirs){
   const read=async name=>JSON.parse(await fs.readFile(path.join(dir,name+'.json'),'utf8')),admission=await read('admission'),birth=await read('birth'),settlement=await read('settlement'),physical=await read('recovery');
   assert.ok(uiPids.has(admission.hostPid));assert.equal(admission.sessionId,current.native_id);for(const row of[birth,settlement,physical])for(const key of['nonce','sessionId','guardianPid','executableSha256'])assert.equal(row[key],admission[key]);assert.equal(admission.executableSha256,sha(wrapper));assert.equal(admission.purpose,'provider');assert.equal(settlement.cleanup,'confirmed');assert.equal(settlement.groupAbsent,true);assert.equal(settlement.stdioReleased,true);assert.equal(physical.outcome,'active-owner-scope-joined');assert.equal(absent(birth.nativePid,true),true);assert.equal(absent(admission.guardianPid),true);journals.push({nonce,admission,birth,settlement,physical});
  }
  const queries=(await fs.readFile(path.join(world,'host/fixture-observation.json'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(queries.length,2);assert.equal(journals.length,2);assert.equal(queries[0].containsSecond,false);assert.equal(queries[1].containsFirst,false);assert.equal(queries[1].containsSecond,true);assert.equal(queries[0].resumeTarget,undefined);assert.ok(queries[1].resumeTarget);const nativeResume=queries[1].resumeHistory;assert.ok(nativeResume);assert.equal(path.basename(nativeResume.file),queries[1].resumeTarget+'.jsonl');assert.equal(nativeResume.containsFirst,true);assert.equal(nativeResume.containsFirstReply,true);const nativeBytes=await fs.readFile(nativeResume.file);assert.equal(sha(nativeBytes),nativeResume.sha256);assert.equal(nativeBytes.length,nativeResume.bytes);
  for(const query of queries){assert.equal(query.model.replace(/\[1m\]$/,''),model.id);assert.equal(query.summary,false);assert.equal(query.effort,'high');assert.deepEqual(query.environment,{HOME:path.join(world,'agent/home'),CLAUDE_CONFIG_DIR:path.join(world,'native-account/private'),TMPDIR:path.join(home,'artifacts')});assert.equal(query.cwd,path.join(world,'host'));assert.equal(journals.filter(j=>j.birth.nativePid===query.pid).length,1);}
  assert.equal(await shaFile(originalNative),nativeOriginal);receipt={complete:true,conversationId:cid,workId:work,model:model.id,choice,pending,queries,normalCliRelaunch:true,historyPrefixPreserved:true,priorRunUnchanged:true,siblingPendingUnchanged:true};
 }catch(error){problem=error;throw error;}finally{
  // Stop only this fixture's observed hosts and owned detached native scopes.
  const failureDeadline=performance.now()+6000;
  for(const file of['ui-1.json.pid','ui-2.json.pid']){const pid=Number(await fs.readFile(path.join(root,file),'utf8').catch(()=>0));if(pid)uiPids.add(pid);if(pid&&!absent(pid))try{process.kill(pid,'SIGTERM');}catch{}}
  if(problem){const owners=path.join(home,'state/runtime/native-owners/v1');for(const nonce of await fs.readdir(owners).catch(()=>[])){
   let a,b,p;try{a=JSON.parse(await fs.readFile(path.join(owners,nonce,'admission.json'),'utf8'));b=JSON.parse(await fs.readFile(path.join(owners,nonce,'birth.json'),'utf8'));p=JSON.parse(await fs.readFile(path.join(owners,nonce,'recovery.json'),'utf8'));}catch{}
   if(!uiPids.has(a?.hostPid)||a.executableSha256!==sha(wrapper)||b?.nonce!==a.nonce||b?.guardianPid!==a.guardianPid)continue;
   if(p?.outcome!=='active-owner-scope-joined'){if(!absent(b.nativePid,true))try{process.kill(-b.nativePid,'SIGKILL');}catch{}if(!absent(a.guardianPid))try{process.kill(a.guardianPid,'SIGTERM');}catch{}}
   while(performance.now()<failureDeadline&&(!absent(b.nativePid,true)||!absent(a.guardianPid)))await new Promise(resolve=>setTimeout(resolve,20));
   failureCleanup.push({nonce,nativePid:b.nativePid,guardianPid:a.guardianPid,status:absent(b.nativePid,true)&&absent(a.guardianPid)?'ABSENT_AFTER_FAILED_TEST':'UNKNOWN',joined:p?.outcome==='active-owner-scope-joined'});
  }}
  for(const pid of uiPids){while(performance.now()<failureDeadline&&!absent(pid))await new Promise(resolve=>setTimeout(resolve,20));if(!absent(pid))try{process.kill(pid,'SIGKILL');}catch{}if(problem)failureCleanup.push({hostPid:pid,status:absent(pid)?'HOST_ABSENT':'UNKNOWN'});}
  await fs.writeFile(path.join(root,'observation.json'),JSON.stringify({scope:'Copied source/SDK with harmless native substitution; NOT installed or entitlement qualification',source,candidate,bindings,links,protocolSha:sha(protocolBytes),driverSha:sha(await fs.readFile(fileURLToPath(import.meta.url))),ptySha:sha(await fs.readFile(path.join(source,'tests/cli/managed-ui-pty.py'))),nativeOriginal,substitute:sha(wrapper),invocations,uiPids:[...uiPids],journals,failureCleanup,receipt,failure:problem?String(problem):null},null,2),{mode:0o600});
 }
});
