import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {contributionServer} from '../contributions/native-server.mjs';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';

// Only native HTTP responses and the trusted HTTPS connection destination are synthetic.
// Installed modules create all application state; no source controller or ledger seeding.
test('fresh installed contribution journey registers, tracks, refreshes, summarizes and preserves originals through replacement and pure reopen',{timeout:160000},async t=>{
 const source=await fs.realpath('.'),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-installed-contributions-'))),prefix=path.join(root,'prefix with spaces'),home=path.join(root,'application'),user=path.join(root,'user'),cwd=path.join(root,'outside checkout'),credential=path.join(root,'credential.json');
 assert.ok(root!==source&&!root.startsWith(source+path.sep));for(const dir of [user,cwd])await fs.mkdir(dir,{mode:0o700});const tls=await repositoryTlsFixture(t),server=await contributionServer({tls:tls.tls}),groups=new Set();server.merged.add(1);let passed=false;
 const base={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:user,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',LANG:'C.UTF-8',TERM:'xterm-256color',SHELL:'/bin/sh',TMPDIR:root,GITJIG_HOME:home,NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert};
 const absent=pid=>{try{process.kill(-pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}};
 const run=async(binary,args,label,{expected=0,timeout=10000,env=base,workdir=cwd}={})=>{
  const child=spawn(binary,args,{cwd:workdir,env,detached:true,stdio:['ignore','pipe','pipe']});if(child.pid)groups.add(child.pid);let out='',err='',bytes=0,expired=false,overflow=false;
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
  const timer=setTimeout(()=>{expired=true;kill();},timeout),collect=(chunk,stderr)=>{bytes+=chunk.length;if(bytes>4*1024*1024){overflow=true;kill();}else if(stderr)err+=chunk;else out+=chunk;};child.stdout.on('data',b=>collect(b,false));child.stderr.on('data',b=>collect(b,true));
  let result;try{result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(timer);}
  await fs.writeFile(path.join(root,label+'.result.json'),JSON.stringify({label,pid:child.pid,...result,expired,overflow,out,err}),{mode:0o600});assert.equal(expired,false,label+' deadline');assert.equal(overflow,false,label+' output cap');assert.equal(result.signal,null,err);assert.equal(result.code,expected,label+' '+err+out);assert.equal(absent(child.pid),true,label+' process group settled');groups.delete(child.pid);return out;
 };
 t.after(async()=>{for(const pid of groups)if(!absent(pid))try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}await server.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained installed contribution fixture: '+root);});
 await fs.writeFile(credential,'{"token":"fixture-only"}',{mode:0o600});
 await run(process.execPath,[path.join(source,'install.mjs'),'--prefix',prefix],'install',{timeout:100000,env:{...base,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,npm_config_offline:'true',npm_config_cache:process.env.npm_config_cache??path.join(os.homedir(),'.npm'),npm_config_userconfig:path.join(root,'empty-npmrc')}});
 const command=path.join(prefix,'bin/gitjig'),payload=path.join(prefix,'lib/node_modules/gitjig');assert.ok((await fs.realpath(command)).startsWith(payload+path.sep));await assert.rejects(fs.access(home),{code:'ENOENT'});
 for(const file of ['dist/cli/entry.js','dist/controller/contributions.js','dist/platform/github-contributions.js','dist/ui/contribution-browser.js','dist/ui/repository-commands.js','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md','docs/repository-contributions.md','LICENSE'])assert.deepEqual(await fs.readFile(path.join(payload,file)),await fs.readFile(path.join(source,file)),file+' current installed bytes');
 for(const file of ['src','tests','development','.git','node_modules/typescript'])await assert.rejects(fs.access(path.join(payload,file)),{code:'ENOENT'});
 const hook=path.join(root,'owned-installed-connection.mjs'),trace=path.join(root,'resolved-files.jsonl');
 await fs.writeFile(hook,await fs.readFile(path.join(source,'tests/ui/contribution-network-only.mjs'),'utf8')+`
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
const installed=fs.realpathSync(process.env.GITJIG_INSTALLED_PAYLOAD),traceFile=process.env.GITJIG_INSTALLED_TRACE;
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('file:')){const file=fs.realpathSync(fileURLToPath(result.url));if(!file.startsWith(installed+path.sep))return deny();fs.appendFileSync(traceFile,JSON.stringify(file)+'\\n',{mode:0o600});}return result;}});
`,{mode:0o600});
 const env={...base,NODE_OPTIONS:'--import='+pathToFileURL(hook).href,GITJIG_CONTRIBUTION_PORT:new URL(server.origin).port,GITJIG_INSTALLED_PAYLOAD:payload,GITJIG_INSTALLED_TRACE:trace};
 const dependencies=['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-tui','@gitjig/pi-claude-bridge-host'],resolved=JSON.parse(await run(process.execPath,['--input-type=module','-e','console.log(JSON.stringify('+JSON.stringify(dependencies)+'.map(name=>import.meta.resolve(name))))'],'installed-dependencies',{env,workdir:payload}));for(const url of resolved)assert.ok((await fs.realpath(fileURLToPath(url))).startsWith(payload+path.sep));
 const empty=['works','runs','budgets','conversation_inputs','effect_operations'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]})),retained=[...empty,{sql:'SELECT COUNT(*) FROM tracked_resources',rows:[[1]]},{sql:"SELECT COUNT(*) FROM sources WHERE json_extract(origin,'$.kind')='owner-resource-track'",rows:[[1]]}];
 const terminal=async(label,steps)=>{const file=path.join(root,label+'.json');await fs.writeFile(file,JSON.stringify({command:[command],env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}),{mode:0o600});const result=JSON.parse(await run('/usr/bin/python3',[path.join(source,'tests/cli/fork-ui-pty.py'),file],label,{timeout:16000,env:base}));assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const text=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(text,/fixture-only/);return text;};
 await terminal('installed-track',[
  {wait:'Model: not selected',send:'KEEP 한국어\x07t'},
  {wait:'Setup and next actions',send:'Repository management\r'},
  {wait:'Repository management · owner actions',send:'Register repository\r'},
  {wait:'Repository provider',send:'github\r'},
  {wait:'Repository owner',send:'owner\r'},
  {wait:'Repository name',send:'repo\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Repository management · owner actions',queries:[...empty,{sql:'SELECT COUNT(*) FROM effect_targets',rows:[[1]]}],send:'Registered targets\r'},
  {wait:'Registered repository targets',send:'github\r'},
  {wait:'retained identity only',send:'Track existing issue or pull request\r'},
  {wait:'Track existing GitHub resource · repository identity only',send:'pull-request\r'},
  {wait:'Existing GitHub issue / PR number',send:'1\r'},
  {wait:'Track existing GitHub resource · read requests',queries:[...empty,{sql:'SELECT COUNT(*) FROM tracked_resources',rows:[[0]]}],send:'\x1b'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'GitHub resource tracked · original identity retained',queries:retained,send:'\x1b'},
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #1\r'},
  {wait:'Retained pull-request #1',send:'Refresh selected native observations\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Native contribution refresh retained · inspect observed/unavailable outcome',queries:retained,send:'\x1b'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #1\r'},
  {wait:'Retained pull-request #1',send:'Prepare local summary revision\r'},
  {wait:'Local summary revision retained · not published',queries:[...retained,{sql:"SELECT json_extract(data,'$.complete'),json_extract(data,'$.publication') FROM summary_revisions",rows:[[1,'not-prepared']]}],send:'\x1b'},
  {wait:'Retained pull-request #1',send:'Back\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'Setup and next actions',assertDraft:'KEEP 한국어',send:'\x1b'},
  {wait:'KEEP 한국어',assertDraft:'KEEP 한국어',send:'\x15/quit\x1b\r'},
 ]);
 let serial=0;const cli=async(args,expected=0)=>{const text=await run(command,args,'cli-'+serial++,{env,expected});assert.doesNotMatch(text,/fixture-only/);return JSON.parse(text);};
 const read=callback=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{return callback(db);}finally{db.close();}},snapshot=(omit=[])=>read(db=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(({name})=>!omit.includes(name)).map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()])));
 assert.equal(server.calls,18);const initial=snapshot(),listed=await cli(['repo','resources']),id=listed.resources[0].resourceId,original=await cli(['repo','contributions','--resource',id]),summary=await cli(['repo','summary','--resource',id]);assert.equal(listed.resources.length,1);assert.equal(original.nativeId,101);assert.equal(original.nodeId,'P1');assert.equal(original.mergeSha,'3'.repeat(40));assert.equal(summary.complete,true);assert.equal(summary.publication,'not-prepared');assert.equal(summary.contributionCount,1);for(const fact of ['Human change1','Preserve meaning 1','actual fixture CI','REV1','human','historical permission/override basis unavailable'])assert.ok(summary.body.includes(fact),fact);assert.equal(snapshot(),initial);assert.equal(server.calls,18);
 const metadata=read(db=>({resource:db.prepare('SELECT * FROM tracked_resources').get(),observations:db.prepare('SELECT * FROM contribution_observations ORDER BY rowid').all(),members:db.prepare('SELECT * FROM summary_members ORDER BY observation').all(),revision:db.prepare('SELECT * FROM summary_revisions').get()}));assert.equal(metadata.observations.length,4);assert.equal(metadata.members.length,4);
 await fs.mkdir(path.join(home,'config'),{recursive:true,mode:0o700});await fs.writeFile(path.join(home,'config/startup.json'),'{owned-broken-setup',{mode:0o600});assert.equal((await cli(['repo','resources'])).resources[0].resourceId,id);assert.equal(snapshot(),initial);await cli(['setup','clear']);assert.equal(server.calls,18);assert.equal(snapshot(),initial);
 server.replace();const refresh=await cli(['repo','refresh','--resources',id,'--credential-profile',credential],2);assert.equal(refresh[0].state,'unavailable');const after=await cli(['repo','contributions','--resource',id]);assert.equal(after.resourceId,id);assert.equal(after.nativeId,101);assert.equal(after.nodeId,'P1');assert.equal(after.mergeSha,original.mergeSha);assert.equal(after.merged,true);assert.ok(after.missing.some(reason=>reason.includes('Tracked native resource replaced')));assert.deepEqual(after.observations.filter(row=>row.facet!=='diagnostic'),original.observations);assert.equal(after.observations.filter(row=>row.facet==='diagnostic').length,1);
 const incomplete=await cli(['repo','summary','--resource',id],2);assert.equal(incomplete.complete,false);assert.notEqual(incomplete.revisionId,summary.revisionId);assert.equal(incomplete.contributionCount,1);assert.ok(incomplete.body.includes('Human change1'));assert.ok(incomplete.missing.length>0);
 read(db=>{assert.deepEqual(db.prepare('SELECT * FROM summary_revisions WHERE id=?').get(metadata.revision.id),metadata.revision);assert.deepEqual(db.prepare('SELECT * FROM summary_members WHERE revision=? ORDER BY observation').all(metadata.revision.id),metadata.members);for(const table of ['works','runs','budgets','conversation_inputs','effect_operations','effect_receipts'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);});
 const beforeReopen=snapshot(['conversations','conversation_state','conversation_views','conversation_models','interaction_view','input_documents']),requests=server.calls;
 await terminal('installed-reopen',[
  {wait:'Model: not selected',send:'\x15/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #1\r'},
  {wait:'Retained pull-request #1',send:'Inspect retained observations\r'},
  {wait:'Retained contribution observations',queries:retained,send:'\x1b'},
  {wait:'Retained pull-request #1',send:'Back\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'INPUT',send:'\x15/quit\x1b\r'},
 ]);assert.equal(server.calls,requests);assert.equal(snapshot(['conversations','conversation_state','conversation_views','conversation_models','interaction_view','input_documents']),beforeReopen);
 const files=(await fs.readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.ok(files.every(file=>file.startsWith(payload+path.sep)));for(const file of ['dist/cli/entry.js','dist/controller/contributions.js','dist/ui/contribution-browser.js','dist/platform/github-contributions.js'])assert.ok(files.includes(path.join(payload,file)),file+' actually imported');assert.ok(server.requests.every(req=>req.method==='GET'&&req.authorization==='Bearer fixture-only'));assert.equal(groups.size,0);passed=true;
});
