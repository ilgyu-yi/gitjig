import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {offlineSourceInstallation,inventory,checkout,digest} from './offline-source-fixture.mjs';
import {withValueCases} from '../controller/effect-fixture.mjs';

test('current public offline install completes representative EN and ordinary KO normal procedures and owner terminal saves',{timeout:360000},async t=>{
 assert.ok(process.env.GITJIG_DOCKER_BINARY&&process.env.GITJIG_DOCKER_CONTEXT&&process.env.GITJIG_DOCKER_CONFIG_DIRECTORY&&process.env.GITJIG_RUNTIME_IMAGE,'Explicit prepared Docker profile required before installation');
 const fixture=await offlineSourceInstallation(t,'source-save');
 const {root,payload,command,env,run,assertCurrent,payloadBefore}=fixture,control=path.join(root,'control');
 await fs.mkdir(control,{mode:0o700});
 const names=['tests/controller/effect-fixture.mjs','tests/workflow/current-verification-fixture.mjs',
  'tests/controller/source-snapshot-terminal-case.mjs','tests/controller/source-save-terminal-observer.mjs',
  'tests/cli/fork-ui-pty.py','tests/ui/source-save-no-provider.mjs','tests/cli/guarded-process-method.mjs'];
 const files=[];
 for(const name of names){const target=path.join(control,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(checkout,name),target);assert.equal(digest(await fs.readFile(target)),digest(await fs.readFile(path.join(checkout,name))));files.push({path:target,sha256:digest(await fs.readFile(target)),ui:['tests/ui/source-save-no-provider.mjs','tests/cli/guarded-process-method.mjs'].includes(name)});}
 for(const [name,to]of [['source-save-driver.mjs','driver.mjs'],['source-save-guard.mjs','guard.mjs']]){const target=path.join(control,to);await fs.copyFile(new URL(name,import.meta.url),target);files.push({path:target,sha256:digest(await fs.readFile(target)),ui:to==='guard.mjs'});}
 const terminal=path.join(control,'tests/controller/source-snapshot-terminal-case.mjs'),observer=path.join(control,'tests/controller/source-save-terminal-observer.mjs');
 const manifest={files,provider:path.join(control,'tests/controller/effect-fixture.mjs'),python:path.join(control,'tests/cli/fork-ui-pty.py'),imports:[
  {parent:terminal,specifier:'../../dist/controller/index.js',target:path.join(payload,'dist/controller/index.js')},
  {parent:terminal,specifier:'../../dist/ui/i18n.js',target:path.join(payload,'dist/ui/i18n.js')},
  {parent:observer,specifier:'../../dist/controller/source-snapshot-records.js',target:path.join(payload,'dist/controller/source-snapshot-records.js')},
 ]};
 const manifestFile=path.join(root,'control-manifest.json'),trace=path.join(root,'installed-imports.jsonl');await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2),{mode:0o600});
 const guard=path.join(control,'guard.mjs'),driver=path.join(control,'driver.mjs');
 const guardOptions='--import='+pathToFileURL(guard).href,uiOptions=guardOptions+' --import='+pathToFileURL(path.join(control,'tests/ui/source-save-no-provider.mjs')).href;
 const runtime={dockerBinary:await fs.realpath(process.env.GITJIG_DOCKER_BINARY),dockerContext:process.env.GITJIG_DOCKER_CONTEXT,dockerConfigDirectory:await fs.realpath(process.env.GITJIG_DOCKER_CONFIG_DIRECTORY),image:process.env.GITJIG_RUNTIME_IMAGE};
 assert.ok(runtime.dockerContext);assert.match(runtime.image,/^sha256:[a-f0-9]{64}$/u);
 const git=await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY??'/opt/homebrew/bin/git'),results=[];
 const guarded={...env,NODE_OPTIONS:guardOptions,GITJIG_INSTALLED_SOURCE_PAYLOAD:payload,GITJIG_INSTALLED_SOURCE_MANIFEST:manifestFile,GITJIG_INSTALLED_SOURCE_TRACE:trace,
  GITJIG_SAVE_FIXTURE_PACKAGE_ROOT:payload,GITJIG_SAVE_FIXTURE_CONTROL_ROOT:control,GITJIG_SAVE_FIXTURE_INSTALLED_COMMAND:command,GITJIG_SAVE_FIXTURE_UI_NODE_OPTIONS:uiOptions};
 for(const locale of ['en','ko']){
  const directory=path.join(root,'case-'+locale),source=path.join(directory,'source'),operator=path.join(directory,'operator'),home=path.join(directory,'application');
  for(const dir of [directory,source,operator])await fs.mkdir(dir,{mode:0o700});
  const expected=new Map(),blob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  const track=(name,bytes)=>expected.set(name,{path:name,mode:'100644',type:'blob',oid:blob(bytes),size:bytes.length});
  await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');track('consumer.cjs',Buffer.from('module.exports=3;\n'));
  await fs.writeFile(path.join(source,'check.cjs'),withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
  await fs.writeFile(path.join(source,'private.env'),'UNCHANGED PRIVATE CONTEXT\n');
  track('check.cjs',await fs.readFile(path.join(source,'check.cjs')));
  const representativeFiles=locale==='en'?1000:0;
  for(let i=0;i<representativeFiles;i++){const name='representative/dir-'+String(i%10).padStart(2,'0')+'/file-'+String(i).padStart(4,'0')+'.txt',bytes=Buffer.alloc(1024,0x78);bytes.write('fixture '+i+'\n');bytes[1023]=10;await fs.mkdir(path.dirname(path.join(source,name)),{recursive:true,mode:0o700});await fs.writeFile(path.join(source,name),bytes);track(name,bytes);}
  const setupEnv={...env,HOME:operator,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Owned fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Owned fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const native=(args,label)=>run(git,['-c','gc.auto=0','-c','maintenance.auto=false',...args],locale+'-'+label,{environment:setupEnv,workdir:source});
  await native(['init','--template=','--initial-branch=main'],'init');assert.equal((await native(['rev-parse','--show-object-format'],'format')).trim(),'sha1');await native(['add','check.cjs',...representativeFiles?['representative']:[]],'add');await native(['-c','commit.gpgsign=false','commit','-m','Original immutable basis'],'commit');
  const original={head:await native(['rev-parse','HEAD'],'head'),index:(await fs.readFile(path.join(source,'.git/index'))).toString('base64'),sourceBytes:(await fs.readFile(path.join(source,'consumer.cjs'))).toString('base64'),status:await native(['--no-optional-locks','status','--porcelain=v1'],'status')};
  await fs.writeFile(path.join(directory,'expected-publication-before.json'),JSON.stringify([...expected.values()],null,2),{mode:0o600});
  const config=path.join(directory,'case.json');await fs.writeFile(config,JSON.stringify({root:directory,source,home,operator,git,runtime,locale,representativeFiles,original}),{mode:0o600});
  const out=await run(process.execPath,[driver],'driver-'+locale,{timeout:125000,environment:{...guarded,GITJIG_INSTALLED_SOURCE_MODE:'seed',GITJIG_INSTALLED_SOURCE_CASE:config}});
  const result=JSON.parse(out.trim().split('\n').at(-1));assert.equal(result.locale,locale);assert.equal(result.root,directory);
  const terminalResult=JSON.parse(await fs.readFile(result.receipt,'utf8'));
  const tree=(await native(['ls-tree','-rz','--full-tree','refs/heads/terminal-'+locale],'saved-tree')).split('\0').filter(Boolean).map(row=>{const [header,name]=row.split('\t'),[mode,type,oid]=header.split(' ');return{path:name,mode,type,oid};}).sort((a,b)=>a.path.localeCompare(b.path));
  const expectedTree=[...expected.values()].map(({size,...row})=>row).sort((a,b)=>a.path.localeCompare(b.path));assert.deepEqual(tree,expectedTree);
  const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});let version;try{version=db.prepare('SELECT artifact,hash FROM change_versions WHERE id=?').get(terminalResult.original.binding.proposalId);}finally{db.close();}
  const artifact=await fs.readFile(version.artifact);assert.equal(digest(artifact),version.hash);const body=JSON.parse(artifact);
  assert.deepEqual(body.projection.projectedEntries.map(row=>({path:row.path,mode:row.mode,oid:row.objectId,size:row.size})).sort((a,b)=>a.path.localeCompare(b.path)),[...expected.values()].map(({type,...row})=>row).sort((a,b)=>a.path.localeCompare(b.path)));
  assert.deepEqual(body.projection.wholeFileAdditions.map(row=>row.path),['consumer.cjs']);assert.equal(tree.length,representativeFiles+2);assert.ok(!tree.some(row=>row.path==='private.env'||row.path==='.git'||row.path.startsWith('.git/')));
  assert.ok(terminalResult.timings.nativeHelperCalls<200,'Native preparation/owner dispatch must remain batched for this fixed repository shape');
  for(const key of ['spoolPeakBytes','elapsedMs','sampledPeakRssBytes'])assert.ok(Number.isFinite(body.projection.metrics[key])&&body.projection.metrics[key]>=0,'Finite original projection metric '+key);
  assert.ok(body.projection.metrics.sampledPeakRssBytes>0);
  const exits=terminalResult.events.filter(e=>e.kind==='exit');assert.equal(exits.length,1);
  for(const key of ['maxRSS','userCPUTime','systemCPUTime'])assert.ok(Number.isFinite(exits[0].resourceUsage[key])&&exits[0].resourceUsage[key]>=0,'Finite own-UI resource observation '+key);assert.ok(exits[0].resourceUsage.maxRSS>0);
  const scale={locale,representativeFiles,publishedPaths:tree.length,timings:terminalResult.timings,projectionMetrics:body.projection.metrics,uiResourceObservations:terminalResult.events.filter(e=>e.kind==='exit'),scope:'Exact1002-path unique-small-file representative on EN; ordinaryKO. No universal SLA or process-tree memory assertion.'};
  await fs.writeFile(path.join(directory,'representative-preparation.json'),JSON.stringify({scale,expectedTree,actualTree:tree},null,2));results.push({...result,scale});
 }
 for(const [label,code]of [
  ['checkout',`await import(${JSON.stringify(pathToFileURL(path.join(checkout,'src/app/runtime-requirements.js')).href)})`],
  ['provider-fixture',`await import(${JSON.stringify(pathToFileURL(manifest.provider).href)})`],
  ['process',"(await import('node:child_process')).spawn('/usr/bin/true',[])"],
  ['promisified-process',"await(await import('node:util')).promisify((await import('node:child_process')).execFile)('/usr/bin/true',[])"],
  ['network',"await fetch('https://example.invalid/')"],
 ])await run(process.execPath,['--input-type=module','-e',code],'deny-'+label,{expected:1,environment:{...guarded,GITJIG_INSTALLED_SOURCE_MODE:'ui'}});
 const events=(await fs.readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const seed=events.filter(e=>e.mode==='seed'),ui=events.filter(e=>e.mode==='ui');
 assert.ok(seed.some(e=>e.kind==='module'&&e.file===path.join(payload,'dist/controller/change-core.js')));
 assert.ok(seed.some(e=>e.kind==='module'&&e.file.startsWith(path.join(payload,'node_modules/@earendil-works/pi-ai/'))));
 assert.ok(seed.some(e=>e.kind==='capture-worker'&&e.file===path.join(payload,'dist/controller/capture-worker.js')));assert.ok(seed.some(e=>e.kind==='engine'));
 assert.equal(seed.filter(e=>e.kind==='fixture-oracle').length,6);
 assert.ok(ui.some(e=>e.kind==='module'&&e.file===path.join(payload,'dist/ui/source-save-commands.js')));assert.ok(ui.some(e=>e.kind==='native'));
 const successfulUiPids=new Set(events.filter(e=>e.mode==='ui'&&e.kind==='native').map(e=>e.pid));assert.equal(successfulUiPids.size,2);
 for(const pid of successfulUiPids){const rows=events.filter(e=>e.pid===pid);assert.ok(!rows.some(e=>e.kind==='denied'||e.kind==='engine'||e.kind==='capture-worker'||e.kind==='fixture-oracle'));assert.ok(rows.some(e=>e.kind==='exit'&&e.denied===0));}
 assert.equal(events.filter(e=>e.kind==='denied').length,5);assert.ok(!seed.some(e=>e.kind==='denied'));
 for(const row of files)assert.equal(digest(await fs.readFile(row.path)),row.sha256);await assertCurrent();assert.deepEqual(await inventory(payload),payloadBefore);
 const receipt={scope:'Current public offline installed normal Controller/SDK/Docker then representative1002-path EN and ordinaryKO prefix CLI result-to-save/reopen; scripted provider judgments, no universal performance, paid-model reliability or installed fault/crash claim',root,payload,command,results,manifest,events:events.length,sourceInputsSha256:digest(await fs.readFile(path.join(root,'source-inputs.json'))),payloadInventorySha256:digest(JSON.stringify(payloadBefore)),invocations:fixture.invocations.map(({out,err,...rest})=>rest)};
 const file=path.join(root,'qualification.json');await fs.writeFile(file,JSON.stringify(receipt,null,2),{mode:0o600});t.diagnostic(JSON.stringify({root,receipt:file,payload,command}));fixture.pass();
});
