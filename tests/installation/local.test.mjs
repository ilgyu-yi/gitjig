import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
// Actual npm installation and installed entry. Prior command success is explicitly synthetic.
// No source product imports/loaders, paid model, personal prefix or engine provisioning.
test('installed local entry preserves original synthetic check through stale refusal, terminal receipt, native commit and historical audit',{timeout:150000},async t=>{
 const checkout=await fs.realpath('.'),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-installed-local-'))),prefix=path.join(root,'prefix with spaces'),home=path.join(root,'application'),user=path.join(root,'user'),cwd=path.join(root,'outside checkout'),project=path.join(root,'project'),message=path.join(root,'private-message'),profile=path.join(root,'private-profile.json');
 assert.ok(root!==checkout&&!root.startsWith(checkout+path.sep));for(const dir of [user,cwd,project])await fs.mkdir(dir,{mode:0o700});const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:user,USER:'gitjig-owned-fixture',LOGNAME:'gitjig-owned-fixture',LANG:'C.UTF-8',TERM:'xterm-256color',SHELL:'/bin/sh',TMPDIR:root,GITJIG_HOME:home,NODE_OPTIONS:'',NODE_PATH:''},groups=new Set();let passed=false;
 const absent=pid=>{try{process.kill(-pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}};
 const run=async(binary,args,label,{expected=0,timeout=10000,environment=env,workdir=cwd}={})=>{
  const child=spawn(binary,args,{cwd:workdir,env:environment,detached:true,stdio:['ignore','pipe','pipe']});if(child.pid)groups.add(child.pid);let out='',err='',bytes=0,expired=false,overflow=false;
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
  const timer=setTimeout(()=>{expired=true;kill();},timeout),collect=(chunk,stderr)=>{bytes+=chunk.length;if(bytes>4*1024*1024){overflow=true;kill();}else if(stderr)err+=chunk;else out+=chunk;};child.stdout.on('data',b=>collect(b,false));child.stderr.on('data',b=>collect(b,true));
  let result;try{result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(timer);}
  await fs.writeFile(path.join(root,label+'.result.json'),JSON.stringify({label,pid:child.pid,...result,expired,overflow,out,err}),{mode:0o600});assert.equal(expired,false,label+' deadline');assert.equal(overflow,false,label+' output cap');assert.equal(result.signal,null,err);assert.equal(result.code,expected,label+' '+err+out);assert.equal(absent(child.pid),true,label+' process group settled');groups.delete(child.pid);return out;
 };
 t.after(async()=>{for(const pid of groups)if(!absent(pid))try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained installed local fixture: '+root);});
 await run(process.execPath,[path.join(checkout,'install.mjs'),'--prefix',prefix],'install',{timeout:100000,environment:{...env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,npm_config_offline:'true',npm_config_cache:process.env.npm_config_cache??path.join(os.homedir(),'.npm'),npm_config_userconfig:path.join(root,'empty-npmrc')}});
 const command=path.join(prefix,'bin/gitjig'),payload=path.join(prefix,'lib/node_modules/gitjig');assert.ok((await fs.realpath(command)).startsWith(payload+path.sep));
 for(const file of ['dist/cli/entry.js','dist/controller/local-candidate.js','dist/controller/local-evidence.js','dist/controller/capture.js','dist/controller/capture-worker.js','dist/ui/local-commands.js','dist/ui/local-check-commands.js','dist/ui/local-evidence-commands.js','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md','docs/local-development.md','LICENSE'])assert.deepEqual(await fs.readFile(path.join(payload,file)),await fs.readFile(path.join(checkout,file)),file+' current installed bytes');
 for(const file of ['src','tests','development','.git','node_modules/typescript'])await assert.rejects(fs.access(path.join(payload,file)),{code:'ENOENT'});
 const dependencies=['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-tui','@gitjig/pi-claude-bridge-host'],resolved=JSON.parse(await run(process.execPath,['--input-type=module','-e','console.log(JSON.stringify('+JSON.stringify(dependencies)+'.map(name=>import.meta.resolve(name))))'],'installed-dependencies',{workdir:payload}));for(const uri of resolved)assert.ok((await fs.realpath(fileURLToPath(uri))).startsWith(payload+'/node_modules/'));
 const git=await fs.realpath((await run('/usr/bin/which',['git'],'find-git',{environment:{...env,PATH:process.env.PATH}})).trim()),native=(args,label)=>run(git,args,label,{workdir:project,environment:{...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}});await native(['init','-b','feat/installed-local'],'git-init');await native(['config','user.name','Installed Fixture'],'git-name');await native(['config','user.email','fixture@example.invalid'],'git-email');await fs.writeFile(path.join(project,'한글.txt'),'base\n');await native(['add','.'],'git-add-base');await native(['commit','-m','Base'],'git-base');await fs.writeFile(path.join(project,'한글.txt'),'checked source\n');await native(['add','.'],'git-add');await fs.writeFile(message,'Implement local correspondence\n\nPRIVATE_INSTALLED_MESSAGE_BODY\n',{mode:0o600});
 let serial=0;const cli=async(args,options={})=>JSON.parse(await run(command,args,'cli-'+serial++,options));await cli(['project','register','--id','p','--root',project]);await fs.writeFile(profile,JSON.stringify(await cli(['local','recommend'])),{mode:0o600});await cli(['local','configure','--project','p','--revision','0','--profile',profile]);const prepared=await cli(['local','prepare','--project','p','--git-binary',git,'--message-file',message]);assert.equal(prepared.status,'PASS');
 const absentFolder=path.join(home,'local-candidates');assert.deepEqual((await cli(['local','candidates','--project','p'])).candidates,[]);await assert.rejects(fs.lstat(absentFolder),{code:'ENOENT'});
 const probe=path.join(root,'seed.mjs');await fs.copyFile(path.join(checkout,'tests/installation/local-seed.mjs'),probe);const seed=JSON.parse(await run(process.execPath,[probe,payload,home,project],'synthetic-prior'));assert.ok(seed.installedWorker.startsWith(payload+path.sep));assert.equal(seed.fixtureAuthored.includes('result status'),true);
 const dbRead=callback=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{return callback(db);}finally{db.close();}},tables=['works','sources','requirements','runs','budgets','results','observations','capacity_leases'],query=table=>'SELECT * FROM '+table+(table==='sources'?" WHERE id='installed-prior-source'":'')+' ORDER BY rowid',snapshot=()=>dbRead(db=>tables.map(table=>db.prepare(query(table)).all())),original=snapshot();
 const stableQueries=dbRead(db=>tables.map(table=>({sql:query(table),rows:db.prepare(query(table)).all().map(row=>Object.values(row))})));
 await fs.writeFile(path.join(project,'한글.txt'),'stale source\n');const stale=await cli(['local','evidence','--project','p','--work',seed.ids.workId,'--git-binary',git],{expected:1});assert.equal(stale.status,'STALE');assert.equal(stale.sourceMatches,false);
 await run(command,['local','candidate','--project','p','--work',seed.ids.workId,'--git-binary',git,'--message-file',message],'stale-candidate',{expected:2});assert.deepEqual((await cli(['local','candidates','--project','p'])).candidates,[]);assert.deepEqual(snapshot(),original);await fs.writeFile(path.join(project,'한글.txt'),'checked source\n');
 const terminal=async(label,steps)=>{const file=path.join(root,label+'.json');await fs.writeFile(file,JSON.stringify({command:[command],env,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}),{mode:0o600});const result=JSON.parse(await run('/usr/bin/python3',[path.join(checkout,'tests/cli/fork-ui-pty.py'),file],label,{timeout:23000}));assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(output,/PRIVATE_INSTALLED_MESSAGE_BODY/);return output;};
 const recordSteps=[
  {wait:'Model: not selected',send:'/project p\x1b\r'},
  {wait:'Project selected: p',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],send:'/local\x1b\r'},
  {wait:'Local development',send:'Run new isolated check\r'},
  {wait:'Local check unavailable',queries:stableQueries,send:'\x1b'},
  {wait:'Local development',send:'Retained local checks\r'},
  {wait:'Retained local checks',send:'DELIVERED\r'},
  {wait:'Original local check',send:'Inspect current check correspondence\r'},
  {wait:'Trusted Git executable',send:'\x15'+git+'\r'},
  {wait:'Original source/index correspondence',queries:stableQueries,send:'\x1b'},
  {wait:'Original local check',send:'Record exact commit candidate\r'},
  {wait:'Trusted Git executable',send:'\x15'+git+'\r'},
  {wait:'Owned exact commit message file',send:message+'\r'},
  {wait:'Review exact candidate recording',send:'\x1b'},
  {wait:'Explicit candidate recording',send:'Record exact candidate\r'},
  {wait:'Exact candidate retained',queries:stableQueries,send:'\x1b'},
  {wait:'Original local check',send:'Back\r'},
  {wait:'Retained local checks',send:'Back\r'},
  {wait:'Local development',send:'Close\r'},
  {wait:'INPUT',assertDraft:'/local',send:'\x15/quit\x1b\r'},
 ];
 const recordOutput=await terminal('installed-record-ui',recordSteps);assert.match(recordOutput,/CURRENT/);const candidates=await cli(['local','candidates','--project','p']);assert.equal(candidates.candidates.length,1);const id=candidates.candidates[0].candidateId,receipt=path.join(absentFolder,id+'.json'),receiptBytes=await fs.readFile(receipt);assert.match(recordOutput,new RegExp(id));assert.equal(JSON.parse(receiptBytes).check.runId,seed.ids.runId);assert.deepEqual(snapshot(),original);
 await native(['commit','--cleanup=verbatim','-F',message],'native-commit');const committed=(await native(['rev-parse','HEAD'],'head-committed')).trim();
 const auditSteps=[
  {wait:'Model: not selected',send:'\x15/local\x1b\r'},
  {wait:'Local development',send:'Retained candidates and commit audit\r'},
  {wait:'Retained candidates',send:'Candidate\r'},
  {wait:'Original candidate',send:'Inspect original candidate\r'},
  {wait:'Original candidate · historical preparation',queries:stableQueries,send:'\x1b'},
  {wait:'Retained candidates',send:'Candidate\r'},
  {wait:'Original candidate',send:'Audit native commit\r'},
  {wait:'Trusted Git executable',send:'\x15'+git+'\r'},
  {wait:'Explicit native commit reference',send:'\x15HEAD\r'},
  {wait:'Review historical commit audit',send:'\x1b'},
  {wait:'Explicit commit audit',send:'Audit selected commit\r'},
  {wait:'Historical native commit correspondence · MATCH',queries:stableQueries,send:'\x1b'},
  {wait:'Retained candidates',send:'Back\r'},
  {wait:'Local development',send:'Close\r'},
  {wait:'INPUT',assertDraft:'/local',send:'\x15/quit\x1b\r'},
 ];
 const auditOutput=await terminal('installed-audit-ui',auditSteps);assert.match(auditOutput,/Historical native commit correspondence · MATCH/);const healthy=await cli(['local','audit','--project','p','--candidate',id,'--commit',committed,'--git-binary',git]);assert.equal(healthy.status,'MATCH');assert.equal(healthy.candidateId,id);assert.equal(healthy.actual.oid,committed);assert.equal(healthy.expected.check.runId,seed.ids.runId);assert.equal((await native(['rev-parse','HEAD'],'head-after-ui')).trim(),committed);
 await fs.writeFile(path.join(project,'.git/hooks/pre-commit'),'#!/bin/sh\ngit rm -f -- "한글.txt"\n',{mode:0o700});await native(['commit','--amend','--cleanup=verbatim','-F',message],'native-hook-amend');const changed=(await native(['rev-parse','HEAD'],'head-changed')).trim(),mismatch=await cli(['local','audit','--project','p','--candidate',id,'--commit',changed,'--git-binary',git],{expected:1});assert.equal(mismatch.status,'MISMATCH');assert.equal(mismatch.checks.wholeTree,false);assert.equal(mismatch.checks.message,true);assert.equal(mismatch.checks.parents,true);assert.equal((await native(['rev-parse','HEAD'],'head-retained')).trim(),changed);assert.deepEqual(await fs.readFile(receipt),receiptBytes);assert.deepEqual(snapshot(),original);
 dbRead(db=>{const scopeSources=db.prepare("SELECT origin FROM sources WHERE id!='installed-prior-source'").all();assert.equal(scopeSources.length,1);assert.equal(JSON.parse(scopeSources[0].origin).kind,'owner-scope-transition');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM role_launches').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversation_inputs').get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM capacity_leases WHERE state!='RELEASED'").get().n,0);});assert.deepEqual((await fs.readdir(path.join(home,'inputs'))).filter(name=>name.startsWith('local-evidence-')),[]);
 await fs.writeFile(path.join(root,'scope.json'),JSON.stringify({seed,candidateId:id,committed,changed,scope:'Actual npm installed CLI/UI, capture worker, source correspondence, receipt and historical native Git audit. Prior successful command/cleanup/capacity statuses are synthetic. Not actual-engine, model, live hosting or immutable offline-bundle qualification.'}),{mode:0o600});passed=true;
});
