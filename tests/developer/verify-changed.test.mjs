/** Selector/command boundary only: fake compiler + harmless Node fixtures; no actual compiler/product/SDK/auth/model/engine suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectChanged,aliasPlan,requirements,missingPrerequisites,feedbackCommands,parseGitPaths,assertCurrentBundle,feedbackBudgetMs} from '../../tools/verify-changed.mjs';
test('owner runtime preparation selects its terminal and packed consumers without requiring a physical engine',()=>{
 for(const file of ['tests/ui/contextual-recovery.test.mjs','install.sh','tests/installation/bootstrap-interactive.test.mjs','runtime/setup.mjs','src/ui/preparation-progress.ts','tests/ui/runtime-preparation-pty.test.mjs','tests/installation/installer-interactive.test.mjs','tests/installation/runtime-preparation-package.test.mjs']){
  const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('runtimePreparation'));
  assert.ok(!requirements(plan).includes('engine'));assert.equal(feedbackBudgetMs(plan),90000);
  const focused=feedbackCommands(plan).filter(c=>c.kind==='focused');
  for(const consumer of ['tests/ui/contextual-recovery.test.mjs','tests/installation/bootstrap-interactive.test.mjs','tests/ui/runtime-preparation-pty.test.mjs','tests/installation/installer-interactive.test.mjs','tests/installation/runtime-preparation-package.test.mjs'])assert.equal(focused.flatMap(c=>c.args).filter(a=>a===consumer).length,1);
 }
});
test('declared SQLite/adapter/role owners select their genuine finite consumers once',()=>{
 assert.deepEqual(selectChanged(['src/controller/store.ts']).groups,['unit']);
 const publication=selectChanged(['src/controller/publication.ts']);assert.ok(publication.groups.includes('publication')&&publication.groups.includes('platform'));assert.equal(publication.unknown,false);
 const role=selectChanged(['src/controller/selected-review-evidence.ts']);assert.ok(role.groups.includes('roleEvidence'));assert.ok(requirements(role).includes('engine'));
 const adapter=selectChanged(['src/workflow/adapter.ts']);assert.ok(adapter.groups.includes('workflowAdapter'));const adapterCommands=feedbackCommands(adapter);assert.ok(adapterCommands.some(c=>c.args.includes('tests/workflow/adapter.test.mjs')&&c.args.includes('tests/workflow/adapter-http.test.mjs')));
 for(const file of ['src/pi/native-process.ts','src/pi/native-guardian.ts','src/pi/native-owner-records.ts']){const native=selectChanged([file]);assert.ok(native.groups.includes('nativeOwner'));const command=feedbackCommands(native).find(c=>c.kind==='focused');assert.ok(command.args.includes('tests/pi/native-owner-current-sdk.test.mjs')&&command.args.includes('tests/pi/native-owner-current-death.test.mjs'));}
 for(const file of ['runtime/Dockerfile','runtime/Dockerfile.dockerignore','runtime/io-helper.mjs']){const recipe=selectChanged([file]);assert.equal(recipe.unknown,false);assert.ok(recipe.groups.includes('runtime'));assert.ok(requirements(recipe).includes('engine'));}
 const ui=selectChanged(['src/ui/native-pane.ts']);assert.ok(ui.groups.includes('ui'));const c=feedbackCommands(ui);assert.equal(c.filter(x=>x.kind==='build').length,1);assert.ok(c[1].args.includes('tests/ui/dialog-pty.test.mjs'));assert.equal(new Set(c[1].args.slice(5)).size,c[1].args.slice(5).length);
});
test('coordination changes include actual MCP regression in focused developer feedback',()=>{
 const source='src/pi/coordination.ts',regression='tests/pi/coordination-mcp-schema.test.mjs';
 for(const files of [[source],[regression],[source,regression]]){
  const plan=selectChanged(files);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('sdk'));
  const commands=feedbackCommands(plan),focused=commands.filter(c=>c.kind==='focused');assert.equal(focused.length,1);
  assert.equal(focused[0].args.filter(arg=>arg===regression).length,1,'Real MCP consumer is selected once for source or regression edits');
  assert.ok(focused[0].args.includes('tests/pi/session.test.mjs'));assert.ok(focused[0].args.includes('tests/pi/request-boundary.test.mjs'));
  assert.equal(commands.filter(c=>c.kind==='build').length,1);assert.ok(plan.groups.includes('runtime')&&plan.groups.includes('integrated'),'Existing Pi boundary requirements remain selected');
 }
});
test('unknown/shared/multiple-owner and Pi host changes require genuine fresh installed integration; missing prerequisites hold before execution',()=>{
 for(const files of [['src/new-owner/file.ts'],['package-lock.json'],['src/controller/store.ts','src/ui/native-pane.ts'],['src/pi/claude-host.ts']]){
  const p=selectChanged(files);assert.ok(p.groups.includes('integrated'));const c=feedbackCommands(p),kinds=c.map(x=>x.kind);assert.ok(kinds.indexOf('activation')<kinds.indexOf('workflow'));assert.ok(kinds.includes('integration')&&kinds.includes('claude-foundation'));assert.equal(kinds.filter(x=>x==='build').length,1);
  const missing=missingPrerequisites(p,{});assert.ok(missing.some(s=>s.includes('GITJIG_BUNDLE_RECEIPT')));assert.ok(missing.some(s=>s.includes('GITJIG_DOCKER_CONTEXT')));assert.ok(missing.some(s=>s.includes('GITJIG_RUNTIME_IMAGE')));
 }
});
test('generated output is excluded but unknown executable helpers require conservative coverage',()=>{
 const p=selectChanged(['.runtime-fixtures/task/raw.json','dist/cli/main.js','node_modules/fixture/index.js']);assert.deepEqual(p.groups,[]);assert.equal(p.excluded.length,3);assert.ok(p.excluded.every(x=>x.reason.length>30));
 const helper=selectChanged(['tools/new-consumer.mjs']);assert.equal(helper.unknown,true);assert.ok(helper.groups.includes('integrated'));
});
test('NUL Git paths preserve spaces/newlines/deletions; aliases have one build and no caller live installed receipt route',()=>{
 assert.deepEqual(parseGitPaths(Buffer.from('src/controller/store.ts\0tests/a b\nc.test.mjs\0')),['src/controller/store.ts','tests/a b\nc.test.mjs']);assert.throws(()=>parseGitPaths(Buffer.from('../escape\0')));assert.throws(()=>parseGitPaths(Buffer.from([255,0])));
 for(const name of ['unit','ui','platform','acceptance','install'])assert.equal(feedbackCommands(aliasPlan(name)).filter(x=>x.kind==='build').length,1);
 assert.throws(()=>aliasPlan('arbitrary'));assert.equal(missingPrerequisites(aliasPlan('unit'),{}).length,0);assert.ok(missingPrerequisites(aliasPlan('install'),{GITJIG_INSTALL_RECEIPT:'/a/live/home.json'}).length>0);
});

test('actual filesystem bundle guard rejects stale source/dist/package/lock/criteria before any activation',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{createHash}=await import('node:crypto');
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig139-bundle-'))),current=path.join(base,'current'),frozen=path.join(base,'frozen'),bundle=path.join(base,'bundle'),payload=path.join(bundle,'payload');
 const hash=b=>createHash('sha256').update(b).digest('hex');
 try{
  for(const root of [current,frozen,payload]){await fs.mkdir(path.join(root,'dist'),{recursive:true});await fs.mkdir(path.join(root,'docs'));await fs.mkdir(path.join(root,'runtime'));if(root!==payload){await fs.mkdir(path.join(root,'src'));await fs.writeFile(path.join(root,'src/a.ts'),'const a=1;');}}
  const files=['package.json','package-lock.json','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md','README.md','THIRD_PARTY_NOTICES.md','docs/providers.md','runtime/Dockerfile','runtime/Dockerfile.dockerignore','runtime/io-helper.mjs','LICENSE','dist/a.js'],assets=[];
  for(const file of files){for(const root of [current,frozen,payload])await fs.writeFile(path.join(root,file),'FIXED:'+file);assets.push({path:file,kind:'file',sha256:hash('FIXED:'+file)});}
  const criteria=Object.fromEntries(['MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md'].map(file=>[file,hash('FIXED:'+file)]));await fs.writeFile(path.join(bundle,'bundle.json'),JSON.stringify({payloadId:'a'.repeat(64),assets,source:{lockSha256:hash('FIXED:package-lock.json'),criteria}}));const receipt=path.join(base,'receipt.json');await fs.writeFile(receipt,JSON.stringify({destination:bundle,payloadId:'a'.repeat(64)}));assert.equal(assertCurrentBundle(current,frozen,receipt).payloadId,'a'.repeat(64));
  for(const file of ['src/a.ts','dist/a.js','package.json','package-lock.json','MISSION.md','LICENSE','THIRD_PARTY_NOTICES.md','docs/providers.md','runtime/Dockerfile','runtime/Dockerfile.dockerignore','runtime/io-helper.mjs']){const original=await fs.readFile(path.join(current,file));await fs.writeFile(path.join(current,file),'CHANGED');assert.throws(()=>assertCurrentBundle(current,frozen,receipt),/STALE_OR_UNBOUND_BUNDLE/);await fs.writeFile(path.join(current,file),original);}
  await fs.writeFile(path.join(current,'CONTRIBUTING.md'),'CONTRIBUTOR_ONLY_CHANGE');assert.equal(assertCurrentBundle(current,frozen,receipt).payloadId,'a'.repeat(64),'Nonshipped contributor instructions are not payload inputs');
  await fs.writeFile(path.join(payload,'dist/a.js'),'CORRUPTED');assert.throws(()=>assertCurrentBundle(current,frozen,receipt),/STALE_OR_UNBOUND_BUNDLE/);
 }finally{await fs.rm(base,{recursive:true,force:true});}
});

test('real CLI missing integration prerequisites refuses before even a harmless build canary',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util');const execute=promisify(execFile);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig139-no-build-')),marker=path.join(root,'BUILD_RAN');
 try{await fs.mkdir(path.join(root,'tools'),{recursive:true});await fs.writeFile(path.join(root,'tools/build.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'unexpected')`);let error;
  try{await execute(process.execPath,[new URL('../../tools/verify-changed.mjs',import.meta.url).pathname,'--group','acceptance'],{cwd:root,env:{PATH:'/usr/bin:/bin'},timeout:5000});}catch(e){error=e;}
  assert.equal(error?.code,2);const observation=JSON.parse(error.stdout);assert.ok(observation.missingPrerequisites.some(x=>x.includes('GITJIG_BUNDLE_RECEIPT')));await assert.rejects(fs.stat(marker),e=>e.code==='ENOENT');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('actual unit CLI completes a fake build and harmless focused fixtures without any bundle operand',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util');const execute=promisify(execFile);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig139-unit-'))),marker=path.join(root,'observed.jsonl');
 try{
  await fs.mkdir(path.join(root,'tools'),{recursive:true});await fs.writeFile(path.join(root,'tools/build.mjs'),`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(marker)},'BUILD\\n')`);
  const command=feedbackCommands(aliasPlan('unit')).find(c=>c.kind==='focused');await fs.mkdir(path.join(root,'tests/normal-hosted'),{recursive:true});await fs.writeFile(path.join(root,'tests/normal-hosted/no-external.mjs'),'// harmless empty fixture import; no product or network\n');
  for(const file of command.args.filter(a=>a.endsWith('.test.mjs'))){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(marker)},'FOCUSED\\n');`);}
  const result=await execute(process.execPath,[new URL('../../tools/verify-changed.mjs',import.meta.url).pathname,'--group','unit'],{cwd:root,env:{PATH:'/usr/bin:/bin'},timeout:10000});assert.match(result.stdout,/SELECTED_COMMANDS_COMPLETED/);assert.deepEqual((await fs.readFile(marker,'utf8')).trimEnd().split('\n'),['BUILD',...command.args.filter(a=>a.endsWith('.test.mjs')).map(()=> 'FOCUSED')]);assert.doesNotMatch(result.stdout,/STALE_OR_UNBOUND_BUNDLE/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('actual CLI fixed Docker executable refusal occurs before fake build despite a complete declared engine environment',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util');const execute=promisify(execFile);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig139-docker-'))),marker=path.join(root,'BUILD_RAN');
 try{
  await fs.mkdir(path.join(root,'tools'),{recursive:true});await fs.writeFile(path.join(root,'tools/build.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'unexpected')`);
  const receipt=path.join(root,'bundle-receipt.json'),source=path.join(root,'frozen'),preload=path.join(root,'missing-docker.mjs');await fs.writeFile(receipt,'{}');await fs.mkdir(source);
  await fs.writeFile(preload,`import fs from 'node:fs';const original=fs.accessSync;fs.accessSync=function(file,...args){if(file==='/opt/homebrew/bin/docker'){const error=Error('fixture missing executable');error.code='ENOENT';throw error;}return original.call(this,file,...args);};`);
  let error;try{await execute(process.execPath,['--import',preload,new URL('../../tools/verify-changed.mjs',import.meta.url).pathname,'--group','acceptance'],{cwd:root,env:{PATH:'/usr/bin:/bin',GITJIG_DOCKER_BINARY:'/opt/homebrew/bin/docker',GITJIG_DOCKER_CONTEXT:'colima-gitjig-dev',GITJIG_RUNTIME_IMAGE:'sha256:'+'a'.repeat(64),GITJIG_BUNDLE_RECEIPT:receipt,GITJIG_BUNDLE_SOURCE_ROOT:source},timeout:5000});}catch(e){error=e;}
  assert.equal(error?.code,2);const observation=JSON.parse(error.stdout);assert.ok(observation.missingPrerequisites.some(x=>x.includes('/opt/homebrew/bin/docker executable unavailable before build')));await assert.rejects(fs.stat(marker),e=>e.code==='ENOENT');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('only the explicit UI roster runs two isolated test files at once; combined lanes remain serial',()=>{
 const ui=feedbackCommands(aliasPlan('ui')).find(c=>c.kind==='focused');assert.ok(ui.args.includes('--test-concurrency=2'));
 const combined=feedbackCommands({groups:['ui','unit']}).find(c=>c.kind==='focused');assert.ok(combined.args.includes('--test-concurrency=1'));assert.ok(!combined.args.includes('--test-concurrency=2'));
 const unit=feedbackCommands(aliasPlan('unit')).find(c=>c.kind==='focused');assert.ok(unit.args.includes('--test-concurrency=1'));
});

test('original integration consumer lanes remain bounded individually and together',()=>{
 const send=selectChanged(['tests/ui/integration-send.test.mjs']);assert.deepEqual(send.groups,['integrationSend']);assert.equal(feedbackBudgetMs(send),90000);
 for(const file of ['tests/ui/integration-hosted-read-fixture.mjs','tests/ui/integration-command-fixture.mjs','tests/ui/integration-read-fixture.mjs','tests/ui/integration-read-native-only.mjs'])assert.deepEqual(new Set(selectChanged([file]).groups),new Set(['integrationOwnerRecovery','integrationAlias','integrationStart','integrationTargets','integrationHostedTargets',...['tests/ui/integration-command-fixture.mjs','tests/ui/integration-read-fixture.mjs'].includes(file)?['integrationDelegation','hostedRegistrationCleanup']:[],'integrationRead','integrationSend','integrationPreparation']));
 const preparation=selectChanged(['tests/ui/integration-prepare.test.mjs']);assert.deepEqual(preparation.groups,['integrationPreparation']);assert.equal(feedbackBudgetMs(preparation),90000);
 const browser=selectChanged(['src/ui/integration-browser.ts']);assert.deepEqual(new Set(browser.groups),new Set(['integrationOwnerRecovery','integrationAlias','integrationStart','integrationRead','integrationSend','integration','integrationPreparation']));assert.equal(feedbackBudgetMs(browser),450000);const command=feedbackCommands(browser).find(c=>c.kind==='focused');for(const file of ['tests/ui/integration-send-hosted.test.mjs','tests/ui/integration-reconcile-pty.test.mjs','tests/cli/integration-discovery.test.mjs'])assert.ok(command.args.includes(file));
});


test('first-time receiver registration has its own finite native feedback lane',()=>{
 for(const file of ['tests/cli/integration-targets.test.mjs','tests/ui/integration-target-close.test.mjs']){const plan=selectChanged([file]);assert.deepEqual(plan.groups,['integrationTargets']);assert.equal(feedbackBudgetMs(plan),60000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python']));const command=feedbackCommands(plan).find(c=>c.kind==='focused');assert.ok(command.args.includes('tests/ui/integration-target-pty.test.mjs'));assert.ok(command.args.includes('tests/ui/integration-target-close.test.mjs'));}
 const shared=selectChanged(['tests/controller/integration-registry-fixture.mjs']);assert.ok(shared.groups.includes('integrationTargets'));assert.equal(feedbackBudgetMs(shared),960000);assert.equal(feedbackCommands(shared).find(c=>c.kind==='focused').timeoutMs,960000);
});

test('owner delegation has finite feedback and shared target entry changes select both real consumers',()=>{const solo=selectChanged(['src/controller/integration-delegation.ts']);assert.deepEqual(new Set(solo.groups),new Set(['managedAgentRecoveryInstalled','ordinaryRecoveryInstalled','integrationLineageRenewal','integrationOwnerRecovery','integrationDelegation']));assert.equal(feedbackBudgetMs(solo),630000);const shared=selectChanged(['src/ui/integration-target-browser.ts']);assert.deepEqual(new Set(shared.groups),new Set(['integrationTargets','integrationDelegation','integrationStart','integrationHostedTargets']));assert.equal(feedbackBudgetMs(shared),300000);const command=feedbackCommands(shared).find(c=>c.kind==='focused');assert.ok(command.args.includes('tests/ui/integration-target-pty.test.mjs'));assert.ok(command.args.includes('tests/ui/integration-delegation-pty.test.mjs'));});

test('first preparation selects its bounded native source and terminal consumers without unrelated suites',()=>{for(const file of ['src/ui/integration-start-browser.ts','tests/ui/integration-start.test.mjs']){const plan=selectChanged([file]);assert.deepEqual(plan.groups,['integrationStart']);assert.equal(feedbackBudgetMs(plan),90000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python']));const command=feedbackCommands(plan).find(c=>c.kind==='focused');assert.ok(command.args.includes('tests/ui/integration-start-hosted.test.mjs'));assert.ok(command.args.includes('tests/ui/integration-start-pty.test.mjs'));}const checkpoint=selectChanged(['tests/ui/integration-prepare-checkpoint.mjs']);assert.deepEqual(new Set(checkpoint.groups),new Set(['integrationOwnerRecovery','integrationStart','integrationPreparation']));assert.equal(feedbackBudgetMs(checkpoint),270000);});

test('receiver coordination selects actual allocation, send and alias consumers within finite budgets',()=>{const plan=selectChanged(['src/controller/integration-transmission.ts']);assert.deepEqual(new Set(plan.groups),new Set(['integrationOwnerRecovery','integrationAlias','integrationStart','integrationSend']));assert.equal(feedbackBudgetMs(plan),330000);const command=feedbackCommands(plan).find(c=>c.kind==='focused');for(const file of ['tests/ui/integration-start.test.mjs','tests/ui/integration-send-hosted.test.mjs','tests/ui/integration-alias.test.mjs','tests/ui/integration-alias-hosted.test.mjs'])assert.ok(command.args.includes(file));const alias=selectChanged(['tests/ui/integration-alias.test.mjs']);assert.deepEqual(alias.groups,['integrationAlias']);assert.equal(feedbackBudgetMs(alias),60000);assert.deepEqual(new Set(selectChanged(['tests/ui/integration-send-hosted-fixture.mjs']).groups),new Set(['integrationAlias','integrationSend']));});

test('receiver fixture and target identity owners select their actual alias consumers',()=>{assert.deepEqual(new Set(selectChanged(['tests/ui/integration-start-fixture.mjs']).groups),new Set(['integrationAlias','integrationStart']));assert.deepEqual(new Set(selectChanged(['tests/ui/integration-send-fixture.mjs']).groups),new Set(['hostedRegistrationCleanup','integrationAlias','integrationStart','integrationSend','integrationHostedTargets']));const target=selectChanged(['src/controller/integration-targets.ts']);assert.deepEqual(new Set(target.groups),new Set(['managedAgentRecoveryInstalled','ordinaryRecoveryInstalled','integrationLineageRenewal','integrationOwnerRecovery','integrationAlias','integrationStart','integrationTargets','integrationDelegation']));assert.equal(feedbackBudgetMs(target),840000);});

test('fresh installed integration record changes select the actual offline journey without a prepared engine bundle',()=>{const plan=selectChanged(['tests/installation/integration-records.test.mjs']);assert.deepEqual(plan.groups,['integrationInstalled']);assert.equal(feedbackBudgetMs(plan),180000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python']));assert.deepEqual(missingPrerequisites(plan,{}),[]);const commands=feedbackCommands(plan);assert.equal(commands.filter(c=>c.kind==='build').length,1);const focused=commands.find(c=>c.kind==='focused');assert.ok(focused.args.includes('tests/installation/integration-records.test.mjs'));assert.equal(focused.timeoutMs,180000);assert.equal(commands.some(c=>c.kind==='activation'||c.kind==='workflow'),false);});

test('common native initialization has a separate bounded actual cancellation lane',()=>{
 for(const file of ['tests/ui/integration-initialization.test.mjs','tests/ui/integration-initialization-pty.test.mjs']){
  const plan=selectChanged([file]);assert.deepEqual(plan.groups,['integrationInitialization']);assert.equal(feedbackBudgetMs(plan),60000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python']));
  const command=feedbackCommands(plan).find(c=>c.kind==='focused');for(const test of ['tests/ui/integration-initialization.test.mjs','tests/ui/integration-initialization-pty.test.mjs'])assert.ok(command.args.includes(test));
 }
 for(const file of ['src/controller/effects.ts','src/effects/native-git.ts']){
  const plan=selectChanged([file]);for(const group of ['integrationInitialization','integrationTargets','integrationStart','integrationRead','integrationSend','integrationPreparation','git'])assert.ok(plan.groups.includes(group));assert.equal(plan.groups.includes('integrated'),false);assert.equal(feedbackBudgetMs(plan),900000);
 }
});

test('hosted initialization selects prompt native checks and shared captured-session compatibility',()=>{
 for(const file of ['tests/ui/integration-hosted-initialization.test.mjs','tests/ui/integration-hosted-initialization-pty.test.mjs','tests/platform/native-https-initialization.test.mjs']){
  const plan=selectChanged([file]);assert.deepEqual(plan.groups,['integrationHostedInitialization']);assert.equal(feedbackBudgetMs(plan),60000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python']));
  const command=feedbackCommands(plan).find(c=>c.kind==='focused');for(const test of ['tests/ui/integration-hosted-initialization.test.mjs','tests/platform/native-https-initialization.test.mjs','tests/ui/integration-hosted-initialization-pty.test.mjs'])assert.ok(command.args.includes(test));
 }
 const fixture=selectChanged(['tests/ui/integration-initialization-fixture.mjs']);assert.deepEqual(new Set(fixture.groups),new Set(['integrationInitialization','integrationHostedInitialization','hostedRegistrationCleanup','integrationHostedTargets']));assert.equal(feedbackBudgetMs(fixture),270000);
 for(const file of ['src/controller/hostedintegration.ts','src/platform/github-publication-session.ts','src/platform/hosted-context.ts']){
  const plan=selectChanged([file]);for(const group of ['hostedNative','integrationHostedInitialization','integrationRead','integrationSend','integrationPreparation'])assert.ok(plan.groups.includes(group));assert.equal(plan.groups.includes('integrated'),false);
 }
 const shared=selectChanged(['tests/platform/acceptance-git.test.mjs']);assert.deepEqual(shared.groups,['hostedNative']);assert.equal(feedbackBudgetMs(shared),240000);
});

test('hosted registration cleanup selects original native, CLI and shared-session evidence without execution engines',()=>{
 for(const file of ['tests/ui/hosted-registration-controls.test.mjs','tests/ui/hosted-registration-cleanup.test.mjs','tests/cli/hosted-registration-cleanup.test.mjs','tests/platform/hosted-registration-cleanup.test.mjs']){
  const plan=selectChanged([file]);assert.deepEqual(plan.groups,['hostedRegistrationCleanup']);assert.equal(feedbackBudgetMs(plan),60000);assert.deepEqual(requirements(plan),['git']);
  const command=feedbackCommands(plan).find(c=>c.kind==='focused');for(const test of ['tests/ui/hosted-registration-controls.test.mjs','tests/ui/hosted-registration-cleanup.test.mjs','tests/cli/hosted-registration-cleanup.test.mjs','tests/platform/hosted-registration-cleanup.test.mjs'])assert.ok(command.args.includes(test));
 }
 for(const file of ['src/controller/effects.ts','src/platform/hosted-context.ts'])assert.ok(selectChanged([file]).groups.includes('hostedRegistrationCleanup'));
});

test('hosted cleanup shared fixtures retain existing owners and select the actual new lane',()=>{
 for(const file of ['tests/ui/integration-read-fixture.mjs','tests/ui/integration-send-fixture.mjs','tests/controller/integration-registry-fixture.mjs','tests/controller/hosted-integration-fixture.mjs','tests/platform/acceptance-git-fixture.mjs','tests/platform/acceptance-fixture.mjs','tests/cli/normal-hosted-adapter.mjs']){
  const plan=selectChanged([file]);assert.ok(plan.groups.includes('hostedRegistrationCleanup'),file);assert.equal(plan.unknown,false);assert.equal(plan.groups.includes('integrated'),false);
  const focused=feedbackCommands(plan).find(c=>c.kind==='focused');assert.ok(focused.args.includes('tests/cli/hosted-registration-cleanup.test.mjs'));assert.ok(focused.args.includes('tests/platform/hosted-registration-cleanup.test.mjs'));
 }
});


test('hosted receiver UI has a finite actual-native terminal lane and shared dependencies retain original consumers',()=>{
 for(const file of ['src/ui/integration-hosted-target-form.ts','tests/ui/integration-hosted-target.test.mjs','tests/ui/integration-hosted-target-pty.test.mjs','tests/ui/integration-hosted-target-fixture.mjs','tests/ui/integration-hosted-target-preload.mjs']){const plan=selectChanged([file]);assert.deepEqual(plan.groups,['integrationHostedTargets']);assert.equal(feedbackBudgetMs(plan),90000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python']));const command=feedbackCommands(plan).find(c=>c.kind==='focused');for(const test of ['tests/ui/integration-hosted-target.test.mjs','tests/ui/integration-hosted-target-pty.test.mjs'])assert.ok(command.args.includes(test));}
 for(const file of ['src/ui/integration-target-paths.ts','src/ui/integration-target-browser.ts','src/ui/repository-commands.ts','src/controller/effects.ts','src/controller/controller.ts','src/controller/hostedintegration.ts','tests/ui/hosted-registration-cleanup-fixture.mjs','tests/ui/integration-initialization-fixture.mjs','tests/ui/integration-send-fixture.mjs','tests/ui/integration-read-fixture.mjs','tests/ui/integration-read-native-only.mjs','tests/ui/integration-command-fixture.mjs','tests/controller/integration-registry-fixture.mjs','tests/controller/hosted-integration-fixture.mjs','tests/cli/normal-hosted-adapter.mjs']){const plan=selectChanged([file]);assert.ok(plan.groups.includes('integrationHostedTargets'),file);assert.equal(plan.unknown,false);}
 const paths=selectChanged(['src/ui/integration-target-paths.ts']);assert.deepEqual(new Set(paths.groups),new Set(['integrationTargets','integrationHostedTargets']));assert.equal(feedbackBudgetMs(paths),150000);
 const fixture=selectChanged(['tests/ui/hosted-registration-cleanup-fixture.mjs']);assert.deepEqual(new Set(fixture.groups),new Set(['hostedRegistrationCleanup','integrationHostedTargets']));assert.equal(feedbackBudgetMs(fixture),150000);
});


test('fresh hosted receiver installation has an explicit offline lane and owned backend dependency',()=>{
 const plan=selectChanged(['tests/installation/hosted-receiver.test.mjs']);assert.deepEqual(plan.groups,['hostedReceiverInstalled']);assert.equal(feedbackBudgetMs(plan),180000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python']));assert.deepEqual(missingPrerequisites(plan,{}),[]);const commands=feedbackCommands(plan),focused=commands.find(command=>command.kind==='focused');assert.equal(focused.timeoutMs,180000);assert.ok(focused.args.includes('tests/installation/hosted-receiver.test.mjs'));assert.equal(commands.some(command=>command.kind==='activation'||command.kind==='workflow'),false);
 const backend=selectChanged(['tests/controller/hosted-integration-fixture.mjs']);for(const group of ['hostedReceiverInstalled','hostedNative','hostedRegistrationCleanup','integrationHostedTargets'])assert.ok(backend.groups.includes(group));assert.equal(backend.unknown,false);assert.ok(feedbackCommands(backend).find(command=>command.kind==='focused').args.includes('tests/installation/hosted-receiver.test.mjs'));
});

test('owner recovery has finite source/terminal feedback and shared owner rules retain earlier consumers',()=>{
 const own=selectChanged(['tests/ui/integration-owner-recovery.test.mjs']);assert.deepEqual(own.groups,['integrationOwnerRecovery']);assert.equal(feedbackBudgetMs(own),90000);assert.deepEqual(new Set(requirements(own)),new Set(['git','python']));assert.deepEqual(missingPrerequisites(own,{}),[]);const focused=feedbackCommands(own).find(c=>c.kind==='focused');for(const file of ['tests/ui/integration-owner-recovery.test.mjs','tests/ui/integration-owner-recovery-hosted.test.mjs','tests/ui/integration-owner-recovery-pty.test.mjs'])assert.ok(focused.args.includes(file));
 for(const [file,earlier]of [['src/controller/integration-delegation.ts','integrationDelegation'],['src/controller/integration-grant-history.ts','integrationPreparation'],['src/ui/integration-browser.ts','integration'],['tests/ui/integration-command-fixture.mjs','integrationHostedTargets'],['tests/controller/integration-registry-fixture.mjs','integrationTargets'],['tests/ui/integration-prepare-fixture.mjs','integrationPreparation'],['tests/ui/integration-delegation-native-none.mjs','integrationDelegation'],['src/controller/integration-targets.ts','integrationTargets'],['src/controller/hostedintegration.ts','hostedNative']]){const shared=selectChanged([file]);assert.ok(shared.groups.includes('integrationOwnerRecovery'),file);assert.ok(shared.groups.includes(earlier),file);assert.equal(shared.unknown,false);assert.equal(shared.groups.includes('integrated'),false);}
});


test('agent integration admission selects its real tool/transaction consumers with finite offline feedback',()=>{
 const file='tests/controller/integration-agent-admission.test.mjs',plan=selectChanged([file]);assert.deepEqual(plan.groups,['integrationAgentAdmission']);assert.deepEqual(requirements(plan),['git']);assert.equal(plan.unknown,false);assert.equal(feedbackBudgetMs(plan),60000);assert.deepEqual(missingPrerequisites(plan,{}),[]);assert.ok(feedbackCommands(plan).find(c=>c.kind==='focused').args.includes(file));
 for(const dependency of ['src/controller/effects.ts','tests/controller/integration-registry-fixture.mjs'])assert.ok(selectChanged([dependency]).groups.includes('integrationAgentAdmission'));
});


test('ordinary owner admission recovery selects its real SDK, work command and terminal consumers',()=>{
 for(const file of ['src/controller/work-recovery.ts','src/ui/work-commands.ts','tests/controller/ordinary-admission-recovery.test.mjs','tests/controller/ordinary-admission-recovery-worker.mjs']){const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.deepEqual(new Set(plan.groups),new Set(['lifecycleConvergence','unit','ordinaryAdmissionRecovery',...file==='src/controller/work-recovery.ts'?['integrationLineageRenewal','ordinaryRecoveryInstalled','assignmentRecovery','managedAgentRecoveryInstalled']:file==='src/ui/work-commands.ts'?['usabilityJourneys','ordinaryRecoveryInstalled','managedAgentRecoveryInstalled']:[]]));assert.deepEqual(new Set(requirements(plan)),new Set(['src/controller/work-recovery.ts','src/ui/work-commands.ts'].includes(file)?['git','python','engine','runtimeStorage','managedBundle']:['python','git']));assert.equal(feedbackBudgetMs(plan),file==='src/controller/work-recovery.ts'?700000:file==='src/ui/work-commands.ts'?600000:100000);const command=feedbackCommands(plan).find(c=>c.kind==='focused');for(const test of ['tests/controller/ordinary-admission-recovery.test.mjs','tests/ui/work-commands.test.mjs','tests/ui/work-recovery-pty.test.mjs'])assert.ok(command.args.includes(test));}
});

test('lineage renewal selects current Pi and terminal consumers without dropping original grant-history consumers',()=>{
 for(const file of ['src/controller/integration-delegation.ts','src/controller/integration-grant-history.ts','src/ui/integration-delegation-browser.ts','tests/controller/integration-lineage-renewal.test.mjs','tests/controller/integration-lineage-renewal-worker.mjs']){const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('integrationLineageRenewal'));assert.deepEqual(new Set(requirements(plan)),new Set(plan.groups.includes('managedAgentRecoveryInstalled')?['engine','runtimeStorage','managedBundle','git','python']:['git','python']));assert.ok(feedbackCommands(plan).find(c=>c.kind==='focused').args.includes('tests/controller/integration-lineage-renewal.test.mjs'));}
 const solo=selectChanged(['tests/controller/integration-lineage-renewal-worker.mjs']);assert.deepEqual(solo.groups,['integrationLineageRenewal','assignmentRecovery']);assert.equal(feedbackBudgetMs(solo),180000);
 const history=selectChanged(['src/controller/integration-grant-history.ts']);for(const group of ['integrationOwnerRecovery','integrationDelegation','integrationStart','integrationPreparation','integrationSend'])assert.ok(history.groups.includes(group));
});

test('lineage renewal dependencies select its actual new boundary without dropping existing consumers',()=>{for(const file of ['src/controller/work-recovery.ts','src/controller/integration-targets.ts','tests/controller/integration-registry-fixture.mjs','src/controller/ordinary.ts','src/controller/coordination.ts']){const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('integrationLineageRenewal'),file);assert.ok(feedbackCommands(plan).find(c=>c.kind==='focused').args.includes('tests/controller/integration-lineage-renewal.test.mjs'));}});

test('installed ordinary recovery selects a finite offline payload journey and its original dependencies',()=>{for(const file of ['tests/installation/ordinary-recovery.test.mjs','tests/installation/ordinary-recovery-driver.mjs']){const plan=selectChanged([file]);assert.deepEqual(plan.groups,['ordinaryRecoveryInstalled']);assert.equal(plan.unknown,false);assert.deepEqual(requirements(plan),['git','python']);assert.deepEqual(missingPrerequisites(plan,{}),[]);assert.equal(feedbackBudgetMs(plan),180000);assert.ok(feedbackCommands(plan).find(c=>c.kind==='focused').args.includes('tests/installation/ordinary-recovery.test.mjs'));}for(const file of ['src/controller/work-recovery.ts','src/ui/work-commands.ts','src/controller/ordinary.ts','src/controller/integration-delegation.ts','src/controller/integration-grant-history.ts','src/ui/integration-delegation-browser.ts','src/controller/integration-targets.ts','tests/cli/fork-ui-pty.py'])assert.ok(selectChanged([file]).groups.includes('ordinaryRecoveryInstalled'),file);});

test('governed assignment recovery has a finite lane selected by its authority, shared fixtures and real consumers',()=>{
 for(const file of ['tests/controller/assignment-recovery.test.mjs','tests/controller/assignment-recovery-worker.mjs']){const plan=selectChanged([file]);assert.deepEqual(plan.groups,['assignmentRecovery']);assert.deepEqual(requirements(plan),['git']);assert.equal(feedbackBudgetMs(plan),120000);assert.deepEqual(feedbackCommands(plan).find(c=>c.kind==='focused').args.filter(a=>a.startsWith('tests/controller/')),['tests/controller/assignment-recovery.test.mjs']);}
 assert.deepEqual(new Set(selectChanged(['src/controller/assignment-authority.ts']).groups),new Set(['assignmentRecovery','contextAssignmentRecovery','contextAssignmentEndpoint','contextAssignmentInstalled','contextAssignmentAbrupt','unit','managedAgentRecoveryInstalled']));
 for(const file of ['src/controller/effects.ts','src/controller/ordinary.ts','src/controller/coordination.ts','src/controller/work-recovery.ts','src/pi/coordination.ts','tests/controller/integration-lineage-renewal-worker.mjs','tests/controller/integration-registry-fixture.mjs','src/controller/controller.ts']){const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('assignmentRecovery'),file);}
 const pi=selectChanged(['src/pi/coordination.ts']);for(const group of ['sdk','runtime','integrated'])assert.ok(pi.groups.includes(group));
});


test('external qualification output is excluded while its source and shared runtime policy retain conservative coverage',()=>{
 const generated=selectChanged(['.qualification/controller-testing.js']);assert.deepEqual(generated.groups,[]);assert.equal(generated.excluded.length,1);
 for(const file of ['qualification/controller-testing.ts','src/app/runtime-requirements.js','tools/build.mjs']){const selected=selectChanged([file]);assert.equal(selected.crosscut,true);assert.equal(selected.groups.includes('integrated'),true);assert.equal(selected.groups.includes('unit'),true);}
});

test('actual local runtime consumers retain a separate explicit installed-engine lane',()=>{
 assert.equal(feedbackBudgetMs({groups:['integrated','localEvidenceRuntime']}),600000);
 assert.equal(feedbackBudgetMs(selectChanged(['package.json'])),600000);
 for(const file of ['tests/installation/local-runtime.test.mjs','tests/cli/local-evidence-runtime.test.mjs','tests/cli/local-evidence-runtime-journey.mjs']){
  const plan=selectChanged([file]);assert.deepEqual(plan.groups,['localEvidenceRuntime']);assert.equal(plan.unknown,false);
  const commands=feedbackCommands(plan);assert.equal(commands.filter(c=>c.kind==='build').length,1);const focused=commands.find(c=>c.kind==='focused');
  for(const consumer of ['tests/cli/local-evidence-runtime.test.mjs','tests/installation/local-runtime.test.mjs'])assert.ok(focused.args.includes(consumer));
  assert.ok(missingPrerequisites(plan,{}).some(s=>s.includes('GITJIG_RUNTIME_FIXTURE_ROOT')));assert.ok(missingPrerequisites(plan,{}).some(s=>s.includes('GITJIG_DOCKER_CONFIG_DIRECTORY')));assert.equal(feedbackBudgetMs(plan),330000);
 }
});

test('installed managed first work requires actual runtime and frozen current-source inputs',()=>{
 const entry=selectChanged(['src/installation/entry.ts']);for(const group of ['install','managedFirstWorkInstalled'])assert.ok(entry.groups.includes(group));
 const plan=selectChanged(['tests/installation/managed-first-work.test.mjs']);assert.deepEqual(plan.groups,['managedFirstWorkInstalled']);assert.deepEqual(selectChanged(['tests/installation/managed-owner-recovery.mjs']).groups,plan.groups);assert.deepEqual(new Set(selectChanged(['tests/installation/managed-agent-endpoint.mjs']).groups),new Set(['managedFirstWorkInstalled','contextAdmissionInstalled','contextAssignmentInstalled','contextAssignmentAbrupt']));assert.deepEqual(selectChanged(['tests/installation/managed-interruption.mjs']).groups,plan.groups);assert.ok(requirements(plan).includes('git'));assert.equal(feedbackBudgetMs(plan),240000);
 assert.ok(feedbackCommands(plan).find(command=>command.kind==='focused').args.includes('tests/installation/managed-first-work.test.mjs'));assert.ok(missingPrerequisites(plan,{}).some(message=>message.includes('GITJIG_CLI_FINAL_BUILD_RECEIPT')));
 for(const shared of ['tests/controller/effect-fixture.mjs','tests/pi/provider-wire-fixture.mjs']){const selected=selectChanged([shared]);for(const group of ['unit','sdk','runtime','roleEvidence','managedFirstWorkInstalled'])assert.ok(selected.groups.includes(group));assert.equal(feedbackBudgetMs(selected),600000);}
 const terminal=selectChanged(['tests/cli/fork-ui-pty.py']);for(const group of ['ui','unit','ordinaryRecoveryInstalled','managedFirstWorkInstalled'])assert.ok(terminal.groups.includes(group));
});


test('installed agent recovery has its own bounded real-engine lane and shared fixture consumers',()=>{
 const plan=selectChanged(['tests/installation/managed-agent-recovery.test.mjs']);assert.deepEqual(plan.groups,['managedAgentRecoveryInstalled']);assert.equal(feedbackBudgetMs(plan),240000);
 assert.deepEqual(requirements(plan),['engine','runtimeStorage','managedBundle','python','git']);assert.ok(missingPrerequisites(plan,{}).some(message=>message.includes('GITJIG_CLI_FINAL_BUILD_RECEIPT')));
 assert.ok(feedbackCommands(plan).find(command=>command.kind==='focused').args.includes('tests/installation/managed-agent-recovery.test.mjs'));
 const shared=selectChanged(['tests/installation/managed-installed-fixture.mjs']);assert.deepEqual(new Set(shared.groups),new Set(['managedFirstWorkInstalled','managedAgentRecoveryInstalled','goalEndpointInstalled']));assert.equal(shared.unknown,false);assert.equal(feedbackBudgetMs(shared),720000);
 for(const file of ['src/controller/coordination.ts','src/controller/assignment-authority.ts','src/controller/work-recovery.ts','src/controller/effects.ts','src/ui/work-commands.ts','tests/cli/fork-ui-pty.py'])assert.ok(selectChanged([file]).groups.includes('managedAgentRecoveryInstalled'),file);
});

test('installed repository governance selects its real model-free consumer without activation prerequisites',()=>{
 const plan=selectChanged(['tests/installation/repository.test.mjs']);assert.deepEqual(plan.groups,['repositoryGovernanceInstalled']);assert.equal(plan.decisions[0].owner,'repository-governance-installed');
 assert.deepEqual(requirements(plan),['python']);assert.deepEqual(missingPrerequisites(plan,{}),[]);assert.equal(feedbackBudgetMs(plan),150000);
 const commands=feedbackCommands(plan);assert.equal(commands.filter(command=>command.kind==='build').length,1);
 const focused=commands.find(command=>command.kind==='focused');assert.ok(focused.args.includes('--test-concurrency=1'));assert.deepEqual(focused.args.filter(argument=>argument.endsWith('.test.mjs')),['tests/installation/repository.test.mjs']);assert.equal(focused.timeoutMs,180000);
 assert.equal(commands.some(command=>['activation','workflow'].includes(command.kind)),false);assert.equal(feedbackBudgetMs({groups:['integrated','repositoryGovernanceInstalled']}),600000);
 assert.deepEqual(selectChanged(['tests/installation/activation.test.mjs']).groups,['install']);
});

test('restricted merge source selects real native and procedure consumers with explicit runtime prerequisites',()=>{
 const plan=selectChanged(['src/controller/merge.ts']);assert.equal(plan.unknown,false);assert.deepEqual(plan.groups,['mergeTargetEntry','mergeCore','mergeWorkflow','mergeInstalled']);assert.equal(feedbackBudgetMs(plan),510000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python','engine','runtimeStorage','managedBundle']));
 const focused=feedbackCommands(plan).find(command=>command.kind==='focused');for(const file of ['tests/controller/merge-owner-preparation.test.mjs','tests/platform/github-merge-native.test.mjs','tests/controller/merge-sdk.test.mjs','tests/controller/merge-admission.test.mjs','tests/cli/merge-discovery.test.mjs','tests/ui/merge-browser.test.mjs','tests/controller/normal-landing-merge.test.mjs'])assert.ok(focused.args.includes(file));assert.ok(missingPrerequisites(plan,{}).some(message=>message.includes('GITJIG_DOCKER_CONTEXT')));
});
test('ordinary startup authority selects actual SDK restart and rollback boundary',()=>{
 const plan=selectChanged(['tests/controller/ordinary-owner-activation.test.mjs']);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('ordinaryOwnerActivation'));assert.ok(feedbackCommands(plan).find(command=>command.kind==='focused').args.includes('tests/controller/ordinary-owner-activation.test.mjs'));assert.deepEqual(missingPrerequisites(plan,{}),[]);
});


test('PR target registration changes select actual owner form, terminal and CLI without requiring an engine',()=>{
 for(const file of ['src/ui/merge-start-browser.ts','tests/ui/merge-start.test.mjs','src/ui/merge-delegation-browser.ts','tests/ui/merge-delegation-pty.test.mjs','src/ui/merge-target-browser.ts','tests/ui/merge-target-preload.mjs','tests/cli/merge-target-registration.test.mjs']){const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.deepEqual(plan.groups,['mergeTargetEntry']);assert.equal(feedbackBudgetMs(plan),60000);assert.deepEqual(new Set(requirements(plan)),new Set(['git','python']));const command=feedbackCommands(plan).find(command=>command.kind==='focused');for(const consumer of ['tests/ui/merge-start.test.mjs','tests/ui/merge-start-pty.test.mjs','tests/ui/merge-delegation.test.mjs','tests/ui/merge-delegation-pty.test.mjs','tests/ui/merge-target.test.mjs','tests/ui/merge-target-pty.test.mjs','tests/cli/merge-target-registration.test.mjs'])assert.ok(command.args.includes(consumer));}
});

 test('goal first-owner and installed endpoint checks declare finite independent prerequisites',()=>{
 const source=selectChanged(['tests/controller/goal-owner-entry-worker.mjs']);assert.deepEqual(new Set(source.groups),new Set(['unit','goalOwnerEntry']));assert.ok(requirements(source).includes('git'));
 const installed=selectChanged(['tests/installation/goal-endpoint.test.mjs']);assert.deepEqual(installed.groups,['goalEndpointInstalled']);assert.equal(feedbackBudgetMs(installed),240000);assert.deepEqual(new Set(requirements(installed)),new Set(['engine','runtimeStorage','managedBundle','python','git']));assert.ok(feedbackCommands(installed).find(command=>command.kind==='focused').args.includes('tests/installation/goal-endpoint.test.mjs'));
 });

test('administrator to developer local adoption remains separate from model-free repository management',()=>{
 const local=selectChanged(['tests/installation/repository-local.test.mjs']);assert.deepEqual(local.groups,['repositoryLocalInstalled']);assert.equal(feedbackBudgetMs(local),240000);assert.deepEqual(new Set(requirements(local)),new Set(['engine','runtimeStorage','python','git']));
 const shared=selectChanged(['tests/installation/repository-journey.mjs']);assert.deepEqual(new Set(shared.groups),new Set(['repositoryGovernanceInstalled','repositoryLocalInstalled']));
 const admin=selectChanged(['tests/installation/repository.test.mjs']);assert.deepEqual(admin.groups,['repositoryGovernanceInstalled']);assert.deepEqual(requirements(admin),['python']);
});

test('UI language changes include catalogue and original terminal consumers exactly once',()=>{
 for(const file of ['src/ui/i18n.ts','src/ui/choices.ts','src/ui/locales/en.ts','src/ui/locales/ko.ts','tests/ui/i18n.test.mjs','tests/ui/i18n-pty.test.mjs']){
  const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('ui'));
  const files=feedbackCommands(plan).filter(command=>command.kind==='focused').flatMap(command=>command.args);
  for(const consumer of ['tests/ui/i18n.test.mjs','tests/ui/i18n-pty.test.mjs'])assert.equal(files.filter(file=>file===consumer).length,1);
 }
});

test('recovery command boundaries select their maintained navigation consumer exactly once without provisioning',()=>{
 for(const file of ['src/ui/error-commands.ts','src/ui/recovery-navigation.ts','tests/ui/recovery-navigation.test.mjs']){
  const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('ui'));assert.ok(!plan.groups.includes('runtimePreparation'));
  const selected=feedbackCommands(plan).flatMap(command=>command.args);
  assert.equal(selected.filter(file=>file==='tests/ui/recovery-navigation.test.mjs').length,1);
 }
});

test('shared inspection PTY support selects every direct consumer after a rename', () => {
 for (const file of ['tests/ui/inspection-pty-observer.mjs', 'tests/ui/inspection-pty.py']) {
  const plan = selectChanged([file]);
  assert.equal(plan.unknown, false);
  assert.ok(plan.groups.includes('ui'));
  assert.ok(plan.groups.includes('roleEvidence'));
  assert.ok(plan.groups.includes('localResultRuntime'));
  const commands = feedbackCommands(plan).filter(command => command.kind === 'focused');
  for (const consumer of ['tests/ui/resume-handoff-pty.test.mjs', 'tests/ui/managed-change-runtime.test.mjs', 'tests/ui/local-check-result-runtime.test.mjs'])
   assert.equal(commands.flatMap(command => command.args).filter(argument => argument === consumer).length, 1);
 }
});


test('shared inspection text keeps formatter and refusal checks in addition to the local runtime lane', () => {
 const plan = selectChanged(['src/ui/inspection-text.ts']);
 assert.deepEqual(new Set(plan.groups), new Set(['ui', 'unit', 'localResultRuntime']));
 const commands = feedbackCommands(plan).filter(command => command.kind === 'focused');
 for (const consumer of ['tests/ui/change-result.test.mjs', 'tests/ui/local-evidence-presentation.test.mjs', 'tests/ui/repository-presentation.test.mjs', 'tests/ui/local-check-result-runtime.test.mjs'])
  assert.equal(commands.flatMap(command => command.args).filter(argument => argument === consumer).length, 1);
});

test('explicit owner assigned-task cancellation selects its original controller and project recovery consumers',()=>{
 for(const file of ['src/controller/owner-assignment-cancellation.ts','tests/controller/owner-assignment-cancellation.test.mjs','tests/controller/owner-assignment-cancellation-fixture.mjs','tests/ui/project-dependency-pty.test.mjs']){
  const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.deepEqual(plan.groups,['ownerAssignmentCancellation']);
  assert.deepEqual(requirements(plan),['python']);
  const args=feedbackCommands(plan).find(command=>command.kind==='focused').args;
  for(const consumer of ['tests/controller/owner-assignment-cancellation.test.mjs','tests/ui/project-commands.test.mjs','tests/ui/project-dependency-pty.test.mjs'])assert.ok(args.includes(consumer));
 }
});

test('lifecycle convergence feedback reaches composed regressions without dropping existing shared owners',()=>{
 for(const file of ['src/controller/native-identity.ts','src/controller/effect-assignment-provenance.ts','src/controller/consumed-wait.ts','src/controller/effect-assignment-cancellation.ts','src/controller/effect-assignment-settlement.ts','src/controller/assignment-result-reconciliation.ts','tests/controller/structured-assignment-fixture.mjs','tests/controller/consumed-wait-recovery-worker.mjs','tests/ui/ordinary-task-cancellation-fixture.mjs']){
  const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.ok(plan.groups.includes('lifecycleConvergence'));
  assert.ok(!requirements(plan).includes('engine'));
  const args=feedbackCommands(plan).find(c=>c.kind==='focused').args;
  for(const consumer of ['tests/controller/effect-restart-settlement.test.mjs','tests/controller/publication-restart-settlement.test.mjs','tests/controller/structured-assignment-settlement.test.mjs','tests/controller/assignment-result-reconciliation.test.mjs','tests/controller/consumed-wait-recovery.test.mjs','tests/controller/effect-assignment-cancellation.test.mjs','tests/controller/merge-cancellation-reopen.test.mjs','tests/ui/ordinary-task-cancellation-pty.test.mjs'])assert.ok(args.includes(consumer),file+' '+consumer);
 }
 for(const file of ['src/controller/controller.ts','src/controller/ordinary.ts','src/controller/work-recovery.ts','src/controller/effects.ts','src/ui/work-commands.ts']){
  const plan=selectChanged([file]);assert.ok(plan.groups.includes('lifecycleConvergence'),file);assert.ok(plan.groups.includes('unit'),file);
 }
 assert.ok(selectChanged(['src/controller/native-identity.ts']).groups.includes('ownerAssignmentCancellation'));
 assert.ok(selectChanged(['src/controller/ordinary.ts']).groups.includes('ordinaryRecoveryInstalled'));
 assert.ok(selectChanged(['src/controller/effects.ts']).groups.includes('integrationAgentAdmission'));
});

test('request navigation and publication restart consumers remain selected by their original boundaries',()=>{
 for(const file of ['src/ui/index.ts','tests/ui/request-navigation-child.mjs']){
  const plan=selectChanged([file]);
  assert.ok(feedbackCommands(plan).filter(c=>c.kind==='focused').some(c=>c.args.includes('tests/ui/request-navigation-pty.test.mjs')));
 }
 const plan=selectChanged(['src/controller/publication.ts']);
 assert.ok(feedbackCommands(plan).filter(c=>c.kind==='focused').some(c=>c.args.includes('tests/controller/publication-restart-settlement.test.mjs')));
});

test('reset disposition and backup deletion changes retain model-free app and terminal consumers',()=>{
 for(const file of ['src/app/reset-backups.ts','tests/cli/reset-disposition.test.mjs']){
  const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.deepEqual(plan.groups,['unit','ui']);
  assert.equal(requirements(plan).includes('engine'),false);
  const args=feedbackCommands(plan).filter(c=>c.kind==='focused').flatMap(c=>c.args);
  for(const test of ['tests/app/reset.test.mjs','tests/ui/reset-pty.test.mjs','tests/cli/reset-disposition.test.mjs'])assert.ok(args.includes(test));
 }
});

test('native account route drift feedback retains the actual SDK birth consumer within its model-free budget',()=>{
 for(const file of ['tests/app/bridge-account-route-drift.test.mjs','tests/app/bridge-account-route-drift-worker.mjs']){
  const plan=selectChanged([file]);assert.equal(plan.unknown,false);assert.deepEqual(plan.groups,['sdk']);assert.deepEqual(requirements(plan),[]);assert.equal(feedbackBudgetMs(plan),90000);
  const command=feedbackCommands(plan).find(command=>command.kind==='focused');
  for(const testFile of ['tests/app/bridge-account-route-drift.test.mjs','tests/pi/bridge-native-preflight.test.mjs','tests/app/bridge-native.test.mjs'])assert.equal(command.args.filter(arg=>arg===testFile).length,1);
 }
});

test('coordinator outcome feedback reaches original wait and task recovery consumers',()=>{
 const plan=selectChanged(['src/controller/coordination.ts']);
 for(const group of ['sdk','assignmentRecovery','integrationLineageRenewal','managedAgentRecoveryInstalled'])assert.ok(plan.groups.includes(group),group);
 const args=feedbackCommands(plan).filter(command=>command.kind==='focused').flatMap(command=>command.args);
 assert.equal(args.filter(arg=>arg==='tests/controller/assignment-wait-outcome.test.mjs').length,1);
});


test('goal dependency feedback reaches the original failed-wait consumer without dropping owner entry',()=>{
 for(const file of ['src/controller/goals.ts','src/controller/original-wait-outcome.ts','src/controller/ordinary.ts']){
  const plan=selectChanged([file]);
  assert.ok(plan.groups.includes('sdk'),file);
  if(file==='src/controller/goals.ts')assert.ok(plan.groups.includes('goalOwnerEntry'));
  const args=feedbackCommands(plan).filter(command=>command.kind==='focused').flatMap(command=>command.args);
  assert.equal(args.filter(arg=>arg==='tests/controller/original-failed-wait.test.mjs').length,1);
 }
});


test('owner workflow-rule review retains managed-work recovery and reaches its model-free consumers',()=>{
 for(const file of ['src/ui/criteria-refresh.ts','src/ui/work-commands.ts','tests/controller/criteria-refresh-fixture.mjs']){
  const plan=selectChanged([file]);assert.ok(plan.groups.includes('usabilityJourneys'),file);
  if(file==='src/ui/work-commands.ts')for(const group of ['lifecycleConvergence','ordinaryRecoveryInstalled','managedAgentRecoveryInstalled'])assert.ok(plan.groups.includes(group),group);
  const args=feedbackCommands(plan).filter(command=>command.kind==='focused').flatMap(command=>command.args);
  for(const consumer of ['tests/controller/criteria-refresh-review.test.mjs','tests/ui/criteria-refresh.test.mjs','tests/ui/criteria-refresh-pty.test.mjs'])assert.equal(args.filter(arg=>arg===consumer).length,1);
 }
});


test('native result paging feedback reaches scoped controller and MCP consumers',()=>{
 for(const file of ['src/pi/conversation-result.ts','tests/pi/conversation-result-pages.test.mjs','tests/pi/conversation-result-sdk.test.mjs','tests/controller/conversation-result-pages.test.mjs','src/controller/coordination.ts']){
  const plan=selectChanged([file]);assert.ok(plan.groups.includes('sdk'),file);
  const args=feedbackCommands(plan).filter(command=>command.kind==='focused').flatMap(command=>command.args);
  for(const consumer of ['tests/pi/conversation-result-pages.test.mjs','tests/pi/conversation-result-sdk.test.mjs','tests/controller/conversation-result-pages.test.mjs','tests/pi/bridge-permission-coherence.test.mjs'])assert.equal(args.filter(arg=>arg===consumer).length,1);
 }
});


test('assignment envelopes and integer operands retain original composed consumers',()=>{
 for(const file of ['src/controller/assigned-work-provenance.ts','tests/controller/assignment-envelope.test.mjs']){
  const plan=selectChanged([file]);
  for(const group of ['ownerAssignmentCancellation','lifecycleConvergence','sdk'])assert.ok(plan.groups.includes(group));
  const args=feedbackCommands(plan).filter(c=>c.kind==='focused').flatMap(c=>c.args);
  for(const test of ['tests/controller/assignment-envelope.test.mjs','tests/controller/original-failed-wait.test.mjs','tests/controller/assignment-result-reconciliation.test.mjs','tests/controller/owner-assignment-cancellation.test.mjs'])assert.equal(args.filter(arg=>arg===test).length,1);
 }
 for(const file of ['src/pi/goal-tools.ts','src/pi/coordination.ts','tests/pi/coordination-integer-guards.test.mjs']){
  const plan=selectChanged([file]);assert.ok(plan.groups.includes('sdk'));
  const args=feedbackCommands(plan).filter(c=>c.kind==='focused').flatMap(c=>c.args);
  assert.equal(args.filter(arg=>arg==='tests/pi/coordination-integer-guards.test.mjs').length,1);
 }
});


test('finite verification and immutable result feedback reaches original consumers with explicit runtime prerequisites',()=>{
 for(const file of ['tests/controller/goal-owner-continuation-context.test.mjs','tests/controller/goal-explicit-wait-resume.test.mjs','src/controller/governed-result.ts','src/controller/conversation-results.ts','src/controller/goal-evidence.ts','tests/controller/governed-result-publication.test.mjs','tests/pi/conversation-result-detail.test.mjs','tests/controller/criteria-refresh-failed-wait.test.mjs']){
  const plan=selectChanged([file]);for(const group of ['unit','sdk'])assert.ok(plan.groups.includes(group),file);
  const args=feedbackCommands(plan).filter(c=>c.kind==='focused').flatMap(c=>c.args);
  for(const consumer of ['tests/controller/goal-owner-continuation-context.test.mjs','tests/controller/goal-explicit-wait-resume.test.mjs','tests/controller/governed-result-publication.test.mjs','tests/pi/conversation-result-detail.test.mjs','tests/controller/goal-linked-completion.test.mjs','tests/controller/criteria-refresh-failed-wait.test.mjs'])assert.equal(args.filter(arg=>arg===consumer).length,1);
 }
 for(const file of ['tests/cli/change-http.test.mjs','tests/ui/reviewer-pty-child.mjs','tests/ui/reviewer-pty.py','tests/ui/reviewer-pty.test.mjs','tests/controller/verification-cases-consumer.test.mjs','tests/controller/typed-nit-fixture.mjs','tests/controller/verification-cases-nit.test.mjs','tests/controller/bounded-drive-nit-runtime.test.mjs','tests/workflow/mixed-verification-runtime.test.mjs','tests/workflow/mixed-verification-runtime-worker.mjs'])assert.deepEqual(selectChanged([file]).groups,['verificationRuntime']);
 const runtime=aliasPlan('verificationRuntime');
 for(const need of ['engine','runtimeStorage','mixedRuntimeStorage'])assert.ok(requirements(runtime).includes(need));
 assert.ok(missingPrerequisites(runtime,{}).some(reason=>reason.startsWith('GITJIG_MIXED_RUNTIME_ROOT:')));
 assert.equal(feedbackBudgetMs(runtime),480000);assert.equal(feedbackBudgetMs({groups:['integrated','verificationRuntime']}),600000);
 const shared=selectChanged(['tests/workflow/current-verification-fixture.mjs']);assert.equal(shared.crosscut,true);assert.ok(shared.groups.includes('verificationRuntime'));
 const args=feedbackCommands(runtime).find(c=>c.kind==='focused').args;
 for(const consumer of ['tests/controller/verification-cases-nit.test.mjs','tests/controller/bounded-drive-nit-runtime.test.mjs','tests/workflow/mixed-verification-runtime.test.mjs','tests/workflow/core-runtime.test.mjs','tests/controller/verification-case-amendment.test.mjs','tests/controller/interaction-runtime.test.mjs','tests/controller/application-derived-native.test.mjs'])assert.ok(args.includes(consumer));
 const legacy=selectChanged(['tests/controller/legacy-assignment-outcome-fixture.mjs']);assert.ok(legacy.groups.includes('lifecycleConvergence'));assert.ok(legacy.groups.includes('sdk'));
});


test('live role input and delivery attention retain their actual SDK, engine and terminal consumers',()=>{
 for(const file of ['src/controller/input-context.ts','tests/controller/role-input-context.test.mjs','tests/controller/role-input-context-worker.mjs']){
  const plan=selectChanged([file]);for(const group of ['unit','sdk','verificationRuntime'])assert.ok(plan.groups.includes(group));
  const args=feedbackCommands(plan).filter(command=>command.kind==='focused').flatMap(command=>command.args);
  for(const consumer of ['tests/controller/role-input-context.test.mjs','tests/controller/input-context.test.mjs','tests/ui/reviewer-pty.test.mjs'])assert.equal(args.filter(arg=>arg===consumer).length,1);
 }
 for(const file of ['src/controller/input-recovery.ts','tests/controller/input-delivery-status.test.mjs','tests/ui/input-delivery-attention-pty.test.mjs']){
  const plan=selectChanged([file]);assert.ok(plan.groups.includes('unit')&&plan.groups.includes('ui'));
  const args=feedbackCommands(plan).filter(command=>command.kind==='focused').flatMap(command=>command.args);
  for(const consumer of ['tests/controller/input-delivery-status.test.mjs','tests/ui/input-delivery-attention-pty.test.mjs'])assert.equal(args.filter(arg=>arg===consumer).length,1);
 }
});
