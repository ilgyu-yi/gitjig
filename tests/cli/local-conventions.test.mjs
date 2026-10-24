import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile),git=(await execute('/usr/bin/which',['git'])).stdout.trim();
async function fixture(t){
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/local-conventions-'))),source=path.join(root,'source'),home=path.join(root,'home'),profile=path.join(root,'rules.json'),message=path.join(source,'commit-message');
 let accepted=false;t.after(async()=>{if(accepted)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained local conventions fixture '+root);});await fs.mkdir(source);
 const native=async(...args)=>(await execute(git,args,{cwd:source,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout;
 const cli=async(args,env={})=>{try{return {code:0,...await execute(process.execPath,['--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),...args],{timeout:15000,env:{...process.env,...env}})};}catch(e){if(typeof e.code==='number')return {code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}};
 await native('init','-b','feat/local');await native('config','user.name','Local Developer');await native('config','user.email','local@example.invalid');await fs.writeFile(path.join(source,'answer'),'original');await native('add','answer');await native('commit','-m','initial');await fs.writeFile(path.join(source,'answer'),'changed');await native('add','answer');
 assert.equal((await cli(['project','register','--home',home,'--id','p','--root',source])).code,0);
 await fs.mkdir(path.join(home,'config'),{mode:0o700});await fs.writeFile(path.join(home,'config/startup.json'),'{broken',{mode:0o600});
 const rules={protectedBranches:['main'],branchPrefixes:['feat/'],commitTypes:['feat','fix'],subjectMaxLength:40,requireBody:true};
 const configure=async(revision=0,chosen=rules)=>{await fs.writeFile(profile,JSON.stringify(chosen),{mode:0o600});return cli(['local','configure','--home',home,'--project','p','--revision',String(revision),'--profile',profile]);};
 const inspect=()=>cli(['local','conventions','--home',home,'--project','p']);
 const prepare=async(text='feat(local)!: Keep intent\n\nExplain the change.\n',binary=git)=>{await fs.writeFile(message,text,{mode:0o600});return cli(['local','prepare','--home',home,'--project','p','--git-binary',binary,'--message-file',message]);};
 return {root,source,home,profile,message,rules,native,cli,configure,inspect,prepare,accept:()=>{accepted=true;}};
}
test('developer configures and prepares real staged work with original CLI; optional recommendations never silently apply',async t=>{
 const f=await fixture(t),absent=JSON.parse((await f.inspect()).stdout);assert.equal(absent.state,'NOT_CONFIGURED');assert.equal(absent.rules,null);assert.equal(absent.revision,0);
 const unopened=path.join(f.root,'unopened-home'),recommendation=await f.cli(['local','recommend'],{GITJIG_HOME:unopened});assert.equal(recommendation.code,0,recommendation.stderr);assert.equal(JSON.parse(recommendation.stdout).subjectMaxLength,72);await assert.rejects(fs.access(unopened),{code:'ENOENT'});
 const before=await f.prepare();assert.equal(before.code,2);assert.equal(JSON.parse(before.stdout).status,'UNAVAILABLE');
 const configured=await f.configure();assert.equal(configured.code,0,configured.stderr);const policy=JSON.parse(configured.stdout);assert.equal(policy.revision,1);assert.deepEqual(policy.rules,f.rules);
 const files=['index','HEAD','config'],original=await Promise.all(files.map(name=>fs.readFile(path.join(f.source,'.git',name))));
 const ready=await f.prepare();assert.equal(ready.code,0,ready.stderr);const report=JSON.parse(ready.stdout);assert.equal(report.status,'PASS');assert.equal(report.policy.hash,policy.hash);assert.equal(report.policy.revision,1);assert.equal(report.checks.length,9);assert.ok(report.checks.every(c=>c.status==='PASS'));assert.match(report.scope,/not test evidence/);assert.equal(report.message.hasBody,true);assert.equal(report.message.sha256.length,64);assert.equal(report.observation.id.length,64);assert.ok(!ready.stdout.includes('Explain the change.'));
 for(let i=0;i<files.length;i++)assert.deepEqual(await fs.readFile(path.join(f.source,'.git',files[i])),original[i]);
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{for(const table of ['works','sources','runs','role_launches','effect_operations'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);}finally{db.close();}
 const stale=await f.configure(0);assert.equal(stale.code,2);assert.match(stale.stderr,/revision changed/);assert.equal(JSON.parse((await f.inspect()).stdout).revision,1);
 const bad=await f.configure(1,{...f.rules,branchPrefixes:['feat/*']});assert.equal(bad.code,2);assert.match(bad.stderr,/glob syntax/);assert.equal(JSON.parse((await f.inspect()).stdout).revision,1);
 f.accept();
});
test('actual unborn named branch can prepare, while real unmerged stages and oversized/special message inputs refuse',async t=>{
 const f=await fixture(t);assert.equal((await f.configure()).code,0);
 await f.native('checkout','--orphan','feat/unborn');const unborn=await f.prepare();assert.equal(unborn.code,0,unborn.stderr);assert.equal(JSON.parse(unborn.stdout).observation.head,'(initial)');
 await f.native('checkout','-f','feat/local');await f.native('checkout','-b','feat/other');await fs.writeFile(path.join(f.source,'answer'),'other');await f.native('commit','-am','other');await f.native('checkout','feat/local');await fs.writeFile(path.join(f.source,'answer'),'base-side');await f.native('commit','-am','base-side');await assert.rejects(f.native('merge','feat/other'));
 const conflict=await f.prepare();assert.equal(conflict.code,1);assert.ok(JSON.parse(conflict.stdout).checks.some(c=>c.rule==='unmerged-paths'&&c.status==='FAIL'));
 await fs.writeFile(f.message,'x'.repeat(64*1024+1));const large=await f.cli(['local','prepare','--home',f.home,'--project','p','--git-binary',git,'--message-file',f.message]);assert.equal(large.code,2);assert.match(large.stderr,/64 KiB/);
 await fs.unlink(f.message);await execute('/usr/bin/mkfifo',[f.message]);const special=await f.cli(['local','prepare','--home',f.home,'--project','p','--git-binary',git,'--message-file',f.message]);assert.equal(special.code,2);assert.match(special.stderr,/owned regular file/);
 f.accept();
});
test('configured predicates detect real failures and custom exemptions without agent review',async t=>{
 const f=await fixture(t);assert.equal((await f.configure()).code,0);
 const failed=async(text,rule)=>{const r=await f.prepare(text);assert.equal(r.code,1,r.stderr);assert.ok(JSON.parse(r.stdout).checks.some(c=>c.rule===rule&&c.status==='FAIL'),rule);};
 await failed('fix: '+ 'x'.repeat(40)+'\n\nBody','subject-length');await failed('docs: Explain\n\nBody','commit-type');await failed('fix: Explain\n\n \n','message-body');await failed('fix: Explain\nBody','message-format');await failed('\ufefffix: Explain\n\nBody','message-format');await failed('fix: Explain\t\n\nBody','message-format');
 assert.equal((await f.prepare('fix: '+ '😀'.repeat(10)+'\r\n\r\nLiteral # body\r\n')).code,0);
 await f.native('checkout','-b','main');await failed('fix: Explain\n\nBody','protected-branch');await f.native('checkout','-b','feature/not-a-prefix');await failed('fix: Explain\n\nBody','branch-prefix');
 assert.equal((await f.configure(1,{protectedBranches:[],branchPrefixes:[],commitTypes:[],subjectMaxLength:256,requireBody:false})).code,0);assert.equal((await f.prepare('A free subject')).code,0);
 await f.native('reset','HEAD','answer');await failed('A free subject','staged-change');await f.native('checkout','--detach');const detached=await f.prepare('A free subject');assert.equal(detached.code,1);assert.ok(JSON.parse(detached.stdout).checks.some(c=>c.rule==='protected-branch'&&c.status==='UNAVAILABLE'));
 f.accept();
});
test('raw policy/message drift, unsafe messages and replacement roots are unavailable rather than false preparation passes',async t=>{
 const f=await fixture(t);assert.equal((await f.configure()).code,0);
 const policyFile=path.join(f.home,'config/local-conventions-p.json');
 for(const target of [policyFile,f.message]){
  const flag=path.join(f.root,'once-'+path.basename(target)),driver=path.join(f.root,'driver-'+path.basename(target)+'.cjs');
  await fs.writeFile(driver,`#!${process.execPath}\nconst {spawnSync}=require('node:child_process'),fs=require('node:fs');const args=process.argv.slice(2),r=spawnSync(${JSON.stringify(git)},args,{env:process.env});if(args.includes('status')&&!fs.existsSync(${JSON.stringify(flag)})){fs.writeFileSync(${JSON.stringify(flag)},'once');fs.appendFileSync(${JSON.stringify(target)},'\\n');}process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;\n`,{mode:0o700});
  const result=await f.prepare(undefined,driver);assert.equal(result.code,2,result.stdout);assert.equal(result.stdout,'');assert.match(result.stderr,/changed during/);
 }
 await fs.writeFile(f.message,Buffer.from([255]));const raw=await f.cli(['local','prepare','--home',f.home,'--project','p','--git-binary',git,'--message-file',f.message]);assert.equal(raw.code,2);assert.match(raw.stderr,/valid UTF-8/);
 await fs.unlink(f.message);await fs.symlink(f.profile,f.message);const alias=await f.cli(['local','prepare','--home',f.home,'--project','p','--git-binary',git,'--message-file',f.message]);assert.equal(alias.code,2);assert.match(alias.stderr,/without symlinks/);await fs.unlink(f.message);
 const missing=await f.cli(['local','prepare','--home',f.home,'--project','p','--git-binary',git,'--message-file',f.message]);assert.equal(missing.code,2);assert.match(missing.stderr,/LOCAL_PREPARATION_UNAVAILABLE/);assert.match(missing.stderr,/recovery/);
 await fs.writeFile(f.message,'fix: Readable\n\nBody',{mode:0o600});await fs.chmod(f.message,0);const unreadable=await f.cli(['local','prepare','--home',f.home,'--project','p','--git-binary',git,'--message-file',f.message]);assert.equal(unreadable.code,2);assert.match(unreadable.stderr,/LOCAL_PREPARATION_UNAVAILABLE/);assert.match(unreadable.stderr,/recovery/);await fs.chmod(f.message,0o600);
 const saved=await fs.readFile(policyFile);for(const malformed of ['{broken',saved.toString().replace('"revision": 1','"revision": 1, "revision": 1'),Buffer.from([123,34,255,34,58,49,125])]){await fs.writeFile(policyFile,malformed);const invalid=await f.inspect();assert.equal(invalid.code,2);assert.match(invalid.stderr,/invalid, unsafe or oversized/);}await fs.writeFile(policyFile,saved);
 await fs.rename(f.source,f.source+'-old');const unavailable=await f.inspect();assert.equal(unavailable.code,2);assert.match(unavailable.stderr,/LOCAL_CONVENTIONS_UNAVAILABLE/);assert.match(unavailable.stderr,/recovery/);await fs.mkdir(f.source);const replaced=await f.inspect();assert.equal(replaced.code,2);assert.match(replaced.stderr,/no longer match/);
 f.accept();
});
