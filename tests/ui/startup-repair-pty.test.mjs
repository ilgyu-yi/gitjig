import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

test('actual terminal cancels JSON editing, rejects duplicate keys, saves next-launch metadata and clears without execution',{timeout:20000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-startup-json-ui-'))),home=path.join(root,'app');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained startup JSON terminal: '+root);});
    const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',SHELL:'/bin/sh',NODE_OPTIONS:'',NODE_PATH:''};
    const empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const run=async(label,steps)=>{
        const file=path.join(root,label+'.json');
        await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:6,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
        try {const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);}
        catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-7000));throw error;}
    };
    const runtime={dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',image:'sha256:'+'0'.repeat(64)};
    await run('save',[
        {wait:'Model: not selected',send:'/setup save\x1b\r'},
        {wait:'Future startup · version1 JSON',send:'\x1b'},
        {wait:'INPUT',assertDraft:'/setup save',send:'\x15/setup save {"version":1,"version":1}\x1b\r'},
        {wait:'Enter valid unambiguous startup JSON',queries:empty,send:'\x15/setup save '+JSON.stringify({version:1,runtime})+'\x1b\r'},
        {wait:'Future startup saved',queries:empty,send:'/quit\x1b\r'},
    ]);
    const file=path.join(home,'config/startup.json');assert.deepEqual(JSON.parse(await fs.readFile(file)),{version:1,runtime});
    await run('clear',[
        {wait:'Model: not selected',send:'/setup inspect\x1b\r'},
        {wait:'Sources · {"runtime":"saved","bridge":"none"}',queries:empty,send:'\x1b'},
        {wait:'INPUT',send:'/setup clear\x1b\r'},
        {wait:'Future startup cleared',queries:empty,send:'/quit\x1b\r'},
    ]);
    assert.deepEqual(JSON.parse(await fs.readFile(file)),{version:1});passed=true;
});

test('running public UI repairs a vanished runtime executable with ordinary fields and preserves limits without restart',{timeout:20000},async t=>{
 const {temporaryDirectory}=await import('../helpers/temporary-directory.mjs'),{openController}=await import('../../dist/controller/index.js'),{ApplicationStartup}=await import('../../dist/app/startup.js');
 const root=await temporaryDirectory('runtime-field-repair-terminal'),home=path.join(root,'app'),binary=path.join(root,'old-docker'),trigger=path.join(root,'remove-owned-binary'),guard=path.join(root,'guard.mjs'),file=path.join(root,'pty.json');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained runtime repair terminal '+root);});
 await fs.writeFile(binary,'#!/bin/sh\nexit 99\n',{mode:0o700});const runtime={dockerBinary:binary,dockerContext:'owned-old-route',image:'sha256:'+'0'.repeat(64),memoryMiB:1536,cpus:0.5};
 const c=await openController({installationHome:home}),startup=ApplicationStartup.open(c);await startup.save({version:1,runtime});const {conversationId:cid}=c.createConversation();c.setConversationView({selectedId:cid});c.setDraft({conversationId:cid,expectedRevision:0,text:'Keep runtime repair 한국어 draft'});await c.close();
 await fs.writeFile(guard,`import ${JSON.stringify(new URL('./readiness-no-execution.mjs',import.meta.url).href)};import fs from 'node:fs/promises';let running=false;const timer=setInterval(async()=>{if(running)return;running=true;try{if(await fs.access(${JSON.stringify(trigger)}).then(()=>true,()=>false)){clearInterval(timer);await fs.unlink(${JSON.stringify(binary)});console.log('OWNED_RUNTIME_PREREQUISITE_REMOVED');}}finally{running=false;}},10);timer.unref();`,{mode:0o600});
 const empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const steps=[
  {wait:'Model: not selected',releaseFile:trigger,send:''},
  {wait:'OWNED_RUNTIME_PREREQUISITE_REMOVED',assertDraft:'Keep runtime repair 한국어 draft',send:'\x15/setup runtime\x1b\r'},
  {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\x15/usr/bin/false\r'},
  {wait:'Docker context',send:'\x15owned-new-route\r'},
  {wait:'Runtime image',send:'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
  {wait:'Review runtime setup before applying',queries:empty,send:'\x1b'},
  {wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},
  {wait:'Runtime saved and applied',queries:empty,send:'/setup inspect\x1b\r'},
  {wait:'owned-new-route',queries:empty,send:'\x1b'},
  {wait:'INPUT',send:'/quit\x1b\r'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,'dist/cli/entry.js'],env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',SHELL:'/bin/sh',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',noForceKill:true,gracefulShutdownSeconds:3}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(result.alternateEntered,true);assert.equal(result.alternateExited,true);
 const progress=JSON.parse(await fs.readFile(file+'.terminal.progress.json'));assert.equal(progress.forceKilled,false);assert.equal(progress.error,null);assert.equal(progress.outputTruncated,false);for(const pid of [progress.childPid,-progress.childPid])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 const saved=JSON.parse(await fs.readFile(path.join(home,'config/startup.json')));assert.deepEqual(saved,{version:1,runtime:{...runtime,dockerBinary:'/usr/bin/false',dockerContext:'owned-new-route'}});passed=true;
});

async function settingsRepairWorld(t,locale='en',dual=false) {
 const {temporaryDirectory}=await import('../helpers/temporary-directory.mjs'),{openController}=await import('../../dist/controller/index.js'),{ApplicationStartup}=await import('../../dist/app/startup.js');
 const root=await temporaryDirectory('settings-repair-terminal'),home=path.join(root,'app'),binary=path.join(root,'old-docker'),guard=path.join(root,'no-execution.mjs');let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained settings repair '+root);});
 await fs.writeFile(binary,'#!/bin/sh\nexit 99\n',{mode:0o700});const runtime={dockerBinary:binary,dockerContext:'retained-route',image:'sha256:'+'0'.repeat(64),memoryMiB:1536,cpus:0.5};
 let bridge,newBridge;
 if(dual){
  const {createHash}=await import('node:crypto');for(const name of ['docker-config','bridge-host','bridge-agent','bridge-agent/home','bridge-account'])await fs.mkdir(path.join(root,name),{mode:0o700});
  runtime.dockerConfigDirectory=path.join(root,'docker-config');const oldNative=path.join(root,'old-native'),replacement=path.join(root,'new-native');await fs.writeFile(oldNative,'#!/bin/sh\nexit 99\n',{mode:0o700});await fs.writeFile(replacement,'#!/bin/sh\nexit 17\n',{mode:0o700});
  await fs.writeFile(path.join(root,'bridge-agent/claude-bridge.json'),'{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}',{mode:0o600});
  const sha=file=>fs.readFile(file).then(bytes=>createHash('sha256').update(bytes).digest('hex'));
  bridge={profile:{kind:'installed-claude-bridge',cwd:path.join(root,'bridge-host'),agentDir:path.join(root,'bridge-agent'),executable:{file:oldNative,sha256:await sha(oldNative)}},nativeAccountDirectory:path.join(root,'bridge-account')};
  newBridge={...bridge,profile:{...bridge.profile,executable:{file:replacement,sha256:await sha(replacement)}}};
 }
 const c=await openController({installationHome:home});let cid;
 try{await ApplicationStartup.open(c).save({version:1,runtime,...(bridge?{bridge}: {})});cid=c.createConversation().conversationId;c.setConversationView({selectedId:cid});c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});c.setDraft({conversationId:cid,expectedRevision:0,text:'Retained setup-only 한국어 draft'});}finally{await c.close();}
 if(dual!=='live'){await fs.rm(binary);if(bridge)await fs.rm(bridge.profile.executable.file);}const file=path.join(home,'config/startup.json'),before=await fs.readFile(file);
 await fs.writeFile(guard,`import ${JSON.stringify(new URL('./readiness-no-execution.mjs',import.meta.url).href)};import {Controller} from ${JSON.stringify(new URL('../../dist/controller/index.js',import.meta.url).href)};const fail=()=>{process.exitCode=1;throw Error('SETTINGS_ONLY_EXECUTION_FORBIDDEN');};Controller.prototype.applyRuntimeProfile=fail;Controller.prototype.createConversation=fail;Controller.prototype.runConversation=fail;`,{mode:0o600});
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',SHELL:'/bin/sh',NODE_OPTIONS:'',NODE_PATH:''};
 const empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const run=async(label,steps,args=['setup','edit'],{expectedExit=0,alternate=true}={})=>{
  const config=path.join(root,label+'.json');await fs.writeFile(config,JSON.stringify({command:[process.execPath,'--import',guard,'dist/cli/entry.js',...args],env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:config+'.terminal',noForceKill:true,gracefulShutdownSeconds:3}));
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',config],{timeout:15000,maxBuffer:2**20})).stdout);
  assert.equal(result.exitCode,expectedExit);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(result.alternateEntered,alternate);assert.equal(result.alternateExited,alternate);
  const progress=JSON.parse(await fs.readFile(config+'.terminal.progress.json'));assert.equal(progress.forceKilled,false);assert.equal(progress.error,null);assert.equal(progress.outputTruncated,false);for(const pid of [progress.childPid,-progress.childPid])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});return {result,output:await fs.readFile(config+'.terminal','utf8')};
 };
 return {root,home,file,before,runtime,bridge,newBridge,env,guard,empty,run,pass(){passed=true;}};
}
for(const locale of ['en','ko'])test('public '+locale+' setup repair reaches vanished-runtime fields while normal startup refuses, then permits a normal relaunch',{timeout:25000},async t=>{
 const f=await settingsRepairWorld(t,locale),ko=locale==='ko';
 const refused=await f.run('startup-refusal',[],['conversation','ui'],{expectedExit:2,alternate:false});assert.ok(refused.output.includes('gitjig setup edit'));assert.ok(refused.output.includes('old-docker'));assert.deepEqual(await fs.readFile(f.file),f.before);
 const proof=await f.run('saved-only',[
  {wait:ko?'시작 설정 · 복구 전용':'Startup settings · repair only',queries:f.empty,send:(ko?'실행 환경 설정 편집':'Edit runtime settings')+'\r'},
  {wait:ko?'실행 환경 설정 · 편집 중인 값':'Runtime setup · staged',send:(ko?'실행 환경 항목 편집':'Edit runtime fields')+'\r'},
  {wait:ko?'Docker 실행 파일':'Docker executable',send:'\x15/usr/bin/false\r'},
  {wait:ko?'Docker 컨텍스트':'Docker context',send:'\r'},
  {wait:ko?'실행 이미지':'Runtime image',send:'\r'},
  {wait:ko?'Docker 설정 폴더':'Docker configuration directory',send:'\r'},
  {wait:ko?'실행 환경 설정 · 편집 중인 값':'Runtime setup · staged',send:(ko?'실행 환경 검토 후 저장':'Review and save runtime')+'\r'},
  {wait:ko?'다음 실행의 환경 설정 검토':'Review runtime setup for next launch',queries:f.empty,send:'\x1b'},
  {wait:ko?'다음 실행의 환경 저장 동작 선택':'Save runtime settings for next launch',send:(ko?'다음 실행에 사용할 환경 저장':'Save runtime for next launch')+'\r'},
  {wait:ko?'다음 실행의 환경을 저장했습니다':'Runtime saved for next launch',queries:f.empty,send:(ko?'설정 닫기':'Close settings')+'\r'},
 ]);
 assert.ok(!proof.output.includes(ko?'환경을 저장하고 적용했습니다':'Runtime saved and applied'));
 assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1,runtime:{...f.runtime,dockerBinary:'/usr/bin/false'}});
 await f.run('normal-relaunch',[{wait:ko?'입력 · 대화 대기':'Model: not selected',assertDraft:'Retained setup-only 한국어 draft',queries:f.empty,send:'\x15/quit\x1b\r'}],['conversation','ui']);f.pass();
});
for(const phase of ['picker','input'])test('public setup repair joins '+phase+' cancellation without writing saved setup',{timeout:15000},async t=>{
 const f=await settingsRepairWorld(t),steps=[{wait:'Startup settings · repair only',send:'Edit runtime settings\r'}];
 if(phase==='input')steps.push({wait:'Runtime setup · staged',send:'Edit runtime fields\r'},{wait:'Docker executable',terminate:true,send:''});
 else steps.push({wait:'Runtime setup · staged',terminate:true,send:''});
 await f.run('cancel-'+phase,steps);assert.deepEqual(await fs.readFile(f.file),f.before);f.pass();
});
test('noninteractive setup edit rejects before creating an application home or accepting execution options',async t=>{
 const {temporaryDirectory}=await import('../helpers/temporary-directory.mjs');const root=await temporaryDirectory('setup-edit-nontty');t.after(()=>fs.rm(root,{recursive:true,force:true}));const home=path.join(root,'must-not-create'),env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,GITJIG_HOME:home,TMPDIR:root,NODE_OPTIONS:'',NODE_PATH:''};
 for(const extra of [[],['--image','sha256:'+'0'.repeat(64)]])await assert.rejects(execute(process.execPath,['dist/cli/entry.js','setup','edit',...extra],{env,timeout:5000}),error=>{assert.equal(error.code,2);return true;});await assert.rejects(fs.access(home),{code:'ENOENT'});
});

test('setup repair keeps the existing application owner and never opens a second settings session',{timeout:15000},async t=>{
 const f=await settingsRepairWorld(t),{openController}=await import('../../dist/controller/index.js'),owner=await openController({installationHome:f.home});
 try{const refused=await f.run('active-owner',[],['setup','edit'],{expectedExit:2,alternate:false});assert.match(refused.output,/owned|owner|active/iu);assert.deepEqual(await fs.readFile(f.file),f.before);}finally{await owner.close();}f.pass();
});
test('setup repair signal joins a held final validation without saving or applying runtime',{timeout:18000},async t=>{
 const f=await settingsRepairWorld(t),entered=path.join(f.root,'final-validation-held');
 await fs.appendFile(f.guard,`\nimport fs from 'node:fs/promises';const original=fs.realpath.bind(fs);let calls=0,released=false;process.once('SIGTERM',()=>{released=true;});fs.realpath=async file=>{if(file==='/usr/bin/false'&&++calls===2){await fs.writeFile(${JSON.stringify(entered)},'held');while(!released)await new Promise(resolve=>setTimeout(resolve,5));}return original(file);};\n`);
 await f.run('held-final-validation',[
  {wait:'Startup settings · repair only',send:'Edit runtime settings\r'},
  {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\x15/usr/bin/false\r'},
  {wait:'Docker context',send:'\r'},
  {wait:'Runtime image',send:'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
  {wait:'Review runtime setup for next launch',send:'\x1b'},
  {wait:'Save runtime settings for next launch',send:'Save runtime for next launch\r'},
  {wait:'Checking settings · please wait',waitFiles:[{path:entered,value:'held'}],terminate:true,send:''},
 ]);assert.deepEqual(await fs.readFile(f.file),f.before);f.pass();
});

function combinedRepairSteps(f,locale='en') {
 const ko=locale==='ko',original=[{path:f.file,value:f.before.toString()}];
 return [
  {wait:ko?'시작 설정 · 복구 전용':'Startup settings · repair only',send:(ko?'실행 환경과 Claude 연결 함께 복구':'Repair runtime and Claude together')+'\r'},
  {wait:ko?'시작 설정 함께 복구 · 아직 저장하지 않음':'Combined startup repair · changes not saved',send:(ko?'실행 환경 설정 편집':'Edit runtime settings')+'\r'},
  {wait:ko?'실행 환경 설정 · 편집 중인 값':'Runtime setup · staged',send:(ko?'실행 환경 항목 편집':'Edit runtime fields')+'\r'},
  {wait:ko?'Docker 실행 파일':'Docker executable',send:'\x15/usr/bin/false\r'},
  {wait:ko?'Docker 컨텍스트':'Docker context',send:'\r'},
  {wait:ko?'실행 이미지':'Runtime image',send:'\r'},
  {wait:ko?'Docker 설정 폴더':'Docker configuration directory',send:'\r'},
  {wait:ko?'실행 환경 설정 · 편집 중인 값':'Runtime setup · staged',send:(ko?'함께 검토할 실행 환경 변경 확인':'Review runtime changes for combined review')+'\r'},
  {wait:ko?'실행 환경 변경안 검토 · 아직 저장하지 않음':'Review runtime draft · nothing saved',send:'\x1b'},
  {wait:ko?'실행 환경 변경안을 함께 편집 중인 설정에 반영할까요?':'Keep runtime changes in the combined draft?',send:(ko?'실행 환경 변경안을 전체 검토에 반영':'Keep runtime changes for combined review')+'\r'},
  {wait:ko?'시작 설정 함께 복구 · 아직 저장하지 않음':'Combined startup repair · changes not saved',waitFiles:original,queries:f.empty,send:(ko?'Claude 연결 설정 편집':'Edit Claude bridge settings')+'\r'},
  {wait:'Bridge prerequisites',send:'\x1b'},
  {wait:ko?'Claude 연결 변경안 · 아직 저장하지 않음':'Claude bridge draft · nothing saved',send:'Edit bridge paths and executable pin\r'},
  {wait:'Bridge host directory',send:'\r'},
  {wait:'Bridge agent directory',send:'\r'},
  {wait:'Native Claude Code account directory',send:'\r'},
  {wait:'Pinned Claude executable',send:'\x15'+f.newBridge.profile.executable.file+'\r'},
  {wait:'Executable SHA256',send:'\x15'+f.newBridge.profile.executable.sha256+'\r'},
  {wait:ko?'Claude 연결 변경안 · 아직 저장하지 않음':'Claude bridge draft · nothing saved',send:(ko?'함께 검토할 Claude 연결 변경 확인':'Review bridge changes for combined review')+'\r'},
  {wait:ko?'Claude 연결 변경안 검토 · 아직 저장하지 않음':'Review Claude bridge draft · nothing saved',send:'\x1b'},
  {wait:ko?'Claude 연결 변경안을 함께 편집 중인 설정에 반영할까요?':'Keep this Claude bridge change in the combined draft?',send:(ko?'Claude 연결 변경안을 전체 검토에 반영':'Keep bridge changes for combined review')+'\r'},
  {wait:ko?'시작 설정 함께 복구 · 아직 저장하지 않음':'Combined startup repair · changes not saved',waitFiles:original,queries:f.empty,send:(ko?'전체 변경 검토 후 저장':'Review and save all changes')+'\r'},
  {wait:ko?'전체 시작 설정 검토':'Review all startup settings',send:'\x1b[6~'.repeat(20)},
  {wait:f.newBridge.profile.executable.sha256,waitFiles:original,queries:f.empty,send:'\x1b'},
  {wait:ko?'검토한 전체 시작 설정을 저장할까요?':'Save all reviewed startup settings?',send:(ko?'다음 실행의 전체 설정 저장':'Save all settings for next launch')+'\r'},
  {wait:ko?'검토한 전체 설정을 저장했습니다':'All reviewed settings saved for next launch',send:(ko?'설정 닫기':'Close settings')+'\r'},
 ];
}
for(const locale of ['en','ko'])test('public '+locale+' combined repair fixes both unavailable paths without JSON or reset and preserves retained entry',{timeout:22000},async t=>{
 const f=await settingsRepairWorld(t,locale,true),ko=locale==='ko';
 const refused=await f.run('both-startup-refusal',[],['conversation','ui'],{expectedExit:2,alternate:false});assert.ok(refused.output.includes('gitjig setup edit'));
 await f.run('combined-repair',combinedRepairSteps(f,locale));assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1,runtime:{...f.runtime,dockerBinary:'/usr/bin/false'},bridge:f.newBridge});
 await f.run('combined-normal-relaunch',[{wait:ko?'입력 · 대화 대기':'Model: not selected',assertDraft:'Retained setup-only 한국어 draft',queries:f.empty,send:'\x15/quit\x1b\r'}],['conversation','ui']);f.pass();
});
test('public combined repair discard after staging runtime keeps the exact broken original settings',{timeout:15000},async t=>{
 const f=await settingsRepairWorld(t,'en',true);await f.run('combined-discard',[...combinedRepairSteps(f).slice(0,10),
  {wait:'Combined startup repair · changes not saved',waitFiles:[{path:f.file,value:f.before.toString()}],send:'Leave combined repair\r'},
  {wait:'Leave without saving combined changes?',send:'Discard staged changes\r'},
  {wait:'Combined draft discarded',send:'Close settings\r'},
 ]);assert.deepEqual(await fs.readFile(f.file),f.before);f.pass();
});
test('public combined repair joins a signal during bridge input after another component was staged',{timeout:15000},async t=>{
 const f=await settingsRepairWorld(t,'en',true),steps=combinedRepairSteps(f).slice(0,14);steps.at(-1).terminate=true;steps.at(-1).send='';await f.run('combined-input-signal',steps);assert.deepEqual(await fs.readFile(f.file),f.before);f.pass();
});
test('public combined repair joins held complete-save validation without committing either component',{timeout:18000},async t=>{
 const f=await settingsRepairWorld(t,'en',true),entered=path.join(f.root,'combined-final-validation-held');
 await fs.appendFile(f.guard,`\nimport fs from 'node:fs/promises';const original=fs.realpath.bind(fs);let calls=0,released=false;process.once('SIGTERM',()=>{released=true;});fs.realpath=async file=>{if(file==='/usr/bin/false'&&++calls===4){await fs.writeFile(${JSON.stringify(entered)},'held');while(!released)await new Promise(resolve=>setTimeout(resolve,5));}return original(file);};\n`);
 const steps=combinedRepairSteps(f),end=steps.findIndex(step=>step.wait==='Save all reviewed startup settings?');await f.run('combined-final-signal',[...steps.slice(0,end+1),{wait:'Checking settings · please wait',waitFiles:[{path:entered,value:'held'}],terminate:true,send:''}]);assert.deepEqual(await fs.readFile(f.file),f.before);f.pass();
});

test('already-open public UI repairs both vanished paths through setup combined without leaving the app first',{timeout:18000},async t=>{
 const f=await settingsRepairWorld(t,'en','live'),trigger=path.join(f.root,'remove-both-live');
 await fs.appendFile(f.guard,`\nimport fs from 'node:fs/promises';let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{if(await fs.access(${JSON.stringify(trigger)}).then(()=>true,()=>false)){clearInterval(timer);await fs.rm(${JSON.stringify(f.runtime.dockerBinary)});await fs.rm(${JSON.stringify(f.bridge.profile.executable.file)});console.log('OWNED_BOTH_SETTINGS_PREREQUISITES_REMOVED');}}finally{busy=false;}},10);timer.unref();\n`);
 const steps=combinedRepairSteps(f).slice(1,-1);await f.run('in-app-combined',[
  {wait:'Model: not selected',releaseFile:trigger,send:''},
  {wait:'OWNED_BOTH_SETTINGS_PREREQUISITES_REMOVED',send:'\x15/setup combined\x1b\r'},
  ...steps,
  {wait:'All reviewed settings saved for next launch',queries:f.empty,send:'/setup inspect\x1b\r'},
  {wait:'Startup · restart required',queries:f.empty,send:'\x1b'},
  {wait:'INPUT',send:'/quit\x1b\r'},
 ],['conversation','ui']);assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1,runtime:{...f.runtime,dockerBinary:'/usr/bin/false'},bridge:f.newBridge});f.pass();
});
