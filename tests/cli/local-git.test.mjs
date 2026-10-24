import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile),git=(await execute('/usr/bin/which',['git'])).stdout.trim();
async function fixture(t){
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/local-git-'))),source=path.join(root,'source'),home=path.join(root,'home');
 await fs.mkdir(source);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const native=async(...args)=>(await execute(git,args,{cwd:source,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout;
 await native('init','-b','main');await native('config','user.name','Local Developer');await native('config','user.email','local@example.invalid');
 const cli=async(args,env={})=>{try{return {code:0,...await execute(process.execPath,['--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),...args],{timeout:15000,env:{...process.env,...env}})};}catch(e){if(typeof e.code==='number')return {code:e.code,stdout:e.stdout,stderr:e.stderr};throw e;}};
 assert.equal((await cli(['project','register','--home',home,'--id','p','--root',source])).code,0);
 const inspect=(extra=[],env={})=>cli(['local','git','--home',home,'--project','p','--git-binary',git,...extra],env);
 return {root,source,home,native,cli,inspect};
}
test('actual local CLI reads exact staged/unstaged/rename paths and pinned history without startup, SDK, works or repository mutation',async t=>{
 const f=await fixture(t);const odd='한국어 name\nline.txt';await fs.writeFile(path.join(f.source,odd),'original\n');await fs.writeFile(path.join(f.source,'old'),'rename\n');await f.native('add','.');await f.native('commit','-m','Initial local history');
 await f.native('mv','old','new');await fs.writeFile(path.join(f.source,odd),'edited\n');await fs.writeFile(path.join(f.source,'untracked'),'new');
 await fs.mkdir(path.join(f.home,'config'),{mode:0o700});await fs.writeFile(path.join(f.home,'config/startup.json'),'{broken',{mode:0o600});
 const files=['index','HEAD','config'],before=await Promise.all(files.map(n=>fs.readFile(path.join(f.source,'.git',n))));
 const actual=await f.inspect([],{GIT_DIR:'/does/not/exist',GIT_WORK_TREE:'/wrong',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.worktree',GIT_CONFIG_VALUE_0:'/wrong'});assert.equal(actual.code,0,actual.stderr);const view=JSON.parse(actual.stdout);
 assert.equal(view.branch,'main');assert.equal(view.commits[0].subject,'Initial local history');assert.equal(view.commits[0].commit,view.head);
 assert.ok(view.changes.some(c=>c.path===odd&&c.index==='.'&&c.worktree==='M'));assert.ok(view.changes.some(c=>c.path==='new'&&c.originalPath==='old'&&c.index==='R'));assert.ok(view.changes.some(c=>c.path==='untracked'&&c.kind==='untracked'));
 assert.match(view.observation,/non-atomic/);for(let i=0;i<files.length;i++)assert.deepEqual(await fs.readFile(path.join(f.source,'.git',files[i])),before[i]);
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{for(const table of ['works','sources','runs','role_launches','effect_operations'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table);}finally{db.close();}
 await f.native('checkout','--detach');const detached=await f.inspect();assert.equal(detached.code,0,detached.stderr);assert.equal(JSON.parse(detached.stdout).branch,'(detached)');
});
test('unborn worktree, actual conflict and linked worktree retain their distinct Git states; nested roots refuse',async t=>{
 const f=await fixture(t);const unborn=await f.inspect();assert.equal(unborn.code,0,unborn.stderr);assert.equal(JSON.parse(unborn.stdout).head,'(initial)');assert.deepEqual(JSON.parse(unborn.stdout).commits,[]);
 await fs.writeFile(path.join(f.source,'conflict'),'initial');await f.native('add','.');await f.native('commit','-m','base');await f.native('checkout','-b','other');await fs.writeFile(path.join(f.source,'conflict'),'other');await f.native('commit','-am','other');await f.native('checkout','main');await fs.writeFile(path.join(f.source,'conflict'),'main');await f.native('commit','-am','main');await assert.rejects(f.native('merge','other'));
 const merged=await f.inspect();assert.equal(merged.code,0,merged.stderr);assert.ok(JSON.parse(merged.stdout).changes.some(c=>c.kind==='unmerged'&&c.path==='conflict'&&c.index==='U'&&c.worktree==='U'));
 await f.native('merge','--abort');const linked=path.join(f.root,'linked');await f.native('worktree','add','-b','linked',linked);
 assert.equal((await f.cli(['project','register','--home',f.home,'--id','linked','--root',linked])).code,0);
 const view=await f.cli(['local','git','--home',f.home,'--project','linked','--git-binary',git]);assert.equal(view.code,0,view.stderr);assert.equal(JSON.parse(view.stdout).branch,'linked');
 const nested=path.join(f.source,'nested');await fs.mkdir(nested);assert.equal((await f.cli(['project','register','--home',f.home,'--id','nested','--root',nested])).code,0);const refused=await f.cli(['local','git','--home',f.home,'--project','nested','--git-binary',git]);assert.equal(refused.code,2);assert.match(refused.stderr,/exact Git worktree root/);
});
test('actual helper control executes, but local entry refuses included filters and missing promisor objects before helper/fetch',async t=>{
 const f=await fixture(t),marker=path.join(f.root,'helper-ran');await fs.writeFile(path.join(f.source,'file'),'initial');await fs.writeFile(path.join(f.source,'.gitattributes'),'file filter=canary\n');
 const included=path.join(f.root,'filters');await fs.writeFile(included,`[filter "canary"]\n clean = "printf ran > '${marker}'; cat"\n`);await f.native('config','include.path',included);
 await f.native('add','.');await f.native('commit','-m','base');await fs.rm(marker,{force:true});await fs.writeFile(path.join(f.source,'file'),'changed');await f.native('status','--porcelain');assert.equal(await fs.readFile(marker,'utf8'),'ran');await fs.rm(marker);
 const refused=await f.inspect();assert.equal(refused.code,2);assert.match(refused.stderr,/clean\/process filters/);await assert.rejects(fs.access(marker),{code:'ENOENT'});
 await f.native('config','--unset','include.path');const blob=(await f.native('rev-parse','HEAD:file')).trim();await fs.unlink(path.join(f.source,'.git/objects',blob.slice(0,2),blob.slice(2)));
 await f.native('config','remote.origin.promisor','true');await f.native('config','remote.origin.url',`ext::sh -c touch% ${marker}`);
 const partial=await f.inspect();assert.equal(partial.code,2);assert.match(partial.stderr,/Partial-clone\/promisor/);await assert.rejects(fs.access(marker),{code:'ENOENT'});
});
test('unsafe executable, undecodable Git output and excessive subprocess output refuse instead of reporting a clean tree',async t=>{
 const f=await fixture(t),marker=path.join(f.root,'unsafe-ran'),unsafe=path.join(f.source,'unsafe-git');await fs.writeFile(unsafe,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');\n`,{mode:0o700});
 const rejected=await f.cli(['local','git','--home',f.home,'--project','p','--git-binary',unsafe]);assert.equal(rejected.code,2);assert.match(rejected.stderr,/outside application storage and registered projects/);await assert.rejects(fs.access(marker),{code:'ENOENT'});await fs.unlink(unsafe);
 // APFS refuses non-UTF-8 filenames. Exercise undecodable native bytes through an explicit trusted driver instead.
 const invalid=path.join(f.root,'invalid-git');await fs.writeFile(invalid,`#!${process.execPath}\nprocess.stdout.write(Buffer.from([255]));\n`,{mode:0o700});
 const encoding=await f.cli(['local','git','--home',f.home,'--project','p','--git-binary',invalid]);assert.equal(encoding.code,2);assert.match(encoding.stderr,/Non-UTF-8/);assert.match(encoding.stderr,/recovery/);
 const loud=path.join(f.root,'loud-git');await fs.writeFile(loud,`#!${process.execPath}\nprocess.stdout.write('x'.repeat(1024*1024+1));\n`,{mode:0o700});
 const overflow=await f.cli(['local','git','--home',f.home,'--project','p','--git-binary',loud]);assert.equal(overflow.code,2);assert.match(overflow.stderr,/No complete observation/);assert.equal(overflow.stdout,'');
});
test('late configuration replacement can execute a helper; original CLI refuses the observation and explains possible effects',async t=>{
 const f=await fixture(t),marker=path.join(f.root,'late-helper'),once=path.join(f.root,'changed-config');
 await fs.writeFile(path.join(f.source,'file'),'initial');await fs.writeFile(path.join(f.source,'.gitattributes'),'file filter=late\n');await f.native('add','.');await f.native('commit','-m','base');await fs.writeFile(path.join(f.source,'file'),'changed');
 const driver=path.join(f.root,'racing-git.cjs');
 await fs.writeFile(driver,`#!${process.execPath}\nconst {spawnSync}=require('node:child_process'),fs=require('node:fs');const args=process.argv.slice(2),r=spawnSync(${JSON.stringify(git)},args,{env:process.env});if(args.includes('config')&&!fs.existsSync(${JSON.stringify(once)})){fs.writeFileSync(${JSON.stringify(once)},'changed');const c=spawnSync(${JSON.stringify(git)},['config','filter.late.clean',${JSON.stringify("printf ran > '"+marker+"'; cat")}],{env:process.env});if(c.status!==0)process.exit(89);}process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;\n`,{mode:0o700});
 const result=await f.cli(['local','git','--home',f.home,'--project','p','--git-binary',driver]);assert.equal(result.code,2);assert.equal(result.stdout,'');assert.match(result.stderr,/configuration or observed status changed/);assert.match(result.stderr,/does not prove that no helper ran/);assert.equal(await fs.readFile(marker,'utf8'),'ran');
 const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n,0);}finally{db.close();}
});
