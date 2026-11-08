import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {checkout, inventory, offlineSourceInstallation} from './offline-source-fixture.mjs';
// One fresh package, actual Pi inputs and public cancellation; no application SQL seed.
test('fresh installed ordinary root restores admission and separately renews its retained lineage ceiling',{timeout:180000},async t=>{
 const installed=await offlineSourceInstallation(t,'ordinary-recovery');
 const {root,home,env:base,run,payload,groups}=installed;
 const project=path.join(root,'project'),receiver=path.join(root,'receiver.git');
 await fs.mkdir(project,{mode:0o700});
 const git=await fs.realpath(process.env.GITJIG_TEST_GIT_BINARY??'/opt/homebrew/bin/git'),gitEnv={...base,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};await fs.writeFile(path.join(project,'file.txt'),'Owned original basis');await run(git,['init','--initial-branch=main',project],'git-init',{environment:gitEnv});await run(git,['-C',project,'add','file.txt'],'git-add',{environment:gitEnv});await run(git,['-C',project,'-c','commit.gpgsign=false','commit','-m','Owned fixture basis'],'git-commit',{environment:gitEnv});const basis=(await run(git,['-C',project,'rev-parse','HEAD'],'git-head',{environment:gitEnv})).trim();await run(git,['clone','--bare','--template=',project,receiver],'git-clone',{environment:gitEnv});await run(git,['--git-dir='+receiver,'config','--remove-section','remote.origin'],'git-config',{environment:gitEnv});
 const readNative=(args,label)=>run(git,args,label,{environment:gitEnv});
 const expectedRef=basis+' refs/heads/main\n';
 assert.equal(await readNative(['--git-dir='+receiver,'show-ref'],'receiver-before'),expectedRef);
 const driver=path.join(root,'driver.mjs'),hook=path.join(root,'installed-only.mjs'),trace=path.join(root,'resolved.jsonl'),launches=path.join(root,'launches.jsonl');await fs.copyFile(path.join(checkout,'tests/installation/ordinary-recovery-driver.mjs'),driver);
 await fs.writeFile(hook,`
import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import net from 'node:net';import wt from 'node:worker_threads';import {fileURLToPath,pathToFileURL} from 'node:url';import {registerHooks,syncBuiltinESMExports} from 'node:module';
const payload=fs.realpathSync(process.env.GITJIG_INSTALLED_PAYLOAD),mode=process.env.GITJIG_INSTALLED_MODE;let forbidden=0;const deny=()=>{forbidden++;throw Error('Installed ordinary recovery forbids source fallback, network, worker or unowned execution');};globalThis.fetch=deny;net.Socket.prototype.connect=deny;const spawn=cp.spawn;for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=deny;cp.spawn=(binary,args,...rest)=>{if(mode!=='seed'||binary!==process.execPath||args[0]!==path.join(payload,'dist/effects/git-process-child.js'))return deny();fs.appendFileSync(process.env.GITJIG_INSTALLED_LAUNCHES,JSON.stringify(args[0])+'\\n');return spawn(binary,args,...rest);};wt.Worker=class{constructor(){deny();}};syncBuiltinESMExports();
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('file:')){const file=fs.realpathSync(fileURLToPath(result.url));if(!file.startsWith(payload+path.sep)){if(!context.parentURL&&file===process.env.GITJIG_INSTALLED_DRIVER)return result;return deny();}fs.appendFileSync(process.env.GITJIG_INSTALLED_TRACE,JSON.stringify(file)+'\\n');}return result;}});
if(mode==='ui'){const {Ordinary}=await import(pathToFileURL(path.join(payload,'dist/controller/ordinary.js')).href);for(const name of ['run','resumeAuthorized'])Ordinary.prototype[name]=deny;}
process.on('exit',()=>{if(forbidden)process.exitCode=1;});
`,{mode:0o600});
 const env={...base,GITJIG_INSTALLED_PAYLOAD:payload,GITJIG_INSTALLED_ROOT:root,GITJIG_INSTALLED_DRIVER:driver,GITJIG_INSTALLED_TRACE:trace,GITJIG_INSTALLED_LAUNCHES:launches,GITJIG_INSTALLED_BASIS:basis,GITJIG_TEST_GIT_BINARY:git};
 await run(process.execPath,['--import',hook,driver],'seed',{environment:{...env,GITJIG_INSTALLED_MODE:'seed'},timeout:15000});const original=JSON.parse(await fs.readFile(path.join(root,'original.json'),'utf8')),beforeLaunches=await fs.readFile(launches,'utf8'),database=path.join(home,'state/controller.sqlite'),draft='KEEP 한국어';
 const workEnter=[{wait:'Work recovery · #',send:'Review original conversation admission\r'},{wait:'Owner reason to recover original conversation admission',send:'Keep original installed admission\r'},{wait:'Review exact original conversation admission',send:'\r'}];
 const unchanged=[{sql:'SELECT state,epoch FROM works WHERE id=?',params:[original.work.id],rows:[['CANCELLED',original.work.epoch]]},{sql:'SELECT epoch FROM effect_delegations WHERE id=?',params:[original.grant.id],rows:[[original.grant.epoch]]}];
 const sameExecution=[
  {sql:'SELECT * FROM budgets ORDER BY rowid',rows:original.budgets.map(Object.values)},
  {sql:'SELECT * FROM runs ORDER BY rowid',rows:original.runs.map(Object.values)},
 ];
 const recovered=[
  {sql:'SELECT state,epoch FROM works WHERE id=?',params:[original.work.id],rows:[['ACTIVE',original.work.epoch+1]]},
  unchanged[1],
  ...sameExecution,
 ];
 const renewalEnter=[{wait:'Integration delegation · select original owner work',send:original.work.id+'\r'},{wait:'Original integration delegation held',send:'\x1b'},{wait:'Original grant is stale',send:'Review renewal of this original grant\r'},{wait:'Owner reason to renew the same integration grant',send:'Keep original installed ceiling\r'},{wait:'Review exact original grant renewal',send:'\r'}];
 const steps=[
  {wait:'Model: not selected',send:draft+'\x07t'},
  {wait:'Setup and next actions',send:'More settings and details\r'},
  {wait:'More settings and details · current and saved configuration',send:'Work recovery\r'},
  {wait:'Original work and allowances',send:original.work.id+'\r'},
  ...workEnter,
  {wait:'Confirm original conversation admission recovery',queries:unchanged,send:'Back without recovery\r'},
  {wait:'Work recovery · #',send:'Review original conversation admission\r'},
  {wait:'Owner reason to recover original conversation admission',send:'\x1b'},
  ...workEnter,
  {wait:'Confirm original conversation admission recovery',queries:unchanged,send:'Recover this original conversation admission\r'},
  {wait:'More settings and details · current and saved configuration',queries:recovered,send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Integration targets\r'},
  {wait:'Integration targets · retained observations',send:original.targetId+'\r'},
  {wait:'Original integration target · actions',send:'Delegate ordinary integration to owner work\r'},
  ...renewalEnter,
  {wait:'Confirm exact original grant renewal',queries:recovered,assertDraft:draft,send:'Back without renewal\r'},
  ...renewalEnter.slice(0,3),
  {wait:'Owner reason to renew the same integration grant',send:'\x1b'},
  ...renewalEnter,
  {wait:'Confirm exact original grant renewal',queries:recovered,assertDraft:draft,send:'Renew this original grant\r'},
  {wait:'Original integration grant renewed',queries:[
   {sql:'SELECT epoch FROM effect_delegations WHERE id=?',params:[original.grant.id],rows:[[original.grant.epoch+1]]},
   ...sameExecution,
  ],send:'\x1b'},
  {wait:'Integration delegation · select original owner work',send:'Back\r'},
  {wait:'Integration targets · retained observations',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'More settings and details · current and saved configuration',send:'Return to request\r'},
  {wait:draft,assertDraft:draft,send:'\x15/quit\x1b\r'},
 ];
 const cfg=path.join(root,'terminal.json');await fs.writeFile(cfg,JSON.stringify({command:[process.execPath,'--import',hook,path.join(payload,'dist/cli/entry.js'),'conversation','ui','--conversation',original.conversationId],env:{...env,GITJIG_INSTALLED_MODE:'ui'},steps,timeoutSeconds:12,gracefulShutdownSeconds:2,expectedInputs:1,database,output:cfg+'.terminal'}));
 const terminal=JSON.parse(await run('/usr/bin/python3',[path.join(checkout,'tests/cli/fork-ui-pty.py'),cfg],'terminal',{timeout:16000}));assert.equal(terminal.exitCode,0);assert.equal(terminal.stages,steps.length);assert.equal(terminal.terminalRestored,true);assert.equal(await fs.readFile(launches,'utf8'),beforeLaunches);
 const records=()=>{const db=new DatabaseSync(database,{readOnly:true});try{return ['works','sources','runs','budgets','effect_delegations','effect_operations','effect_receipts','conversation_inputs','conversation_state'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());}finally{db.close();}};
 const before=records();await run(process.execPath,['--import',hook,driver],'inspect',{environment:{...env,GITJIG_INSTALLED_MODE:'inspect'}});assert.deepEqual(records(),before);await run(process.execPath,['--import',hook,driver],'continue',{environment:{...env,GITJIG_INSTALLED_MODE:'continue'},timeout:15000});assert.equal(await fs.readFile(launches,'utf8'),beforeLaunches);
 const resolved=(await fs.readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(resolved.every(file=>file.startsWith(payload+path.sep)));for(const file of ['dist/controller/ordinary.js','dist/controller/work-recovery.js','dist/controller/integration-delegation.js','dist/ui/work-commands.js','dist/ui/integration-delegation-browser.js'])assert.ok(resolved.includes(path.join(payload,file)),file+' actual installed import');assert.equal(groups.size,0);
 assert.equal(await readNative(['--git-dir='+receiver,'show-ref'],'receiver-after'),expectedRef);
 await installed.assertCurrent();
 assert.deepEqual(await inventory(payload),installed.payloadBefore,'Installed payload changed during ordinary recovery');
 installed.pass();
});
