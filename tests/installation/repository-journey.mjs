import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
import {nativeConfigurationFixture,createdProtection} from '../platform/repository-configuration-fixture.mjs';

// Real npm snapshot and original installed launcher. Only hosting responses are synthetic.
// No source import hook, execution engine, model, personal prefix or live hosting service.
export async function installedRepositoryJourney(t,{fixtureRoot=os.tmpdir(),branchHeads={},afterGuide,retain=false}={}){
 const source=await fs.realpath('.');
 const root=await fs.realpath(await fs.mkdtemp(path.join(fixtureRoot,'gitjig-installed-repository-'))),prefix=path.join(root,'prefix with spaces'),home=path.join(root,'application'),user=path.join(root,'user'),cwd=path.join(root,'outside checkout'),credential=path.join(root,'credential.json');
 assert.ok(root!==source&&!root.startsWith(source+path.sep),'installed world must be outside checkout dependency ancestry');
 await fs.mkdir(user,{mode:0o700});await fs.mkdir(cwd,{mode:0o700});const tls=await repositoryTlsFixture(t),servers=[],groups=new Set(),invocations=[];let passed=false;
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:user,USER:'gitjig-owned-fixture',LOGNAME:'gitjig-owned-fixture',LANG:'C.UTF-8',TERM:'xterm-256color',SHELL:'/bin/sh',TMPDIR:root,GITJIG_HOME:home,NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert};
 const absent=pid=>{try{process.kill(-pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}};
 const run=async(binary,args,label,{expected=0,timeout=10000,environment=env,workdir=cwd}={})=>{
  const child=spawn(binary,args,{cwd:workdir,env:environment,detached:true,stdio:['ignore','pipe','pipe']});groups.add(child.pid);let out='',err='',bytes=0,expired=false,overflow=false;
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}};
  const timer=setTimeout(()=>{expired=true;kill();},timeout),collect=(chunk,stderr)=>{bytes+=chunk.length;if(bytes>4*1024*1024){overflow=true;kill();}else if(stderr)err+=chunk;else out+=chunk;};child.stdout.on('data',b=>collect(b,false));child.stderr.on('data',b=>collect(b,true));
  let result;try{result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}finally{clearTimeout(timer);}
  const receipt={label,pid:child.pid,...result,expired,overflow,out,err};invocations.push(receipt);await fs.writeFile(path.join(root,label+'.result.json'),JSON.stringify(receipt),{mode:0o600});
  assert.equal(expired,false,label+' deadline');assert.equal(overflow,false,label+' output cap');assert.equal(result.signal,null,err);assert.equal(result.code,expected,err+out);assert.equal(absent(child.pid),true,label+' child group settled');groups.delete(child.pid);return out;
 };
 t.after(async()=>{for(const pid of groups)if(!absent(pid))try{process.kill(-pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}for(const server of servers)await server.close();if(passed&&!retain&&process.env.GITJIG_RETAIN_INSTALLATION_FIXTURE!=='1')await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained installed repository fixture: '+root);});
 await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});
 // npm remains offline and uses the caller's already available locked cache. Changes target only this prefix.
 await run(process.execPath,[path.join(source,'install.mjs'),'--prefix',prefix],'install',{timeout:100000,environment:{...env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,npm_config_offline:'true',npm_config_cache:process.env.npm_config_cache??path.join(os.homedir(),'.npm'),npm_config_userconfig:path.join(root,'empty-npmrc')}});
 const command=path.join(prefix,'bin/gitjig'),payload=path.join(prefix,'lib/node_modules/gitjig'),installed=await fs.realpath(command);assert.ok(installed.startsWith(payload+path.sep));
 for(const file of ['dist/cli/entry.js','dist/platform/repository-configuration.js','dist/ui/repository-commands.js','MISSION.md','PRINCIPLES.md','DESIGN.md','CONTRACTS.md','docs/repository-configuration.md','docs/repository-inspection.md','THIRD_PARTY_NOTICES.md','LICENSE'])assert.deepEqual(await fs.readFile(path.join(payload,file)),await fs.readFile(path.join(source,file)),file+' current packaged bytes');
 for(const file of ['src','tests','development','.git','AGENTS.md','CONTRIBUTING.md','node_modules/typescript'])await assert.rejects(fs.access(path.join(payload,file)),{code:'ENOENT'});
 const dependencies=['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-tui','@gitjig/pi-claude-bridge-host'];
 const resolved=JSON.parse(await run(process.execPath,['--input-type=module','-e','console.log(JSON.stringify('+JSON.stringify(dependencies)+'.map(name=>import.meta.resolve(name))))'],'installed-dependencies',{workdir:payload}));for(const entry of resolved)assert.ok((await fs.realpath(fileURLToPath(entry))).startsWith(payload+'/node_modules/'),'installed ESM dependency');
 const cli=async(action,args=[],options={})=>{const out=await run(command,['repo',action,...args],action+'-'+invocations.length,options);assert.doesNotMatch(out,/fixture-native-token|fixture-private-native/);return JSON.parse(out);};
 const terminal=async(label,steps)=>{const file=path.join(root,label+'.json');await fs.writeFile(file,JSON.stringify({command:[command],env,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}),{mode:0o600});const result=JSON.parse(await run('/usr/bin/python3',[path.join(source,'tests/cli/fork-ui-pty.py'),file],label,{timeout:23000}));assert.equal(result.stages,steps.length);assert.equal(result.exitCode,0);assert.equal(result.terminalRestored,true);assert.doesNotMatch(await fs.readFile(file+'.terminal','utf8'),/fixture-native-token|fixture-private-native/);};
 const dbRead=callback=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{return callback(db);}finally{db.close();}},budget=work=>dbRead(db=>db.prepare("SELECT lineage,kind,lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'").get(work));
 const plans={},marker=path.join(root,'gitlab-request-count');
 for(const provider of ['gitea','gitlab']){
  const requestMarker=path.join(root,provider+'-staging-request-count');
  const server=await nativeConfigurationFixture(provider,{tls:tls.tls,absent:true,intercept:async({req,res,relative,body,state,send,requests,url})=>{
   await fs.writeFile(requestMarker,String(requests.length),{mode:0o600});
   if(provider==='gitlab')await fs.writeFile(marker,String(requests.length),{mode:0o600});
   if(provider==='gitlab'&&req.method==='POST'){state.protection=createdProtection(provider,body);res.destroy();return true;}
   if(provider==='gitea'&&relative==='/repos/owner/repo/branches/main'){send({name:'main',commit:{id:branchHeads[provider]??'1'.repeat(40)},protected:true,...state.guidePartial?{}:{effective_branch_protection_name:'main'},required_approvals:state.protection?.required_approvals??0});return true;}
   if(provider==='gitlab'&&relative==='/projects/9/repository/branches/main'){send({name:'main',commit:{id:branchHeads[provider]??'1'.repeat(40)},protected:true,developers_can_push:false,developers_can_merge:true,can_push:false});return true;}
   if(provider==='gitlab'&&relative==='/projects/9/approval_rules'){if(state.guidePartial)send({},403);else send(Number(url.searchParams.get('page')??1)>1?[]:[{id:5,name:'Visible team with hidden principals',rule_type:'regular',approvals_required:2,contains_hidden_groups:true,applies_to_all_protected_branches:true,protected_branches:[]}]);return true;}
   if(provider==='gitlab'&&relative==='/projects/9/approvals'){send({reset_approvals_on_push:true,disable_overriding_approvers_per_merge_request:true});return true;}
   return false;
  }});servers.push(server);server.state.repository.default_branch='main';
  const target=await cli('register-target',['--provider',provider,'--api-base',server.target.apiBase,'--owner',server.target.owner,'--repo','repo','--credential-profile',credential]);
  const edit=provider==='gitea'?[
   {wait:'Repository profile',send:'protection.fields.required_approvals\r'},
   {wait:'staged value',send:'Edit value\r'},
   {wait:'whole number',send:'\x153\r'},
   {wait:'Repository profile',send:'protection.initial.priority\r'},
   {wait:'staged value',send:'Edit value\r'},
   {wait:'whole number',send:'\x152\r'},
  ]:[
   {wait:'Repository profile',send:'protection.initial.merge_access_level\r'},
   {wait:'staged value',send:'30\r'},
  ];
  const count=Object.keys(plans).length,requestsBeforeStaging=String(server.requests.length);
  await fs.writeFile(requestMarker,requestsBeforeStaging,{mode:0o600});
  await terminal(provider+'-common-preview',[
   {wait:'Model: not selected',send:'/repo\x1b\r'},
   {wait:'Repository management',send:'Registered targets\r'},
   {wait:'Registered repository targets',send:provider+'\r'},
   {wait:'retained identity only',send:'New configuration preview\r'},
   {wait:'New configuration preview',send:'Edit recommendation fields\r'},
   {wait:'Native protection operation',send:'Create new rule\r'},
   {wait:'Literal branch / native protection rule',send:'\r'},
   ...edit,
   {wait:'Repository profile',send:'Use staged profile\r'},
   {wait:'Staged profile',textFiles:[{path:requestMarker,value:requestsBeforeStaging}],queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[count]]}],send:'\x1b'},
   {wait:'Private repository credential JSON file',send:credential+'\r'},
   {wait:'Retained preview',send:'\x1b'},
   {wait:'Registered repository targets',send:'Back\r'},
   {wait:'Repository management',send:'Close\r'},
   {wait:'INPUT',send:'/quit\x1b\r'},
  ]);
  const planId=dbRead(db=>db.prepare('SELECT id FROM effect_operations WHERE target=? ORDER BY rowid DESC LIMIT 1').get(target.targetId).id),plan=await cli('plan',['--plan',planId]);assert.equal(plan.phase,'PREVIEWED');assert.equal(budget(plan.workId).consumed,1);
  await terminal(provider+'-explicit-apply',[
   {wait:'Model: not selected',send:'/repo\x1b\r'},
   {wait:'Repository management',send:'Retained configuration plans\r'},
   {wait:'Retained repository plans',send:planId+'\r'},
   {wait:'Repository plan',send:'Review changes for application\r'},
   {wait:'Review configuration changes',send:'\x1b'},
   {wait:'Explicit owner action',send:'\r'},
   {wait:'Repository plan',queries:[{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[planId],rows:[['PREVIEWED']]},{sql:"SELECT COUNT(*) FROM effect_receipts WHERE operation=? AND kind='configuration-step-attempt'",params:[planId],rows:[[0]]}],send:'Review changes for application\r'},
   {wait:'Review configuration changes',send:'\x1b'},
   {wait:'Explicit owner action',send:'Apply original\r'},
   {wait:'Private repository credential JSON file',send:credential+'\r'},
   {wait:'Repository outcome',send:'\x1b'},
   {wait:'Repository plan',send:'Back\r'},
   {wait:'Retained repository plans',send:'Back\r'},
   {wait:'Repository management',send:'Close\r'},
   {wait:'INPUT',send:'/quit\x1b\r'},
  ]);
  const applied=await cli('plan',['--plan',planId]);assert.equal(applied.phase,provider==='gitlab'?'UNKNOWN':'CONFIRMED');assert.equal(budget(plan.workId).consumed,provider==='gitlab'?3:2);assert.equal(budget(plan.workId).reserved,0);assert.equal(server.requests.filter(r=>r.method==='POST').length,1);assert.equal(server.state.protection.rule_name??server.state.protection.name,'main');
  if(provider==='gitea'){
   assert.equal((await cli('audit',['--plan',plan.planId,'--credential-profile',credential])).complete,true);assert.equal(budget(plan.workId).consumed,3);
   const before=budget(plan.workId),guide=await cli('guide',['--target',target.targetId,'--branch','main','--credential-profile',credential]);assert.equal(guide.targetId,target.targetId);assert.equal(guide.observation.selectedBranch,'main');assert.equal(guide.observation.observations.effectiveRule.state,'OBSERVED');assert.deepEqual(budget(plan.workId),before);
  }
  plans[provider]={target,plan,server};
 }
 const {plan,server}=plans.gitlab,before=budget(plan.workId),file=path.join(root,'installed-ui.json'),counts=()=>dbRead(db=>['works','runs','sources','effect_receipts'].map(table=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n)),beforeCounts=counts(),beforeRequests=server.requests.length;
 const inspectionQueries=dbRead(db=>['effect_operations','works','runs','sources','budgets','effect_receipts','effect_delegations'].map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>Object.values(row))})));
 await fs.writeFile(marker,String(beforeRequests),{mode:0o600});
 // An external read-only witness takes a complete operation snapshot at the inspection boundary.
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management',send:'Retained configuration plans\r'},
  {wait:'Retained repository plans',send:'group/subgroup/repo\r'},
  {wait:'Repository plan',send:'Inspect original plan and observations\r'},
  {wait:'Original configuration',textFiles:[{path:marker,value:String(beforeRequests)}],queries:[...inspectionQueries,{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[plan.planId],rows:[['UNKNOWN']]},{sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[plan.workId],rows:[[before.consumed,0]]}],send:'\x1b'},
  {wait:'Repository plan',send:'Reconcile original request\r'},
  {wait:'Private repository credential JSON file',send:credential+'\r'},
  {wait:'Repository outcome',queries:[{sql:'SELECT phase,work FROM effect_operations WHERE id=?',params:[plan.planId],rows:[['CONFIRMED',plan.workId]]},{sql:"SELECT json_extract(data,'$.steps[1].nativeResource.id') FROM effect_operations WHERE id=?",params:[plan.planId],rows:[[21]]},{sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[plan.workId],rows:[[before.consumed+2,0]]}],send:'\x1b'},
  {wait:'Repository plan',send:'Back\r'},
  {wait:'Retained repository plans',send:'Back\r'},
  {wait:'Repository management',send:'Close\r'},
  {wait:'INPUT',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'/quit\x1b\r'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[command],env,steps,timeoutSeconds:15,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}),{mode:0o600});
 const ui=JSON.parse(await run('/usr/bin/python3',[path.join(source,'tests/cli/fork-ui-pty.py'),file],'installed-ui',{timeout:20000}));assert.equal(ui.stages,steps.length);assert.equal(ui.exitCode,0);assert.equal(ui.terminalRestored,true);
 const reopened=await cli('plan',['--plan',plan.planId]);assert.equal(reopened.workId,plan.workId);assert.equal(reopened.phase,'CONFIRMED');assert.equal(reopened.steps[1].nativeResource.id,21);assert.equal(budget(plan.workId).consumed,before.consumed+2);assert.equal(budget(plan.workId).lim,before.lim);
 const afterCounts=counts();assert.equal(afterCounts[0],beforeCounts[0]);assert.equal(afterCounts[1],beforeCounts[1]+2,'only original step reconciliation runs');assert.equal(afterCounts[2],beforeCounts[2]);assert.equal(server.requests.filter(r=>r.method==='POST').length,1);assert.ok(server.requests.slice(beforeRequests).every(r=>r.method==='GET'));assert.doesNotMatch(await fs.readFile(file+'.terminal','utf8'),/fixture-native-token|fixture-private-native/);
 assert.equal((await cli('audit',['--plan',plan.planId,'--credential-profile',credential])).complete,true);assert.equal(budget(plan.workId).consumed,before.consumed+4);assert.equal(budget(plan.workId).reserved,0);assert.equal(server.requests.filter(r=>r.method==='POST').length,1);
 const guidance=[];
 for(const [provider,{target,plan,server}] of Object.entries(plans)){
  const ledger=()=>dbRead(db=>JSON.stringify(['works','runs','budgets','effect_operations','effect_delegations','effect_receipts','effect_targets','sources','requirements'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]))),beforeGuide=ledger(),writes=server.requests.filter(request=>request.method!=='GET').length;
  const args=['--target',target.targetId,'--branch','main','--credential-profile',credential],guide=await cli('guide',args),observations=guide.observation.observations;
  assert.equal(guide.targetId,target.targetId);assert.equal(guide.observation.provider,provider);assert.equal(guide.observation.status,'OBSERVED');
  const observed=(field,value)=>{assert.equal(field.state,'OBSERVED');assert.deepEqual(field.value,value);};
  if(provider==='gitea'){
   observed(observations.effectiveRule.value.required_approvals,3);observed(observations.effectiveRule.value.priority,2);
   observed(observations.branch.value.fields.required_approvals,3);assert.equal(server.state.protection.required_approvals,3);assert.equal(server.state.protection.priority,2);
   observed(guide.observation.repository.settings.allow_merge_commits,true);
  }else{
   observed(guide.observation.repository.settings.only_allow_merge_if_pipeline_succeeds,true);
   observed(guide.observation.repository.settings.only_allow_merge_if_all_discussions_are_resolved,true);
   observed(guide.observation.repository.settings.allow_merge_on_skipped_pipeline,false);
   const rule=observations.protectionInventory.value.find(rule=>rule.id.value===21);observed(rule.inherited,false);observed(rule.merge_access_levels.value[0].access_level,30);observed(rule.push_access_levels.value[0].access_level,0);observed(rule.unprotect_access_levels.value[0].access_level,40);observed(rule.allow_force_push,false);
   observed(observations.approvalRules.value[0].approvals_required,2);observed(observations.approvalRules.value[0].contains_hidden_groups,true);
   assert.equal(server.state.repository.merge_method,'merge');assert.equal(server.state.repository.squash_option,'default_off');
  }
  assert.equal(server.state.repository.description,'preserve-unrelated');
  server.state.guidePartial=true;let partial;try{partial=await cli('guide',args);}finally{server.state.guidePartial=false;}
  assert.equal(partial.observation.status,'PARTIAL');assert.equal(partial.observation.observations[provider==='gitea'?'effectiveRule':'approvalRules'].state,'UNAVAILABLE');
  assert.ok(!Object.hasOwn(partial.observation.observations[provider==='gitea'?'effectiveRule':'approvalRules'],'value'));
  for(const fault of ['actor','repository']){
   const previous=fault==='actor'?server.state.actorId:server.state.repository.id;
   if(fault==='actor')server.state.actorId=8;else server.state.repository.id=10;
   try{await run(command,['repo','guide',...args],provider+'-refuse-'+fault,{expected:2});const error=invocations.at(-1).err;assert.match(error,/identity|actor|repository|target/i);assert.doesNotMatch(error,/fixture-native-token|fixture-private-native/);}
   finally{if(fault==='actor')server.state.actorId=previous;else server.state.repository.id=previous;}
  }
  assert.equal(ledger(),beforeGuide);assert.equal(server.requests.filter(request=>request.method!=='GET').length,writes);
  guidance.push({provider,targetId:target.targetId,planId:plan.planId,observation:guide.observation,partial:partial.observation});
  if(afterGuide){
   const nativeBefore=JSON.stringify({repository:server.state.repository,protection:server.state.protection});
   await afterGuide({provider,guide,partial,plan:await cli('plan',['--plan',plan.planId]),target,root,payload,command,run,env});
   assert.equal(ledger(),beforeGuide,'Developer local work cannot change the administrator ledger');
   assert.equal(server.requests.filter(request=>request.method!=='GET').length,writes,'Developer local work cannot apply native hosting settings');
   assert.equal(JSON.stringify({repository:server.state.repository,protection:server.state.protection}),nativeBefore);
   await fs.writeFile(path.join(root,provider+'-developer-admin-preservation.json'),JSON.stringify({provider,targetId:target.targetId,planId:plan.planId,before:JSON.parse(beforeGuide),after:JSON.parse(ledger()),nativeBefore:JSON.parse(nativeBefore),nativeAfter:{repository:server.state.repository,protection:server.state.protection},writeCount:writes,afterWriteCount:server.requests.filter(request=>request.method!=='GET').length},null,2),{mode:0o600});
  }
 }
 await fs.writeFile(path.join(root,'guidance.json'),JSON.stringify(guidance,null,2),{mode:0o600});
 // No agent producer, model or engine work was admitted; this is an owner configuration journey.
 dbRead(db=>{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversation_inputs').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM capacity_leases').get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM works WHERE json_extract(data,'$.kind')!='repository-configuration'").get().n,0);});
 await fs.writeFile(path.join(root,'scope.json'),JSON.stringify({installed,payload,plans:Object.fromEntries(Object.entries(plans).map(([provider,p])=>[provider,{planId:p.plan.planId,workId:p.plan.workId}])),invocations:invocations.map(({label,pid,code,signal,expired})=>({label,pid,code,signal,expired})),scope:'Current actual npm snapshot, original model-free CLI/UI, owned synthetic HTTPS only. Not live-provider, engine, actual-model or immutable offline-bundle qualification.'}),{mode:0o600});
 passed=true;
}
