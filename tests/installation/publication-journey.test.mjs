import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
import {publicationNative} from './publication-native.mjs';
// Installed CLI/TUI alone creates every application record. Native HTTP replies are synthetic.
test('fresh installed host-summary publication preserves both revisions through once-only send, accepted-POST close and original preparation recovery and reconciliation',{timeout:180000},async t=>{
 const source=await fs.realpath('.'),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-installed-publication-'))),prefix=path.join(root,'prefix with spaces'),home=path.join(root,'application'),user=path.join(root,'user'),cwd=path.join(root,'outside checkout'),credential=path.join(root,'credential.json'),weakCredential=path.join(root,'weak-credential.json');
 assert.ok(root!==source&&!root.startsWith(source+path.sep));for(const dir of [user,cwd])await fs.mkdir(dir,{mode:0o700});const tls=await repositoryTlsFixture(t),server=await publicationNative(tls.tls),groups=new Set();server.merged.add(1);server.merged.add(2);let passed=false,held;
 const base={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:user,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',LANG:'C.UTF-8',TERM:'xterm-256color',SHELL:'/bin/sh',TMPDIR:root,GITJIG_HOME:home,NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert};
 const absent=pid=>{try{process.kill(-pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}};
 const run=async(binary,args,label,{expected=0,timeout=10000,env=base,workdir=cwd}={})=>{
  const child=spawn(binary,args,{cwd:workdir,env,detached:true,stdio:['ignore','pipe','pipe']});if(child.pid)groups.add(child.pid);let out='',err='',bytes=0,expired=false,overflow=false;
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
  const timer=setTimeout(()=>{expired=true;kill();},timeout),collect=(chunk,stderr)=>{bytes+=chunk.length;if(bytes>4*1024*1024){overflow=true;kill();}else if(stderr)err+=chunk;else out+=chunk;};child.stdout.on('data',b=>collect(b,false));child.stderr.on('data',b=>collect(b,true));
  let result;try{result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(timer);}
  await fs.writeFile(path.join(root,label+'.result.json'),JSON.stringify({label,pid:child.pid,...result,expired,overflow,out,err}),{mode:0o600});assert.equal(expired,false,label+' deadline');assert.equal(overflow,false,label+' output cap');assert.equal(result.signal,null,err);assert.equal(result.code,expected,label+' '+err+out);assert.equal(absent(child.pid),true,label+' process group settled');groups.delete(child.pid);return out;
 };
 t.after(async()=>{for(const pid of groups)if(!absent(pid))try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}held?.release();await server.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained installed publication fixture: '+root);});
 await fs.writeFile(credential,'{"token":"fixture-only"}',{mode:0o600});await fs.writeFile(weakCredential,'{"token":"fixture-weak"}',{mode:0o600});
 await run(process.execPath,[path.join(source,'install.mjs'),'--prefix',prefix],'install',{timeout:100000,env:{...base,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,npm_config_offline:'true',npm_config_cache:process.env.npm_config_cache??path.join(os.homedir(),'.npm'),npm_config_userconfig:path.join(root,'empty-npmrc')}});
 const command=path.join(prefix,'bin/gitjig'),payload=path.join(prefix,'lib/node_modules/gitjig');assert.ok((await fs.realpath(command)).startsWith(payload+path.sep));await assert.rejects(fs.access(home),{code:'ENOENT'});
 for(const file of ['dist/cli/entry.js','dist/controller/contributions.js','dist/controller/publication.js','dist/platform/github-publication.js','dist/platform/github-publication-session.js','dist/ui/contribution-publication.js','dist/ui/exact-review.js','dist/ui/publication-browser.js','dist/ui/repository-commands.js','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md','docs/repository-contributions.md','LICENSE'])assert.deepEqual(await fs.readFile(path.join(payload,file)),await fs.readFile(path.join(source,file)),file+' current installed bytes');
 for(const file of ['src','tests','development','.git','node_modules/typescript'])await assert.rejects(fs.access(path.join(payload,file)),{code:'ENOENT'});
 const hook=path.join(root,'owned-installed-connection.mjs'),trace=path.join(root,'resolved-files.jsonl');
 await fs.writeFile(hook,await fs.readFile(path.join(source,'tests/ui/publication-send-network-only.mjs'),'utf8')+`
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
const installed=fs.realpathSync(process.env.GITJIG_INSTALLED_PAYLOAD),traceFile=process.env.GITJIG_INSTALLED_TRACE;
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('file:')){const file=fs.realpathSync(fileURLToPath(result.url));if(!file.startsWith(installed+path.sep))return deny();fs.appendFileSync(traceFile,JSON.stringify(file)+'\\n',{mode:0o600});}return result;}});
`,{mode:0o600});
 const env={...base,NODE_OPTIONS:'--import='+pathToFileURL(hook).href,GITJIG_PUBLICATION_PORT:new URL(server.origin).port,GITJIG_INSTALLED_PAYLOAD:payload,GITJIG_INSTALLED_TRACE:trace};
 const dependencies=['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-tui','@gitjig/pi-claude-bridge-host'],resolved=JSON.parse(await run(process.execPath,['--input-type=module','-e','console.log(JSON.stringify('+JSON.stringify(dependencies)+'.map(name=>import.meta.resolve(name))))'],'installed-dependencies',{env,workdir:payload}));for(const url of resolved)assert.ok((await fs.realpath(fileURLToPath(url))).startsWith(payload+path.sep));
 const read=callback=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{return callback(db);}finally{db.close();}},snapshot=(omit=[])=>read(db=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(({name})=>!omit.includes(name)).map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()])));
 let serial=0;const cli=async(args,expected=0)=>{const text=await run(command,args,'cli-'+serial++,{env,expected});assert.doesNotMatch(text,/fixture-(?:only|weak)/);return JSON.parse(text);};
 const terminal=async(label,steps)=>{const file=path.join(root,label+'.json');await fs.writeFile(file,JSON.stringify({command:[command],env,steps,timeoutSeconds:15,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}),{mode:0o600});const result=JSON.parse(await run('/usr/bin/python3',[path.join(source,'tests/cli/fork-ui-pty.py'),file],label,{timeout:19000,env:base}));assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);const text=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(text,/fixture-(?:only|weak)/);return text;};
 const empty=['works','runs','budgets','effect_operations','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const trackSteps=(kind,number)=>[
  {wait:'Registered repository targets',send:'github\r'},
  {wait:'retained identity only',send:'Track existing issue or pull request\r'},
  {wait:'Track existing GitHub resource · repository identity only',send:kind+'\r'},
  {wait:'Existing GitHub issue / PR number',send:String(number)+'\r'},
  {wait:'Track existing GitHub resource · read requests',send:'\x1b'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'GitHub resource tracked · original identity retained',send:'\x1b'},
 ];
 const linkSteps=number=>[
  {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #'+number+'\r'},
  {wait:'Retained pull-request #'+number,send:'Edit summary parent\r'},
  {wait:'Summary parent · current none',send:'issue #8\r'},
  {wait:'Review summary routing · no change yet',send:'\x1b'},
  {wait:'Explicit summary routing action',send:'Save summary routing\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Summary routing retained · no automatic summary',send:'\x1b'},
 ];
 const summarySteps=[
  {wait:'Tracked issues and pull requests · retained GitHub',send:'issue #8\r'},
  {wait:'Retained issue #8',send:'Prepare local summary revision\r'},
  {wait:'Local summary revision retained · not published',send:'\x1b'},
  {wait:'Retained issue #8',send:'Prepare publication from current local summary\r'},
 ];
 const prepareSteps=(profile=credential)=>[
  {wait:'Review host summary publication preparation',send:'\x1b'},
  {wait:'Explicit summary publication preparation',send:'Prepare this exact summary publication\r'},
  {wait:'Private repository credential JSON file',send:profile+'\r'},
  {wait:'Summary publication preparation retained',send:'\x1b'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Retained publications\r'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · ',send:'Review and send original prepared publication\r'},
  {wait:'Review exact original publication',send:'\x1b'},
  {wait:'Confirm exact original publication write',send:'Send this original prepared publication\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
 ];
 await terminal('installed-refused-preparation',[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Register repository\r'},
  {wait:'Repository provider',send:'github\r'},
  {wait:'Repository owner',send:'owner\r'},
  {wait:'Repository name',send:'repo\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Repository management · owner actions',queries:empty,send:'Registered targets\r'},
  ...trackSteps('issue',8),...trackSteps('pull-request',1),
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
  ...linkSteps(1),...summarySteps,
  {wait:'Publication target · same native repository',send:'Register default-policy\r'},
  {wait:'Select registered GitHub identity',send:'owner/repo\r'},
  ...prepareSteps(weakCredential).slice(0,3),
  {wait:'Summary publication preparation retained',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['REFUSED']]},{sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[1,0]]}],send:'\x1b'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'INPUT',send:'/quit\x1b\r'},
 ]);
 const refused=read(db=>({op:db.prepare('SELECT * FROM effect_operations').get(),work:db.prepare('SELECT * FROM works').get(),grant:db.prepare('SELECT * FROM effect_delegations').get(),budget:db.prepare("SELECT * FROM budgets WHERE kind='execution'").get()})),refusedData=JSON.parse(refused.op.data);assert.equal(refused.op.phase,'REFUSED');assert.equal(refused.budget.consumed,1);assert.equal(refused.budget.reserved,0);assert.equal(server.posts.length,0);assert.ok(server.requests.some(row=>row.authorization==='Bearer fixture-weak'&&row.path==='/user'));assert.ok(server.requests.every(row=>row.method==='GET'));
 read(db=>{const receipts=db.prepare("SELECT data FROM effect_receipts WHERE operation=? AND kind='capability'").all(refused.op.id);assert.equal(receipts.length,1);const observation=JSON.parse(receipts[0].data).observation;assert.equal(observation.state,'denied');assert.equal(observation.observedUserId,7);assert.equal(observation.expectedUserId,7);assert.deepEqual(observation.grantedScopes,[]);assert.ok(observation.conditions.includes('No native broad granted scope for the actual repository visibility'));const authority=db.prepare('SELECT data FROM authority_observations').all().map(row=>JSON.parse(row.data)).filter(row=>row.kind==='publication'&&row.operationId===refused.op.id);assert.equal(authority.length,1);assert.deepEqual(authority[0].observation,observation);});
 const protectedTables=['works','sources','requirements','effect_operations','effect_receipts','effect_delegations','authority_observations','budgets','runs','summary_revisions','summary_members'],protectedSnapshot=()=>read(db=>protectedTables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())),protectedQueries=read(db=>protectedTables.map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>Object.values(row))}))),stableRefused=protectedSnapshot(),beforeRecoveryRequests=server.requests.length;
 await terminal('installed-cancelled-recovery',[
  {wait:'Model: not selected',send:'\x15/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Retained publications\r'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · '+refused.op.id,send:'Inspect original publication facts\r'},
  {wait:'Original publication · phase, transport',queries:protectedQueries,send:'\x1b'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · '+refused.op.id,send:'Resume original owner summary preparation\r'},
  {wait:'Review original summary preparation recovery',queries:protectedQueries,send:'\x1b'},
  {wait:'Explicit original preparation recovery',send:'Back without preparing\r'},
  {wait:'Retained publications · recorded facts',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'INPUT',send:'\x15/quit\x1b\r'},
 ]);assert.deepEqual(protectedSnapshot(),stableRefused);assert.equal(server.requests.length,beforeRecoveryRequests);assert.equal(server.posts.length,0);
 await terminal('installed-recovery-and-first-send',[
  {wait:'Model: not selected',send:'\x15/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Retained publications\r'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · '+refused.op.id,send:'Resume original owner summary preparation\r'},
  {wait:'Review original summary preparation recovery',queries:protectedQueries,send:'\x1b'},
  {wait:'Explicit original preparation recovery',send:'Prepare current summary on this original\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Original summary preparation recovery retained',queries:[{sql:'SELECT id,work,target,grant_id,phase FROM effect_operations',rows:[[refused.op.id,refused.op.work,refused.op.target,refused.op.grant_id,'RESERVED']]},{sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[2,0]]}],send:'\x1b'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · '+refused.op.id,send:'Review and send original prepared publication\r'},
  {wait:'Review exact original publication',send:'\x1b'},
  {wait:'Confirm exact original publication write',send:'Send this original prepared publication\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Original publication send outcome retained',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['CONFIRMED']]},{sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[3,0]]}],send:'\x1b'},
  {wait:'Retained publications · recorded facts',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'INPUT',send:'/quit\x1b\r'},
 ]);
 const originals=read(db=>({op:db.prepare('SELECT * FROM effect_operations').get(),work:db.prepare('SELECT * FROM works').get(),grants:db.prepare('SELECT * FROM effect_delegations ORDER BY rowid').all(),summary:db.prepare('SELECT * FROM summary_revisions').get(),members:db.prepare('SELECT * FROM summary_members ORDER BY rowid').all(),budget:db.prepare("SELECT * FROM budgets WHERE kind='execution'").get()}));assert.equal(server.posts.length,1);const firstData=JSON.parse(originals.op.data);assert.equal(originals.op.id,refused.op.id);assert.equal(originals.op.work,refused.op.work);assert.equal(originals.op.target,refused.op.target);assert.equal(originals.op.grant_id,refused.op.grant_id);assert.deepEqual(originals.work,refused.work);assert.deepEqual(originals.grants,[refused.grant]);assert.equal(originals.budget.lim,refused.budget.lim);assert.equal(originals.budget.consumed,3);read(db=>{const prior=JSON.parse(db.prepare("SELECT data FROM effect_receipts WHERE operation=? AND kind='payload-revision'").get(refused.op.id).data);assert.equal(prior.previous,refusedData.payloadHash);assert.equal(prior.payloadBase64,refusedData.payloadBase64);assert.deepEqual(prior.authorization,refusedData.ownerAuthorization);assert.deepEqual(prior.catalogueProof,refusedData.contributionSnapshot);});assert.equal(firstData.contributionSnapshot.revisionId,originals.summary.id);assert.equal(server.posts[0].bytes.toString('base64'),firstData.payloadBase64);assert.equal(createHash('sha256').update(server.posts[0].bytes).digest('hex'),firstData.payloadHash);const nativeFirst=structuredClone(server.comments[0]);assert.equal(firstData.action.body,JSON.parse(originals.summary.data).body);const firstSummary=JSON.parse(originals.summary.data);assert.equal(firstSummary.complete,true);assert.equal(firstSummary.contributionCount,1);assert.equal(originals.members.length,4);read(db=>assert.deepEqual(originals.members.map(row=>row.observation).sort(),db.prepare("SELECT o.id FROM contribution_observations o JOIN tracked_resources r ON r.id=o.resource WHERE r.kind='pull-request' AND r.number=1 ORDER BY o.id").all().map(row=>row.id)));
 const marker=path.join(root,'accepted-second-post');held=server.holdAcceptedPost();void held.entered.then(()=>writeFileSync(marker,'accepted'));
 await terminal('installed-second-publication-close',[
  {wait:'Model: not selected',send:'\x15/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Registered targets\r'},...trackSteps('pull-request',2),
  {wait:'Registered repository targets',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
  ...linkSteps(2),...summarySteps,
  {wait:'Publication target · same native repository',send:'owner/repo\r'},...prepareSteps(),
  {wait:'',waitFiles:[{path:marker,value:'accepted'}],terminate:true,send:''},
 ]);held.release();held=undefined;
 const second=read(db=>db.prepare('SELECT * FROM effect_operations WHERE id<>?').get(originals.op.id)),secondData=JSON.parse(second.data);assert.equal(second.phase,'UNKNOWN');assert.notEqual(second.work,originals.work.id);assert.equal(server.posts.length,2);assert.equal(server.posts[1].bytes.toString('base64'),secondData.payloadBase64);assert.equal(createHash('sha256').update(server.posts[1].bytes).digest('hex'),secondData.payloadHash);assert.equal(secondData.action.body.includes('Human change2'),true);assert.notEqual(secondData.contributionSnapshot.revisionId,firstData.contributionSnapshot.revisionId);
 const frozen=read(db=>({operation:db.prepare('SELECT * FROM effect_operations WHERE id=?').get(second.id),work:db.prepare('SELECT * FROM works WHERE id=?').get(second.work),grants:db.prepare('SELECT * FROM effect_delegations WHERE root=? ORDER BY rowid').all(second.work),summary:db.prepare('SELECT * FROM summary_revisions WHERE id=?').get(secondData.contributionSnapshot.revisionId),members:db.prepare('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid').all(secondData.contributionSnapshot.revisionId),budget:db.prepare("SELECT * FROM budgets WHERE lineage=? AND kind='execution'").get(second.work)}));assert.equal(frozen.budget.consumed,2);assert.equal(frozen.budget.reserved,0);
 const secondSummary=JSON.parse(frozen.summary.data);assert.equal(secondSummary.complete,true);assert.equal(secondSummary.contributionCount,2);for(const title of ['Human change1','Human change2'])assert.ok(secondSummary.body.includes(title),title+' retained in union');assert.equal(frozen.members.length,8);read(db=>{const resources=db.prepare("SELECT number,resource_id,resource_node FROM tracked_resources WHERE kind='pull-request' ORDER BY number").all();assert.deepEqual(resources.map(row=>[row.number,row.resource_id,row.resource_node]),[[1,101,'P1'],[2,102,'P2']]);const expected=db.prepare("SELECT o.id FROM contribution_observations o JOIN tracked_resources r ON r.id=o.resource WHERE r.kind='pull-request' AND r.number IN (1,2) ORDER BY o.id").all().map(row=>row.id);assert.equal(expected.length,8);assert.deepEqual(frozen.members.map(row=>row.observation).sort(),expected);});
 const stableOriginal=()=>read(db=>{assert.deepEqual(server.comments[0],nativeFirst);assert.deepEqual(db.prepare("SELECT * FROM budgets WHERE lineage=? AND kind='execution'").get(originals.work.id),originals.budget);assert.deepEqual(db.prepare('SELECT * FROM effect_operations WHERE id=?').get(originals.op.id),originals.op);assert.deepEqual(db.prepare('SELECT * FROM works WHERE id=?').get(originals.work.id),originals.work);assert.deepEqual(db.prepare('SELECT * FROM effect_delegations WHERE root=? ORDER BY rowid').all(originals.work.id),originals.grants);assert.deepEqual(db.prepare('SELECT * FROM summary_revisions WHERE id=?').get(originals.summary.id),originals.summary);assert.deepEqual(db.prepare('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid').all(originals.summary.id),originals.members);});stableOriginal();assert.equal(server.comments[0].body,server.posts[0].body);
 // Broken setup cannot turn pure installed inspection into recovery or a native request.
 await fs.mkdir(path.join(home,'config'),{recursive:true,mode:0o700});await fs.writeFile(path.join(home,'config/startup.json'),'{broken-owned-setup',{mode:0o600});const before=snapshot(),requests=server.requests.length;const list=await cli(['publication','list']),inspected=await cli(['publication','inspect','--operation',second.id]);assert.equal(list.operations.length,2);assert.equal(inspected.phase,'UNKNOWN');assert.equal(snapshot(),before);assert.equal(server.requests.length,requests);await cli(['setup','clear']);assert.equal(snapshot(),before);
 const readQueries=read(db=>['effect_operations','works','effect_delegations','budgets','runs'].map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>Object.values(row))})));
 await terminal('installed-pure-reopen',[
  {wait:'Model: not selected',send:'\x15/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Retained publications\r'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · '+second.id,send:'Inspect original publication facts\r'},
  {wait:'Original publication · phase, transport',queries:readQueries,send:'\x1b'},
  {wait:'Retained publications · recorded facts',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'INPUT',send:'\x15/quit\x1b\r'},
 ]);assert.equal(server.requests.length,requests);assert.equal(server.posts.length,2);stableOriginal();
 await terminal('installed-original-reconciliation',[
  {wait:'Model: not selected',send:'\x15/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Retained publications\r'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · '+second.id,send:'Reconcile original publication\r'},
  {wait:'Review original read-only reconciliation',queries:readQueries,send:'\x1b'},
  {wait:'Explicit original-publication action',send:'Reconcile original with read requests\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Original publication reconciliation retained',queries:[{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[second.id],rows:[['CONFIRMED']]},{sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[second.work],rows:[[3,0]]}],send:'\x1b'},
  {wait:'Retained publications · recorded facts',send:'Back\r'},
  {wait:'Repository management · owner actions',send:'Close\r'},
  {wait:'INPUT',send:'\x15/quit\x1b\r'},
 ]);
 const confirmed=await cli(['publication','inspect','--operation',second.id]);assert.equal(confirmed.operationId,second.id);assert.equal(confirmed.workId,second.work);assert.equal(confirmed.phase,'CONFIRMED');assert.equal(confirmed.transportOutcome,'uncertain');assert.equal(confirmed.observedOutcome,'resource-matches');assert.equal(confirmed.resource.id,server.comments[1].id);assert.ok(server.requests.length>requests);assert.ok(server.requests.slice(requests).every(row=>row.method==='GET'));assert.equal(server.posts.length,2);stableOriginal();
 read(db=>{const op=db.prepare('SELECT * FROM effect_operations WHERE id=?').get(second.id),data=JSON.parse(op.data);assert.equal(op.work,second.work);assert.equal(op.target,frozen.operation.target);assert.equal(op.grant_id,frozen.operation.grant_id);assert.equal(data.payloadHash,secondData.payloadHash);assert.equal(data.payloadBase64,secondData.payloadBase64);assert.deepEqual(db.prepare('SELECT * FROM works WHERE id=?').get(second.work),frozen.work);assert.deepEqual(db.prepare('SELECT * FROM effect_delegations WHERE root=? ORDER BY rowid').all(second.work),frozen.grants);assert.deepEqual(db.prepare('SELECT * FROM summary_revisions WHERE id=?').get(frozen.summary.id),frozen.summary);assert.deepEqual(db.prepare('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid').all(frozen.summary.id),frozen.members);const budget=db.prepare("SELECT * FROM budgets WHERE lineage=? AND kind='execution'").get(second.work);assert.equal(budget.lim,frozen.budget.lim);assert.equal(budget.consumed,3);assert.equal(budget.reserved,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE phase='RUNNING' OR reservation='reserved'").get().n,0);});
 const files=(await fs.readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.ok(files.every(file=>file.startsWith(payload+path.sep)));for(const file of ['dist/cli/entry.js','dist/controller/contributions.js','dist/controller/publication.js','dist/ui/contribution-publication.js','dist/ui/publication-browser.js','dist/ui/exact-review.js','dist/platform/github-publication.js'])assert.ok(files.includes(path.join(payload,file)),file+' actually imported');assert.ok(server.requests.every(row=>row.authorization==='Bearer fixture-only'||row.authorization==='Bearer fixture-weak'&&row.method==='GET'));
 const checkPrivateState=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await checkPrivateState(file);else if(entry.isFile()){const bytes=await fs.readFile(file);for(const token of ['fixture-only','fixture-weak'])assert.equal(bytes.includes(Buffer.from(token)),false,'Credential leaked into installed application state '+file);}}};await checkPrivateState(home);assert.equal(groups.size,0);passed=true;
});
