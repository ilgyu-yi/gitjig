import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {offlineSourceInstallation,installationProcessRunner,inventory} from './offline-source-fixture.mjs';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
import {nativeConfigurationFixture,createdProtection} from '../platform/repository-configuration-fixture.mjs';

// Real npm snapshot and original installed launcher. Only hosting responses are synthetic.
// No source import hook, execution engine, model, personal prefix or live hosting service.
export async function installedRepositoryJourney(t,{fixtureRoot,branchHeads={},afterGuide,retain=false}={}){
 const source=await fs.realpath('.');
 const servers=[];
 const f=await offlineSourceInstallation(t,'repository',{fixtureRoot,retain,beforeCleanup:async()=>{for(const server of servers)await server.close();}});
 const {root,home,invocations,groups,payload,command}=f,credential=path.join(root,'credential.json');
 const tls=await repositoryTlsFixture(t),env={...f.env,NODE_EXTRA_CA_CERTS:tls.cert};
 const run=installationProcessRunner({root,env,invocations,groups,signal:t.signal,cwd:f.cwd});
 await fs.writeFile(credential,'{"token":"fixture-native-token"}',{mode:0o600});
 const installed=await fs.realpath(command);
 const dependencies=['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-tui','@gitjig/pi-claude-bridge-host'];
 const resolved=JSON.parse(await run(process.execPath,['--input-type=module','-e','console.log(JSON.stringify('+JSON.stringify(dependencies)+'.map(name=>import.meta.resolve(name))))'],'installed-dependencies',{workdir:payload}));for(const entry of resolved)assert.ok((await fs.realpath(fileURLToPath(entry))).startsWith(payload+'/node_modules/'),'installed ESM dependency');
 const cli=async(action,args=[],options={})=>{const out=await run(command,['repo',action,...args],action+'-'+invocations.length,options);assert.doesNotMatch(out,/fixture-native-token|fixture-private-native/);return JSON.parse(out);};
 const terminal=async(label,steps,environment=env)=>{const file=path.join(root,label+'.json');await fs.writeFile(file,JSON.stringify({command:[command],env:environment,steps,timeoutSeconds:18,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}),{mode:0o600});const result=JSON.parse(await run('/usr/bin/python3',[path.join(source,'tests/cli/fork-ui-pty.py'),file],label,{timeout:23000}));assert.equal(result.stages,steps.length);assert.equal(result.exitCode,0);assert.equal(result.terminalRestored,true);const output=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(output,/fixture-native-token|fixture-private-native/);return output;};
 const dbRead=callback=>{const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{return callback(db);}finally{db.close();}},budget=work=>dbRead(db=>db.prepare("SELECT lineage,kind,lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'").get(work));
 const plans={},marker=path.join(root,'gitlab-request-count');
 for(const provider of ['gitea','gitlab']){
  const requestMarker=path.join(root,provider+'-staging-request-count');
  const activityMarker=path.join(root,provider+'-activity-entered'),activityRelease=activityMarker+'.release';
  const readEntered=path.join(root,provider+'-reconcile-read-entered'),readStopped=path.join(root,provider+'-reconcile-read-stopped');
  let holdActivity, stopNextRead=false, previewOriginal;
  const awaitActivity=activity=>({wait:activity,waitFiles:[{path:activityMarker,value:activity}],releaseFile:activityRelease,send:''});
  const armActivity=async activity=>{
   await fs.rm(activityRelease,{force:true});
   holdActivity=activity;
  };
  const server=await nativeConfigurationFixture(provider,{tls:tls.tls,absent:true,intercept:async({req,res,relative,body,state,send,requests,url})=>{
   await fs.writeFile(requestMarker,String(requests.length),{mode:0o600});
   if(provider==='gitlab')await fs.writeFile(marker,String(requests.length),{mode:0o600});
   if(stopNextRead&&req.method==='GET'){
    stopNextRead=false;
    if(!previewOriginal&&provider==='gitea')previewOriginal=dbRead(db=>db.prepare("SELECT id,work,target,grant_id FROM effect_operations WHERE phase='PREVIEWING'").get());
    res.once('close',()=>{void fs.writeFile(readStopped,'stopped');});
    await fs.writeFile(readEntered,'entered');
    return true;
   }
   if(holdActivity&&req.method==='GET'){
    const activity=holdActivity;holdActivity=undefined;
    await fs.writeFile(activityMarker,activity,{mode:0o600});
    const limit=Date.now()+8000;
    while(await fs.access(activityRelease).then(()=>false,()=>true)){
     if(Date.now()>=limit){send({},503);return true;}
     await new Promise(resolve=>setTimeout(resolve,10));
    }
   }
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
   {wait:'whole number',send:'\x15101\r'},
   {wait:'Use a whole number from 0 to 100',send:'\x153\r'},
   {wait:'Repository profile',send:'protection.initial.priority\r'},
   {wait:'staged value',send:'Edit value\r'},
   {wait:'whole number',send:'\x152\r'},
  ]:[
   {wait:'Repository profile',send:'protection.initial.merge_access_level\r'},
   {wait:'staged value',send:'30\r'},
  ];
  const count=Object.keys(plans).length,requestsBeforeStaging=String(server.requests.length);
  await fs.writeFile(requestMarker,requestsBeforeStaging,{mode:0o600});
  const previewActivity='Working · Preparing a repository settings preview';
  const previewUnits=provider==='gitea'?2:1;
  await armActivity(previewActivity);
  if(provider==='gitea')stopNextRead=true;
  const preview=await terminal(provider+'-common-preview',[
   {wait:'Model: not selected',send:'/repo\x1b\r'},
   {wait:'Repository management',send:'Registered targets\r'},
   {wait:'Registered repository targets',send:provider+'\r'},
   {wait:'retained identity only',send:'Inspect target identity\r'},
   {wait:'Registered identity · no current permission claim',send:'\x1b'},
   {wait:'retained identity only',send:'New configuration preview\r'},
   {wait:'New configuration preview',send:'Edit recommendation fields\r'},
   {wait:'Native protection operation',send:'Create new rule\r'},
   {wait:'Literal branch / native protection rule',send:'\r'},
   ...edit,
   {wait:'Repository profile',send:'Use staged profile\r'},
   {wait:'Continue to preview credentials',textFiles:[{path:requestMarker,value:requestsBeforeStaging}],queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[count]]}],send:'\x1b'},
   {wait:'Repository profile · staged only',textFiles:[{path:requestMarker,value:requestsBeforeStaging}],queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[count]]}],send:'Use staged profile\r'},
   {wait:'Continue to preview credentials',send:'\r'},
   {wait:'Private repository credential JSON file',send:'\x1b'},
   {wait:'Repository profile · staged only',textFiles:[{path:requestMarker,value:requestsBeforeStaging}],queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[count]]}],send:'Use staged profile\r'},
   {wait:'Continue to preview credentials',send:'\r'},
   {wait:'Private repository credential JSON file',send:path.join(root,'missing-credential.json')+'\r'},
   {wait:'Choose another credential file',textFiles:[{path:requestMarker,value:requestsBeforeStaging}],queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[count]]}],send:'\r'},
   {wait:'Private repository credential JSON file',send:'\x15\x1b[200~'+path.join(root,'invalid\u2028profile.json')+'\x1b[201~\r'},
   {wait:'Enter one line without control characters',textFiles:[{path:requestMarker,value:requestsBeforeStaging}],queries:[{sql:'SELECT COUNT(*) FROM works',rows:[[count]]}],send:'\x15'+credential+'\r'},
   ...provider==='gitea'?[
    {wait:'Esc stops this read',waitFiles:[{path:readEntered,value:'entered'}],send:'\x1b'},
    {wait:'Settings preview stop requested · original plan retained',waitFiles:[{path:readStopped,value:'stopped'}],
     textFiles:[{path:requestMarker,value:String(Number(requestsBeforeStaging)+1)}],queries:[
      {sql:'SELECT phase,json_extract(data,\'$.revision\') FROM effect_operations WHERE target=?',params:[target.targetId],rows:[['REFUSED',1]]},
      {sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[1,0]]},
      {sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='configuration-preview'",rows:[[0]]},
     ],send:'\x1b'},
    {wait:'Repository profile · staged only',send:'Use staged profile\r'},
    {wait:'Continue to preview credentials',send:'\r'},
    {wait:'Private repository credential JSON file',send:credential+'\r'},
   ]:[],
   awaitActivity(previewActivity),
   {wait:'Retained preview',send:'\x1b'},
   {wait:'retained identity only',send:'Back\r'},
   {wait:'Registered repository targets',send:'Back\r'},
   {wait:'Repository management',send:'Close\r'},
   {wait:'INPUT',send:'/quit\x1b\r'},
  ]);
  const previewOutcome=preview.indexOf('Retained preview · apply is a separate explicit action');
  assert.ok(previewOutcome>=0);
  assert.match(preview.slice(0,previewOutcome),/Working · Preparing a repository settings preview/);
  assert.doesNotMatch(preview.slice(previewOutcome),/Preparing a repository settings preview|Repository request in progress/);
  const planId=dbRead(db=>db.prepare('SELECT id FROM effect_operations WHERE target=? ORDER BY rowid DESC LIMIT 1').get(target.targetId).id),plan=await cli('plan',['--plan',planId]);assert.equal(plan.phase,'PREVIEWED');assert.equal(budget(plan.workId).consumed,previewUnits);
  if(provider==='gitea'){
   assert.equal(plan.revision,2);
   const rows=dbRead(db=>db.prepare('SELECT id,work,target,grant_id FROM effect_operations WHERE target=?').all(target.targetId));
   assert.deepEqual(rows,[previewOriginal]);
   assert.equal(plan.plan.profile.protection.fields.required_approvals,3);
   assert.equal(plan.plan.profile.protection.initial.priority,2);
   assert.ok(server.requests.every(request=>request.method==='GET'));
  }
  if(provider==='gitea'){
   const priorBudget=budget(plan.workId), requests=server.requests.length;
   const untouched=[{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[planId],rows:[['PREVIEWED']]},
    {sql:"SELECT COUNT(*) FROM effect_receipts WHERE operation=? AND kind='configuration-step-attempt'",params:[planId],rows:[[0]]}];
   const outcome=await terminal('gitea-korean-consent',[
    {wait:'모델: 선택되지 않음',send:'\x07/'},
    {wait:'gitjig 명령 검색',send:'/repo\r'},
    {wait:'저장소 관리 · 소유자 동작',send:'보존된 설정 계획\r'},
    {wait:'보존된 저장소 설정 계획',send:planId+'\r'},
    {wait:'저장소 설정 계획 · owner/repo',send:'적용할 설정 변경 검토\r'},
    {wait:'적용 확인 열기',send:'\r'},
    {wait:'설정 적용 확인 · 원래 계획',queries:untouched,send:'\r'},
    {wait:'저장소 설정 계획 · owner/repo',queries:untouched,send:'적용할 설정 변경 검토\r'},
    {wait:'적용 확인 열기',send:'\r'},
    {wait:'설정 적용 확인 · 원래 계획',queries:untouched,send:'owner/repo에 원래 설정 적용\r'},
    {wait:'저장소 자격 증명 JSON 파일',send:path.join(root,'missing-credential.json')+'\r'},
    {wait:'다른 자격 증명 파일 선택',queries:untouched,send:'\x1b'},
    {wait:'저장소 설정 계획 · owner/repo',queries:untouched,send:'뒤로\r'},
    {wait:'보존된 저장소 설정 계획',send:'뒤로\r'},
    {wait:'저장소 관리 · 소유자 동작',send:'닫기\r'},
    {wait:'입력 · 대화 대기',assertDraft:'',send:'\x07q'},
   ],{...env,LANG:'ko_KR.UTF-8',LC_ALL:'ko_KR.UTF-8'});
   assert.ok(outcome.includes(server.target.apiBase));
   assert.ok(outcome.includes('파일 선택을 기다리고 있습니다.'));
   assert.equal(server.requests.length,requests);
   assert.deepEqual(budget(plan.workId),priorBudget);
  }
  const applyActivity='Working · Applying the selected repository settings';
  await armActivity(applyActivity);
  const applyScreen=await terminal(provider+'-explicit-apply',[
   {wait:'Model: not selected',send:'/repo\x1b\r'},
   {wait:'Repository management',send:'Retained configuration plans\r'},
   {wait:'Retained repository plans',send:planId+'\r'},
   {wait:'Repository plan',send:'Review changes for application\r'},
   {wait:'Open Apply confirmation',send:'\x1b'},
   {wait:'Repository plan',queries:[{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[planId],rows:[['PREVIEWED']]}],send:'Review changes for application\r'},
   {wait:'Open Apply confirmation',send:'\r'},
   {wait:'Explicit owner action',send:'\r'},
   {wait:'Repository plan',queries:[{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[planId],rows:[['PREVIEWED']]},{sql:"SELECT COUNT(*) FROM effect_receipts WHERE operation=? AND kind='configuration-step-attempt'",params:[planId],rows:[[0]]}],send:'Review changes for application\r'},
   {wait:'Open Apply confirmation',send:'\r'},
   {wait:'Explicit owner action',send:'Apply original\r'},
   {wait:'Private repository credential JSON file',send:credential+'\r'},
   awaitActivity(applyActivity),
   {wait:'Repository outcome',send:'\x1b'},
   {wait:'Repository plan',send:'Back\r'},
   {wait:'Retained repository plans',send:'Back\r'},
   {wait:'Repository management',send:'Close\r'},
   {wait:'INPUT',send:'/quit\x1b\r'},
  ]);
  assert.match(applyScreen,/Working · Applying the selected repository settings/);
  const applied=await cli('plan',['--plan',planId]);assert.equal(applied.phase,provider==='gitlab'?'UNKNOWN':'CONFIRMED');assert.equal(budget(plan.workId).consumed,previewUnits+(provider==='gitlab'?2:1));assert.equal(budget(plan.workId).reserved,0);assert.equal(server.requests.filter(r=>r.method==='POST').length,1);assert.equal(server.state.protection.rule_name??server.state.protection.name,'main');
  if(provider==='gitea'){
   assert.equal((await cli('audit',['--plan',plan.planId,'--credential-profile',credential])).complete,true);assert.equal(budget(plan.workId).consumed,previewUnits+2);
   const before=budget(plan.workId),guide=await cli('guide',['--target',target.targetId,'--branch','main','--credential-profile',credential]);assert.equal(guide.targetId,target.targetId);assert.equal(guide.observation.selectedBranch,'main');assert.equal(guide.observation.observations.effectiveRule.state,'OBSERVED');assert.deepEqual(budget(plan.workId),before);
   const previous=server.state.protection.required_approvals, requests=server.requests.length;
   const auditDraft='이 설정 계획과 별개의 입력 초안';
   const auditLedger=dbRead(db=>['effect_operations','works','sources','effect_receipts','effect_delegations'].map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>Object.values(row))})));
   const auditAllowance=spent=>({sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[plan.workId],rows:[[spent,0]]});
   await fs.rm(readEntered,{force:true});
   await fs.rm(readStopped,{force:true});
   stopNextRead=true;
   server.state.protection.required_approvals=9;
   try {
    const screen=await terminal('gitea-korean-current-audit',[
     {wait:'모델: 선택되지 않음',send:auditDraft+'\x07/'},
     {wait:'gitjig 명령 검색',send:'/repo\r'},
     {wait:'저장소 관리 · 소유자 동작',send:'보존된 설정 계획\r'},
     {wait:'선택한 설정 일치 확인 · CONFIRMED',send:planId+'\r'},
     {wait:'저장소 설정 계획 · owner/repo',send:'선택한 현재 설정 조회\r'},
     {wait:'저장소 자격 증명 JSON 파일',send:credential+'\r'},
     {wait:'Esc',waitFiles:[{path:readEntered,value:'entered'}],send:'\x1b'},
     {wait:'현재 설정 조회 중단 요청 · 원래 계획 보존',waitFiles:[{path:readStopped,value:'stopped'}],textFiles:[{path:requestMarker,value:String(requests+1)}],
      queries:[...auditLedger,auditAllowance(before.consumed+1)],assertDraft:auditDraft,send:'\x1b'},
     {wait:'저장소 설정 계획 · owner/repo',assertDraft:auditDraft,send:'선택한 현재 설정 조회\r'},
     {wait:'저장소 자격 증명 JSON 파일',send:credential+'\r'},
     {wait:'현재 설정 조회 · 일치 확인 미완료',queries:[{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[planId],rows:[['CONFIRMED']]}],send:'\x1b[6~'},
     {wait:'protection.required_approvals: "conflicting" · 현재 값 9',send:'\x1b'},
     {wait:'저장소 설정 계획 · owner/repo',send:'뒤로\r'},
     {wait:'보존된 저장소 설정 계획',send:'뒤로\r'},
     {wait:'저장소 관리 · 소유자 동작',send:'닫기\r'},
     {wait:'입력 · 대화 대기',assertDraft:auditDraft,send:'\x15\x07q'},
    ],{...env,LANG:'ko_KR.UTF-8',LC_ALL:'ko_KR.UTF-8'});
    assert.match(screen,/원래 요청의 기록 상태: "CONFIRMED"/);
    assert.match(screen,/required_approvals: "conflicting" · 현재 값 9/);
    assert.equal(budget(plan.workId).consumed,before.consumed+2);
    assert.ok(server.requests.length>requests && server.requests.slice(requests).every(request=>request.method==='GET'));
   } finally {server.state.protection.required_approvals=previous;}
  }
  const requestsBeforePolicy=String(server.requests.length),policyBudget=budget(plan.workId);
  const noPolicyRequests=[{path:requestMarker,value:requestsBeforePolicy}];
  const policyDraft='Keep this branch policy draft · 한글';
  const policyLedger=dbRead(db=>['effect_operations','works','runs','sources','budgets','effect_receipts','effect_delegations'].map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>Object.values(row))})));
  if(provider==='gitea'){
   await fs.rm(readEntered,{force:true});
   await fs.rm(readStopped,{force:true});
   stopNextRead=true;
  }
  const policyScreen=await terminal(provider+'-branch-correction',[
   {wait:'Model: not selected',send:policyDraft+'\x07/'},
   {wait:'Gitjig commands · search',send:'/repo\r'},
   {wait:'Repository management',send:'Registered targets\r'},
   {wait:'Registered repository targets',send:provider+'\r'},
   {wait:'retained identity only',send:'Inspect current branch policy\r'},
   {wait:'Existing branch',send:'\r'},
   {wait:'Enter a branch name between 1 and 1024 characters',textFiles:noPolicyRequests,send:'\x1b'},
   {wait:'retained identity only',textFiles:noPolicyRequests,send:'Inspect current branch policy\r'},
   {wait:'Existing branch',send:'\r'},
   {wait:'Enter a branch name between 1 and 1024 characters',textFiles:noPolicyRequests,send:'main\r'},
   {wait:'Private repository credential JSON file',textFiles:noPolicyRequests,send:credential+'\r'},
   ...provider==='gitea'?[
    {wait:'Esc stops this read. No work execution allowance is used.',waitFiles:[{path:readEntered,value:'entered'}],send:'\x1b'},
    {wait:'Branch policy read stopped',waitFiles:[{path:readStopped,value:'stopped'}],textFiles:[{path:requestMarker,value:String(Number(requestsBeforePolicy)+1)}],queries:policyLedger,assertDraft:policyDraft,send:'\r'},
    {wait:'Private repository credential JSON file',queries:policyLedger,send:credential+'\r'},
   ]:[],
   {wait:provider==='gitlab'?'Project approval rules: OBSERVED':'Selected branch: main',send:'\x1b'},
   {wait:'retained identity only',send:'Back\r'},
   {wait:'Registered repository targets',send:'Back\r'},
   {wait:'Repository management',send:'Close\r'},
   {wait:'INPUT',assertDraft:policyDraft,send:'\x15\x07q'},
  ]);
  if(provider==='gitlab'){
   assert.match(policyScreen,/Require a successful pipeline: OBSERVED true/);
   assert.match(policyScreen,/Allow merge on a skipped pipeline: OBSERVED false/);
   assert.match(policyScreen,/Require all discussions resolved: OBSERVED true/);
   assert.match(policyScreen,/Selected branch is protected: OBSERVED true/);
  }
  assert.deepEqual(budget(plan.workId),policyBudget);
  plans[provider]={target,plan,server,readEntered,readStopped,armStopRead:()=>{stopNextRead=true;}};
 }
 const decoyProfile=path.join(root,'separate-preview.json');
 await fs.writeFile(decoyProfile,JSON.stringify(plans.gitea.server.profile),{mode:0o600});
 const decoy=await cli('preview',['--target',plans.gitea.target.targetId,'--profile',decoyProfile,'--credential-profile',credential]);
 const {plan,server,readEntered,readStopped,armStopRead}=plans.gitlab,before=budget(plan.workId),file=path.join(root,'installed-ui.json'),counts=()=>dbRead(db=>['works','runs','sources','effect_receipts'].map(table=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n)),beforeCounts=counts(),beforeRequests=server.requests.length;
 const first=await cli('plans');
 assert.equal(first.plans[0].planId,decoy.planId);
 const inspectionQueries=dbRead(db=>['effect_operations','works','runs','sources','budgets','effect_receipts','effect_delegations'].map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>Object.values(row))})));
 await fs.writeFile(marker,String(beforeRequests),{mode:0o600});
 armStopRead();
 // An external read-only witness takes a complete operation snapshot at the inspection boundary.
 const steps=[
  {wait:'모델: 선택되지 않음',send:'\x07/'},
  {wait:'gitjig 명령 검색',send:'/repo\r'},
  {wait:'저장소 관리 · 소유자 동작',send:'보존된 설정 계획\r'},
  {wait:'결과 미확인 · UNKNOWN',send:'group/subgroup/repo\r'},
  {wait:'저장소 설정 계획 · group/subgroup/repo',send:'원래 계획과 관찰 기록 보기\r'},
  {wait:'원래 설정 계획 · 기록 조회',textFiles:[{path:marker,value:String(beforeRequests)}],queries:[...inspectionQueries,{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[plan.planId],rows:[['UNKNOWN']]},{sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[plan.workId],rows:[[before.consumed,0]]}],send:'\x1b'},
  {wait:'저장소 설정 계획 · group/subgroup/repo',send:'원래 요청 결과 확인 · 읽기 전용\r'},
  {wait:'저장소 자격 증명 JSON 파일',queries:inspectionQueries,send:'\x1b'},
  {wait:'저장소 설정 계획 · group/subgroup/repo',queries:inspectionQueries,textFiles:[{path:marker,value:String(beforeRequests)}],send:'뒤로\r'},
  {wait:'보존된 저장소 설정 계획',send:'\r'},
  {wait:'저장소 설정 계획 · group/subgroup/repo',queries:inspectionQueries,send:'원래 요청 결과 확인 · 읽기 전용\r'},
  {wait:'저장소 자격 증명 JSON 파일',send:credential+'\r'},
  {wait:'Esc',waitFiles:[{path:readEntered,value:'entered'}],send:'\x1b'},
  {wait:'설정 결과 조회 중단 요청 · 원래 계획 보존',waitFiles:[{path:readStopped,value:'stopped'}],textFiles:[{path:marker,value:String(beforeRequests+1)}],queries:[
   ...inspectionQueries.filter(query=>!/\b(?:runs|budgets)\b/.test(query.sql)),
   {sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[plan.workId],rows:[[before.consumed+1,0]]},
  ],send:'\x1b'},
  {wait:'저장소 설정 계획 · group/subgroup/repo',send:'원래 요청 결과 확인 · 읽기 전용\r'},
  {wait:'저장소 자격 증명 JSON 파일',send:credential+'\r'},
  {wait:'저장소 설정 결과 · 적용 범위와 다음 동작 확인',queries:[{sql:'SELECT phase,work FROM effect_operations WHERE id=?',params:[plan.planId],rows:[['CONFIRMED',plan.workId]]},{sql:"SELECT json_extract(data,'$.steps[1].nativeResource.id') FROM effect_operations WHERE id=?",params:[plan.planId],rows:[[21]]},{sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[plan.workId],rows:[[before.consumed+2,0]]}],send:'\x1b'},
  {wait:'저장소 설정 계획 · group/subgroup/repo',send:'뒤로\r'},
  {wait:'보존된 저장소 설정 계획',send:'뒤로\r'},
  {wait:'저장소 관리 · 소유자 동작',send:'닫기\r'},
  {wait:'입력 · 대화 대기',queries:[{sql:'SELECT draft FROM conversation_views',rows:[['']]}],assertDraft:'',send:'\x07q'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[command],env:{...env,LANG:'ko_KR.UTF-8',LC_ALL:'ko_KR.UTF-8'},steps,timeoutSeconds:15,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}),{mode:0o600});
 const ui=JSON.parse(await run('/usr/bin/python3',[path.join(source,'tests/cli/fork-ui-pty.py'),file],'installed-ui',{timeout:20000}));assert.equal(ui.stages,steps.length);assert.equal(ui.exitCode,0);assert.equal(ui.terminalRestored,true);
 const reopened=await cli('plan',['--plan',plan.planId]);assert.equal(reopened.workId,plan.workId);assert.equal(reopened.phase,'CONFIRMED');assert.equal(reopened.steps[1].nativeResource.id,21);assert.equal(budget(plan.workId).consumed,before.consumed+2);assert.equal(budget(plan.workId).lim,before.lim);
 const afterCounts=counts();assert.equal(afterCounts[0],beforeCounts[0]);assert.equal(afterCounts[1],beforeCounts[1]+2,'on the unresolved step, stop one read and explicitly admit one more');assert.equal(afterCounts[2],beforeCounts[2]);assert.equal(server.requests.filter(r=>r.method==='POST').length,1);assert.ok(server.requests.slice(beforeRequests).every(r=>r.method==='GET'));const reconciledTerminal=await fs.readFile(file+'.terminal','utf8');
 assert.doesNotMatch(reconciledTerminal,/fixture-native-token|fixture-private-native|적용할 설정 변경 검토/);
 assert.match(reconciledTerminal,/원래 요청 결과 확인 · 읽기 전용/);
 assert.match(reconciledTerminal,/선택한 현재 설정 조회 · 읽기 전용/);
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
  server.state.guidePartial=true;
  let partial;
  try{
   partial=await cli('guide',args);
   if(provider==='gitlab'){
    const screen=await terminal('gitlab-branch-partial',[
     {wait:'Model: not selected',send:'/repo\x1b\r'},
     {wait:'Repository management',send:'Registered targets\r'},
     {wait:'Registered repository targets',send:'gitlab\r'},
     {wait:'retained identity only',send:'Inspect current branch policy\r'},
     {wait:'Existing branch',send:'main\r'},
     {wait:'Private repository credential JSON file',send:credential+'\r'},
     {wait:'Project approval rules: UNAVAILABLE',send:'\x1b'},
     {wait:'retained identity only',send:'Back\r'},
     {wait:'Registered repository targets',send:'Back\r'},
     {wait:'Repository management',send:'Close\r'},
     {wait:'INPUT',assertDraft:'',send:'\x07q'},
    ]);
    assert.match(screen,/Project approval rules: UNAVAILABLE · "Native collection unavailable \(HTTP 403\)/);
    assert.match(screen,/Require a successful pipeline: OBSERVED true/);
    assert.doesNotMatch(screen,/Project approval rules: OBSERVED/);
   }
  }finally{server.state.guidePartial=false;}
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
 dbRead(db=>{assert.deepEqual(db.prepare('SELECT id FROM works ORDER BY id').all().map(row=>row.id),[decoy.workId,...Object.values(plans).map(entry=>entry.plan.workId)].sort());assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversation_inputs').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM capacity_leases').get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM works WHERE json_extract(data,'$.kind')!='repository-configuration'").get().n,0);});
 await fs.writeFile(path.join(root,'scope.json'),JSON.stringify({installed,payload,plans:Object.fromEntries(Object.entries(plans).map(([provider,p])=>[provider,{planId:p.plan.planId,workId:p.plan.workId}])),invocations:invocations.map(({label,pid,code,signal,expired})=>({label,pid,code,signal,expired})),scope:'Current actual npm snapshot, original model-free CLI/UI, owned synthetic HTTPS only. Not live-provider, engine, actual-model or immutable offline-bundle qualification.'}),{mode:0o600});
 assert.deepEqual(await inventory(payload),f.payloadBefore);await f.assertCurrent();assert.equal(groups.size,0);
 f.pass();
}
