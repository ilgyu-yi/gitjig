// Actual public CLI/TUI over explicitly seeded recorded procedure status. No model/engine or delivery qualification.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile),packageRoot=path.resolve(process.env.GITJIG_TEST_PACKAGE_ROOT??'.'),entry=process.env.GITJIG_TEST_CLI_ENTRY??path.join(packageRoot,'dist/cli/entry.js');
const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[];
const load=file=>import(pathToFileURL(path.join(packageRoot,'dist',file)).href);
const {openController}=await load('controller/index.js'),{freeze,delta,hash}=await load('controller/change-files.js'),{caseDescriptor,compareCases}=await load('controller/check-cases.js'),{uiText}=await load('ui/i18n.js');
const {parseCheckOutput}=await load('workflow/protocol.js');
const parse=JSON.parse, tables=['works','sources','requirements','change_state','change_versions','runs','budgets','obligations','effect_targets','effect_delegations','effect_operations','check_runs','role_launches','role_outputs','conversation_inputs','conversation_directions'];
const localReceiver={id:'local-a',name:'/retained/release-receiver.git'};
const hostedReceiver={id:'github-a',name:'fixture-owner/release-receiver'};
const unavailableReceiver={id:'local-unavailable',name:'/retained/unavailable-receiver.git'};
const blockingOperation='blocking-original';
const unavailableOperation='unavailable-original';
const ledger=store=>Object.fromEntries(tables.map(table=>[table,store.all('SELECT * FROM '+table+' ORDER BY rowid').map(row=>({...row}))]));
async function seed(root,locale,uncertain=false,emptyReceivers=false,caseMismatch=false){
 const home=path.join(root,'home'),c=await openController({installationHome:home});
 try {
 for(const id of ['A','B']){const source=path.join(root,id);await fs.mkdir(source);await fs.writeFile(path.join(source,'file.txt'),'Original '+id);await c.registerProject({id,sourceRoot:source});}
 const started=await c.beginChange({projectId:'A',request:'SYNTHETIC_RECORDED_RESULT: controlled review/check records, never executed. Preserve original result identity.'}),workId=started.workId,f={root,home,c};
    const selected = f.c.store.one('SELECT * FROM change_state WHERE work=?', workId);
    const base = f.c.store.one('SELECT * FROM change_versions WHERE id=?', selected.base);
    const working = path.join(f.root, 'candidate-source'), artifact = path.join(f.home, 'inputs', 'result-candidate');
    await fs.cp(base.artifact, working, {recursive:true});
    await fs.writeFile(path.join(working, 'file.txt'), 'Changed candidate\n');
    await fs.writeFile(path.join(working, 'added.txt'), 'New output\n');
    const frozen = await freeze(working, artifact, {}), candidate = 'result-candidate';
    const candidateData = {manifest:frozen.manifest, delta:delta(parse(base.data).manifest, frozen.manifest), producer:'synthetic-fixture-author'};
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', candidate, workId, 'candidate', base.id, artifact, frozen.digest, JSON.stringify(candidateData));
    const check = {id:'behavior', command:'synthetic-not-executed', assertions:['value'], timeoutMs:1000,
        guaranteeIds:['R'], fixturePaths:['file.txt'], cases:['healthy','adverse'].map(kind=>({id:kind, kind,
            guaranteeIds:['R'], derivation:'Controlled required case', consumerPaths:['file.txt'],
            input:{literalUtf8:kind, fixturePaths:['file.txt']}, expected:{kind:'return', value:'Expected observation'}}))};
    const verification = {checks:[check], requiredPaths:['file.txt'], reviewRoles:[{key:'behavior-review', kind:'reviewer', purpose:'Behavior review', requiredPaths:['file.txt']}]};
    const plan = {requirements:[{id:'R', text:'Retain correct changed output'}], verification};
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'result-plan', workId, 'plan', null, null, hash(plan), JSON.stringify({plan}));
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'result-verification', workId, 'verification', null, null, hash(verification), JSON.stringify({verification}));
    const data = {...parse(selected.data), selection:{}, blocked:[], nextAction:'Run the required checks'};
    f.c.store.run('UPDATE change_state SET candidate=?,plan=?,verification=?,phase=?,data=? WHERE work=?', candidate, 'result-plan', 'result-verification', 'CANDIDATE_CAPTURED', JSON.stringify(data), workId);
    const work = f.c.store.one('SELECT * FROM works WHERE id=?', workId);
    const tuple = {base:base.id, candidate, plan:'result-plan', verification:'result-verification', contracts:data.contractsVersion, requirements:data.requirementVersion??null};
    function receipt(id, status, declaration=check, overrides={}) {
        const run = f.c.store.one('SELECT id FROM runs WHERE work=?', workId).id;
        const descriptor = caseDescriptor(declaration, {hash:frozen.digest, data:{manifest:frozen.manifest}}, tuple, run);
        const output = {version:1, assertions:[{id:'value', passed:status==='pass'}], cases:descriptor.cases.map(c=>({id:c.id, inputDigest:c.inputDigest, observed:c.declaration.expected}))};
        const record = {check:declaration, caseDescriptor:descriptor, caseResults:compareCases(declaration, descriptor, output), parsed:{value:output}, cleanup:'removed', durationMs:12, boundVersions:tuple, ...overrides};
        f.c.store.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)', id, workId, run, candidate, tuple.verification, declaration.id, status, JSON.stringify(record));
    }
    function review(id='selected-review', overrides={}) {
        const runId = id+'-run', historyRef = path.join(f.home, 'state', id+'.jsonl');
        f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, workId, work.epoch, work.generation, 'SETTLED', 'retained-not-read', 'consumed', JSON.stringify({cleanup:'removed', historyRef, nativeSessionId:id, nativeCheckpoint:{sessionId:id, leafId:id+'-entry', bytes:1, sha256:'a'.repeat(64)}}));
        const launchData = {inputVersions:tuple, stage:'fresh-review', reviewKey:'behavior-review', purpose:verification.reviewRoles[0].purpose, requiredPaths:verification.reviewRoles[0].requiredPaths, cleanup:'removed', historyRef, nativeSessionId:id, ...overrides};
        f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', id, workId, runId, 'reviewer', work.epoch, 'COMPLETE', 'none', JSON.stringify(launchData));
        const protocol = {version:1, summary:'Retained synthetic reviewer judgment', findings:[], assessedScope:[{sourceId:'candidate:file.txt', startLine:1, endLine:2}], outcome:'clear'};
        const metadata = {protocol, terminal:'complete', rawFinalTruncated:false, omittedFindingCount:0, issues:[], historyRef, nativeEntryId:id+'-entry'};
        f.c.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)', id+'-output', id, JSON.stringify(protocol), 'usable', JSON.stringify(metadata));
        f.c.store.run("UPDATE change_state SET data=json_set(data,'$.selection',json(?)) WHERE work=?", JSON.stringify({'behavior-review':id}), workId);
        return {runId, metadata, protocol};
    }
    function markReady() {
        f.c.store.run('UPDATE works SET state=? WHERE id=?', 'DELIVERED', workId);
        f.c.store.run("UPDATE change_state SET phase=?,data=json_set(data,'$.nextAction',?) WHERE work=?", 'REVIEW_READY', 'local review-ready only', workId);
        assert.equal(f.c.inspectChange(workId).reviewReady, true, 'Controlled retained premise must satisfy the existing assessment');
    }

 if(caseMismatch){
  const run='synthetic-failed-check-run',runtimeProfile={fixture:'retained-check'};
  const history=caseMismatch==='earlier';
  const requirements=history?c.changeCore.newVersion(workId,'requirements',null,{requirements:plan.requirements},hash(plan.requirements)):data.requirementVersion;
  const {contracts,...predicateVersions}=tuple;
  const bound={...predicateVersions,requirements,contracts};
  const descriptor=caseDescriptor(check,{hash:frozen.digest,data:candidateData},bound,run);
  const report={version:1,assertions:[{id:'value',passed:true}],cases:descriptor.cases.map(item=>({
   id:item.id,inputDigest:item.inputDigest,observed:{kind:'return',value:'Actual recorded observation'},
  }))};
  const stdout=JSON.stringify(report);
  c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,workId,work.epoch,work.generation,'SETTLED','fixture','consumed',
   JSON.stringify({cleanup:'removed',kind:'governed-check',role:null,runtimeProfile}));
  const failedReceipt='synthetic-failed-check',comparison=compareCases(check,descriptor,report);
  c.store.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)',failedReceipt,workId,run,candidate,tuple.verification,check.id,'fail',JSON.stringify({
   check,boundVersions:bound,target:{kind:'candidate',versionId:candidate,digest:frozen.digest},purpose:'required',cleanup:'removed',
   argv:['/bin/bash','-lc',check.command],cwd:'/work',inputHash:hash({candidate:frozen.digest,verification:bound.verification,check,runtime:runtimeProfile}),
   actual:{stdout,exitCode:0},parsed:parseCheckOutput(stdout),caseDescriptor:descriptor,caseResults:comparison,expectations:[],
  }));
  c.store.run("UPDATE change_state SET phase='BLOCKED' WHERE work=?",workId);
  if(history){
   c.store.run('INSERT INTO obligations VALUES(?,?,?)','synthetic-pending-check',workId,JSON.stringify({
    kind:'check',state:'pending',candidate,verification:tuple.verification,failedReceipt,check,checkBinding:hash(check),
    expectations:[],caseMismatches:comparison.mismatches,
   }));
   c.store.run("UPDATE change_state SET plan=NULL,verification=NULL,data=json_set(data,'$.resumeStage','plan') WHERE work=?",workId);
   const view=c.inspectChangeResult(workId,{retainedChecks:true});
   assert.equal(view.checks.availability,'not-planned');
   assert.equal(view.reviewReady,false);
   assert.equal(view.replanKind,'check');
   assert.equal(c.inspectWorkRecovery(workId).replanKind,'check');
   assert.equal(c.inspectChangeResult(workId).retainedCheckFailures,undefined);
   assert.deepEqual(view.retainedCheckFailures?.entries,[{checkId:check.id,receiptId:failedReceipt,
    failures:{assertionIds:[],caseIds:['healthy','adverse'],omitted:0}}]);
   const reviewFingerprint=c.inspectChangeReplan(workId).fingerprint;
   const originalPlan=c.store.one('SELECT data FROM change_versions WHERE id=?',tuple.plan).data;
   c.store.run("UPDATE change_versions SET data=json_set(data,'$.fixtureVersionChanged',true) WHERE id=?",tuple.plan);
   assert.notEqual(c.inspectChangeReplan(workId).fingerprint,reviewFingerprint);
   c.store.run('UPDATE change_versions SET data=? WHERE id=?',originalPlan,tuple.plan);
   assert.equal(c.inspectChangeReplan(workId).fingerprint,reviewFingerprint);
   const stored=c.store.one('SELECT data FROM check_runs WHERE id=?',failedReceipt).data;
   c.store.run("UPDATE check_runs SET data=json_set(data,'$.actual.stdout','{}') WHERE id=?",failedReceipt);
   assert.deepEqual(c.inspectChangeResult(workId,{retainedChecks:true,caseValues:true}).retainedCheckFailures,
    {entries:[],omitted:0,unavailable:1});
   assert.equal(c.inspectChangeResult(workId,{retainedChecks:true}).replanKind,undefined);
   assert.equal(c.inspectWorkRecovery(workId).replanKind,undefined);
   c.store.run('UPDATE check_runs SET data=? WHERE id=?',stored,failedReceipt);
   c.store.run('UPDATE change_state SET verification=? WHERE work=?',tuple.verification,workId);
   assert.equal(c.inspectChangeResult(workId,{retainedChecks:true}).retainedCheckFailures,undefined);
   assert.equal(c.inspectChangeResult(workId,{retainedChecks:true}).replanKind,undefined);
   c.store.run('UPDATE change_state SET verification=NULL WHERE work=?',workId);
   c.store.run("UPDATE change_state SET phase='BASE_CAPTURED' WHERE work=?",workId);
   assert.equal(c.inspectChangeResult(workId,{retainedChecks:true}).replanKind,'check');
   c.store.run("UPDATE change_state SET phase='BLOCKED' WHERE work=?",workId);
   const resolution=c.store.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='resolution'",work.lineage);
   c.store.run("UPDATE budgets SET consumed=lim WHERE lineage=? AND kind='resolution'",work.lineage);
   const exhausted=c.inspectChangeResult(workId,{retainedChecks:true});
   assert.deepEqual(exhausted.retainedCheckFailures,view.retainedCheckFailures);
   assert.equal(exhausted.replanKind,undefined);
   c.store.run("UPDATE budgets SET consumed=? WHERE lineage=? AND kind='resolution'",resolution.consumed,work.lineage);
  }else assert.deepEqual(c.inspectChangeResult(workId).checks.entries[0].failures?.caseIds,['healthy','adverse']);
 } else {receipt('synthetic-check','pass');review();markReady();}
 if(!uncertain&&!emptyReceivers){
  const ref='refs/heads/main',ownerUid=process.getuid(),basis={basisCommit:'a'.repeat(40),publicationInventory:['file.txt'],authorizedDeltaPaths:['file.txt']};
  c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',localReceiver.id,'A',JSON.stringify({
   ...basis,kind:'local-git',ownerUid,target:{targetId:localReceiver.id,canonicalPath:localReceiver.name,device:'1',inode:'1',ownerUid,objectFormat:'sha1',ref},
  }));
  const alias='local-alias',blockingWork=(await c.beginChange({projectId:'A',request:'Separate retained transmission fixture'})).workId;
  c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',alias,'A',JSON.stringify({
   ...basis,kind:'local-git',ownerUid,target:{targetId:alias,canonicalPath:localReceiver.name,device:'1',inode:'1',ownerUid,objectFormat:'sha1',ref},
  }));
  c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','original-grant',blockingWork,alias,1,JSON.stringify({
   kind:'local-git',projectId:'A',scope:'work',mode:'ordinary',operationLimit:1,
  }));
  c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',blockingOperation,blockingWork,alias,'original-grant','UNKNOWN',JSON.stringify({
   kind:'local-git',evidence:{workId:blockingWork,versions:{candidate:'other-candidate'}},
  }));
  assert.equal(c.inspectRetainedIntegration(blockingOperation).view?.workId,blockingWork);
  const repository={owner:'fixture-owner',repository:'release-receiver',repositoryId:42,repositoryNodeId:'fixture-node',visibility:'public'};
  c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',hostedReceiver.id,'A',JSON.stringify({
   ...basis,kind:'github-existing-ref',repository,expectedUserId:7,
   target:{host:'github.com',owner:repository.owner,repository:repository.repository,repositoryId:repository.repositoryId,repositoryNodeId:repository.repositoryNodeId,ref},
  }));
  c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',unavailableReceiver.id,'A',JSON.stringify({
   ...basis,kind:'local-git',ownerUid,target:{targetId:unavailableReceiver.id,canonicalPath:unavailableReceiver.name,device:'1',inode:'2',ownerUid,objectFormat:'sha1',ref},
  }));
  c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','unavailable-grant',workId,unavailableReceiver.id,1,JSON.stringify({
   kind:'local-git',projectId:'A',scope:'work',mode:'ordinary',operationLimit:1,
  }));
  c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',unavailableOperation,workId,unavailableReceiver.id,'unavailable-grant','UNKNOWN','{unavailable');
  const {entry:unavailable}=c.inspectRetainedIntegration(unavailableOperation);
  assert.deepEqual({state:unavailable.state,operationId:unavailable.operationId,workId:unavailable.workId,targetId:unavailable.targetId},
   {state:'UNAVAILABLE',operationId:unavailableOperation,workId,targetId:unavailableReceiver.id});
  assert.deepEqual(c.inspectFirstIntegrationPreparation(workId,unavailableReceiver.id).originals.map(row=>({...row})),[{id:unavailableOperation,phase:'UNKNOWN'}]);
 }
 if(!uncertain)for(let index=0;index<26;index++)c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','foreign-'+index,'B','{unavailable');
 if(uncertain){
  c.store.run('UPDATE works SET state=? WHERE id=?',uncertain===true?'UNKNOWN':uncertain,workId);
  const supportingBlockers=Array.from({length:12},(_,i)=>`Retained supporting blocker ${i}: `+'original diagnostic details '.repeat(16));
  c.store.run("UPDATE change_state SET data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify(supportingBlockers),workId);
  const held=c.createConversation({projectId:'A'});
  for(const [kind,mode] of [['owner-conversation-input','idle'],['agent-governed-reentry','reentry']]){
   const revision=kind.startsWith('owner-')?1:2,source=kind+'-source',input=kind+'-input',text='Retained '+kind;
   c.store.run('INSERT INTO sources VALUES(?,?,?,?)',source,held.conversationId,JSON.stringify({kind}),text);
   c.store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)',input,held.conversationId,held.generation,workId,source,'CONSUMED',mode,text,'{}');
   c.store.run('INSERT INTO conversation_directions VALUES(?,?,?,?)',held.conversationId,revision,source,JSON.stringify({inputId:input,affectedWorkId:workId,effectHold:true}));
  }
 }
 const resultProject=caseMismatch==='earlier'?'A':'B',cid=c.createConversation({projectId:resultProject}).conversationId;
 c.setConversationLanguage({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,expectedRevision:0,replyLanguage:locale});
 const draft='KEEP exact 한국어 draft';c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 const before=ledger(c.store);return{home,cid,workId,draft,before,resultProject};
 } finally {await c.close();}
}
async function seedArchivedOrigin(root,locale) {
 const f=await seed(root,locale,false,true,'earlier');
 const c=await openController({installationHome:f.home});
 try {
  const {conversationId,generation}=c.createConversation({projectId:f.resultProject});
  const originalDraft='KEEP restored original 초안';
  c.setDraft({conversationId,expectedRevision:0,text:originalDraft});
  c.setConversationLanguage({conversationId,expectedGeneration:generation,expectedRevision:0,replyLanguage:locale});
  c.store.run("UPDATE sources SET origin=json_set(origin,'$.conversationId',?) WHERE id=(SELECT source FROM works WHERE id=?)",conversationId,f.workId);
  await c.archiveConversation({conversationId,expectedGeneration:generation});
  return {...f,originalId:conversationId,generation,originalDraft,before:ledger(c.store)};
 }finally{await c.close();}
}
function archivedOriginSteps(f,locale) {
 const t=(key,args)=>uiText(locale,key,args), title=t('result.title');
 const archived=t('workRecovery.originArchived',{conversation:f.originalId});
 const keep={assertDraft:f.draft,expectedSelected:f.cid};
 const workTitle=t('workRecovery.title',{id:f.workId,state:'ACTIVE'});
 return [
  {wait:f.draft,...keep,send:'\x07r'},
  {wait:title+' · '+f.resultProject,...keep,send:t('change.registry.all')+'\r'},
  {wait:title+' · '+t('change.registry.allScope'),...keep,send:'SYNTHETIC_RECORDED_RESULT\r'},
  {wait:t('result.openActions'),...keep,send:'\r'},
  {wait:t('result.nextTitle'),...keep,send:t('change.checkReplanAction')+'\r'},
  {wait:archived,...keep,send:'\r'},
  {wait:workTitle,...keep,send:t('workRecovery.reviewArchivedOrigin')+'\r'},
  {wait:t('workRecovery.confirmRestoreOrigin'),...keep,send:'\r'},
  {wait:workTitle,...keep,send:t('workRecovery.reviewArchivedOrigin')+'\r'},
  {wait:t('workRecovery.confirmRestoreOrigin'),...keep,send:t('workRecovery.confirmRestoreOrigin')+'\r'},
  {wait:f.originalDraft,assertDraft:f.originalDraft,expectedSelected:f.originalId,send:'\x07q'},
 ];
}
function assertArchivedOriginRestored(database,f) {
 const db=new DatabaseSync(database,{readOnly:true});
 try {
  for(const [table,rows]of Object.entries(f.before))
   assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows,table);
  const original=db.prepare('SELECT archived,data FROM conversation_state WHERE conversation=?').get(f.originalId);
  assert.equal(original.archived,0);
  assert.equal(JSON.parse(original.data).lifecycle.lastAction.kind,'restore');
  const readDraft=db.prepare('SELECT draft FROM conversation_views WHERE conversation=?');
  assert.equal(readDraft.get(f.originalId).draft,f.originalDraft);
  assert.equal(readDraft.get(f.cid).draft,f.draft);
 }finally{db.close();}
}
for(const locale of ['en','ko'])test('original '+locale+' terminal restores an archived work conversation without resuming work',{timeout:16000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-archived-work-origin-')));
 let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained archived-origin terminal '+root);});
 const f=await seedArchivedOrigin(root,locale),file=path.join(root,'pty.json'),output=file+'.terminal';
 const database=path.join(f.home,'state/controller.sqlite'),steps=archivedOriginSteps(f,locale);
 const preloads=[...moduleGuard,'--import',fileURLToPath(new URL('./readiness-no-execution.mjs',import.meta.url))];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...preloads,entry,'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:root,
  env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  database,steps,output,columns:112,rows:32,expectedInputs:0,timeoutSeconds:9,gracefulShutdownSeconds:2}));
 const terminal=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:12000,maxBuffer:2**20})).stdout);
 assert.equal(terminal.exitCode,0);assert.equal(terminal.stages,steps.length);assert.equal(terminal.terminalRestored,true);
 assertArchivedOriginRestored(database,f);
 passed=true;
});
for(const locale of ['en','ko'])for(const failure of ['unreadable original','unavailable owner link','unavailable delegated roster'])test(
 'retained result registry keeps scope and focus with '+failure+' in '+locale,{timeout:18000},async t=>{
 const unavailableOwner=failure==='unavailable owner link',unavailableRoster=failure==='unavailable delegated roster';
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-result-unreadable-')));
 let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained unavailable-result terminal '+root);});
 const f=await seed(root,locale),c=await openController({installationHome:f.home});
 let healthy,originalData,before;
 try{
  const request='Healthy neighboring retained result 한국어';
  healthy=(await c.beginChange({projectId:'A',request})).workId;
  assert.equal(c.inspectChangeResult(healthy).request,request);
  assert.deepEqual(c.listChanges({projectId:'B'}).changes,[]);
  assert.ok(c.listChanges().changes.some(row=>row.workId===f.workId));
  if(unavailableOwner){
   const {inputId}=await c.queueConversationInput({conversationId:f.cid,expectedGeneration:c.inspectConversation(f.cid).generation,
    text:'Previously recorded owner request',mode:'idle'});
   c.store.run("UPDATE conversation_inputs SET state='CONSUMED',data='{' WHERE id=?",inputId);
   assert.deepEqual(c.inspectConversationInputs(f.cid),[]);
   assert.throws(()=>c.conversationChange(f.cid),/malformed JSON/);
   assert.deepEqual(c.inspectRecordedDelegatedResults(f.cid).entries,[]);
  }
  assert.equal(c.listChanges().changes[0].workId,healthy);
  originalData=c.store.one('SELECT data FROM change_state WHERE work=?',f.workId).data;
  before=ledger(c.store);
 }finally{await c.close();}
 const tText=(key,values)=>uiText(locale,key,values),title=tText('result.title');
 const scope=title+' · '+tText('change.registry.allScope');
 const unavailable=(locale==='ko'?'작업 결과를 읽을 수 없습니다':'Work result unavailable')+' · '+f.workId;
 const changed='!'+originalData;
 const frozen=['works','runs','budgets','effect_targets','effect_delegations','effect_operations','conversation_inputs'].map(table=>({sql:'SELECT * FROM '+table+' ORDER BY rowid',rows:before[table].map(Object.values)}));
 const replace=data=>[{sql:'UPDATE change_state SET data=? WHERE work=?',params:[data,f.workId]}];
 const step=(wait,send,data=originalData)=>({wait,send,assertDraft:f.draft,expectedSelected:f.cid,queries:[...frozen,
  {sql:'SELECT project FROM conversations WHERE id=?',params:[f.cid],rows:[['B']]},
  {sql:'SELECT data FROM change_state WHERE work=?',params:[f.workId],rows:[[data]]},
 ]});
 const selected={...step(scope,f.workId+'\r'),mutations:replace(changed)};
 const steps=[
  ...(unavailableRoster?[
   step(locale==='ko'?'위임 결과 목록을 읽을 수 없습니다':'Delegated result list unavailable','\x07r'),
   step(tText('delegated.resultsTitle'),'\r'),
   step(f.draft,'\x07r'),
   step(tText('delegated.resultsTitle'),tText('delegated.browseChanges')+'\r'),
  ]:[step(f.draft,'\x07r')]),
  step(title+' · B',tText('change.registry.all')+'\r'),
  selected,
  step(unavailable,'\x1b',changed),
  step(scope,'\r',changed),
  step(unavailable,'\x1b',changed),
  step(scope,healthy+'\r',changed),
  step(tText('result.readOnly'),'\x1b[6~'.repeat(8),changed),
  step('Work: '+healthy,'\x1b',changed),
  {...step(scope,tText('change.registry.close')+'\r',changed),mutations:replace(originalData)},
  step(f.draft,'\x07q'),
 ];
 const file=path.join(root,'terminal.json'),output=file+'.terminal',database=path.join(f.home,'state/controller.sqlite');
 const preloads=[...moduleGuard,'--import',fileURLToPath(new URL('./readiness-no-execution.mjs',import.meta.url))];
 if(unavailableRoster){
  const fault=path.join(root,'unavailable-roster.mjs');
  await fs.writeFile(fault,`
   import {Controller} from ${JSON.stringify(pathToFileURL(path.join(packageRoot,'dist/controller/controller.js')).href)};
   const read = Controller.prototype.inspectRecordedDelegatedResults;
   Controller.prototype.inspectRecordedDelegatedResults = function(id) {
      if (id === ${JSON.stringify(f.cid)}) throw Error('Controlled delegated-roster read failure');
      return read.call(this,id);
   };
  `);
  preloads.push('--import',fault);
 }
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...preloads,entry,'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:root,
  env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,output,database,columns:140,rows:36,expectedInputs:unavailableOwner?1:0,timeoutSeconds:8,noForceKill:true,gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:12000,maxBuffer:2**20})).stdout);
  assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
  if(unavailableOwner)assert.ok((await fs.readFile(output,'utf8')).includes(tText('result.originalLinkUnavailable')));
  const db=new DatabaseSync(database,{readOnly:true});
  try{assert.deepEqual(ledger({all:sql=>db.prepare(sql).all()}),before);}
  finally{db.close();}
  passed=true;
 }catch(error){
  const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8').catch(()=> '{}'));
  t.diagnostic('Result journey completed '+(progress.stage??0)+' actions; next expected display: '+steps[progress.stage]?.wait);
  t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-7000));
  throw error;
 }
});

for(const locale of ['en','ko'])test('original '+locale+' terminal offers separate save and delivery routes for a foreign-project result',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-result-delivery-pty-')));let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original result terminal '+root);});
 const f=await seed(root,locale),file=path.join(root,'pty.json'),output=file+'.terminal',title=uiText(locale,'result.title'),next=uiText(locale,'result.nextTitle');
 const nextReady=locale==='en'?'Open result actions to review a branch save in the result project or delivery to a registered receiver.':'결과 동작을 열어 결과 프로젝트에 브랜치를 저장하거나 등록된 수신처로 전달하는 방법을 검토하세요.';
 const catalogueTitle=title+' · '+uiText(locale,'change.registry.allScope');
 const pick=[{wait:catalogueTitle,send:'SYNTHETIC_RECORDED_RESULT\r'},{wait:nextReady,send:'\x1b[6~'.repeat(8)}];
 const unchanged=[{sql:'SELECT COUNT(*) FROM effect_delegations',rows:[[2]]},{sql:'SELECT COUNT(*) FROM effect_operations',rows:[[2]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]},{sql:'SELECT project FROM conversations WHERE id=?',params:[f.cid],rows:[['B']]}];
 const workTitle=uiText(locale,'workRecovery.title',{id:f.workId,state:'DELIVERED'});
 const backFromResult={wait:uiText(locale,'result.reviews'),assertDraft:f.draft,queries:unchanged,send:'\x1b'};
 const receiverList=uiText(locale,'integration.receiverList',{project:'"A"',work:f.workId}).split('\n')[0];
 const delivery=receiver=>[
  {wait:next,assertDraft:f.draft,send:uiText(locale,'result.reviewDelivery')+'\r'},
  {wait:uiText(locale,'result.receiverTitle'),assertDraft:f.draft,queries:unchanged,send:uiText(locale,'result.receiverOpen')+'\r'},
  {wait:receiverList,assertDraft:f.draft,expectedSelected:f.cid,queries:unchanged,send:receiver.id+'\r'},
  {wait:uiText(locale,'integration.receiverActions',{receiver:JSON.stringify(receiver.name),ref:'"refs/heads/main"',id:receiver.id}).split('\n')[1],
   assertDraft:f.draft,queries:unchanged,send:uiText(locale,receiver===unavailableReceiver?'integration.receiverOpen':'integration.receiverPrepare')+'\r'},
  ...(receiver===unavailableReceiver?[
   {wait:uiText(locale,'integration.unavailableTitle'),assertDraft:f.draft,expectedSelected:f.cid,queries:unchanged,send:'\x1b'},
  ]:[...receiver===localReceiver?[
   {wait:uiText(locale,'integration.reviewRecovery'),assertDraft:f.draft,queries:unchanged,send:'\r'},
   {wait:uiText(locale,'integration.firstRecoveryTitle'),assertDraft:f.draft,queries:unchanged,send:blockingOperation+'\r'},
   {wait:uiText(locale,'integration.pinnedMenu',{id:blockingOperation}).split('\n')[0],assertDraft:f.draft,queries:unchanged,send:'\x1b'},
  ]:[{wait:uiText(locale,'integration.reviewRecovery'),assertDraft:f.draft,queries:unchanged,send:'\x1b'}],
  {wait:receiverList,assertDraft:f.draft,queries:unchanged,send:uiText(locale,'integration.choice.listBack')+'\r'},
  ]),
 ];
 const steps=[{wait:f.draft,send:'\x07r'},{wait:title+' · B',send:uiText(locale,'change.registry.all')+'\r'},
  ...pick,{wait:'Work: '+f.workId,assertDraft:f.draft,queries:unchanged,send:'\x1b'},
  ...pick,{wait:'Work: '+f.workId,assertDraft:f.draft,queries:unchanged,send:'\r'},
  {wait:next,assertDraft:f.draft,send:uiText(locale,'result.saveBranch')+'\r'},
  {wait:uiText(locale,'save.foreignScope'),assertDraft:f.draft,queries:unchanged,send:'\x1b'},
  {wait:uiText(locale,'result.openActions'),assertDraft:f.draft,queries:unchanged,send:'\r'},
  {wait:next,assertDraft:f.draft,queries:unchanged,send:uiText(locale,'result.saveBranch')+'\r'},
  {wait:uiText(locale,'save.foreignOpen'),assertDraft:f.draft,queries:unchanged,send:'\r'},
  {wait:uiText(locale,'save.workMenu',{work:f.workId,project:'A',conversationProject:'B'}).split('\n')[0],assertDraft:f.draft,queries:unchanged,send:'\x1b'},
  backFromResult,
  ...pick,{wait:'Work: '+f.workId,assertDraft:f.draft,queries:unchanged,send:'\r'},...delivery(localReceiver),backFromResult,
  ...pick,{wait:'Work: '+f.workId,assertDraft:f.draft,queries:unchanged,send:'\r'},...delivery(unavailableReceiver),
  {...backFromResult,wait:'Work: '+f.workId,expectedSelected:f.cid},
  ...pick,{wait:'Work: '+f.workId,assertDraft:f.draft,queries:unchanged,send:'\r'},
  {wait:next,assertDraft:f.draft,send:uiText(locale,'result.recovery')+'\r'},
  {wait:workTitle,assertDraft:f.draft,send:uiText(locale,'result.view')+'\r'},
  {wait:nextReady,assertDraft:f.draft,send:'\r'},
  {wait:next,assertDraft:f.draft,send:'\r'},
  backFromResult,
  {wait:workTitle,assertDraft:f.draft,send:uiText(locale,'result.view')+'\r'},
  {wait:uiText(locale,'result.openActions'),assertDraft:f.draft,send:'\r'},
  ...delivery(hostedReceiver),backFromResult,
  {wait:workTitle,assertDraft:f.draft,queries:unchanged,send:'\x1b'},
  backFromResult,
  {wait:catalogueTitle,assertDraft:f.draft,queries:unchanged,send:'\x1b'},
  {wait:f.draft,assertDraft:f.draft,queries:unchanged,send:'\x07q'}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import',fileURLToPath(new URL('./readiness-no-execution.mjs',import.meta.url)),entry,'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:root,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,gracefulShutdownSeconds:3,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:16000,maxBuffer:2**20})).stdout);
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  const terminal=await fs.readFile(output,'utf8');
  assert.ok(terminal.includes(uiText(locale,'integration.firstReviewHeld')));
  assert.ok(terminal.includes(uiText(locale,'integration.firstBlocker',{id:JSON.stringify(blockingOperation)})));
  assert.ok(terminal.includes(uiText(locale,'integration.unavailable',{id:unavailableOperation})));
  assert.ok(terminal.includes('Explicit current owner integration grant required'));
  assert.ok(!terminal.includes(uiText(locale,'integration.firstConfirmTitle')));
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{
   for(const [table,rows]of Object.entries(f.before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows,table+' must remain unchanged');
   assert.equal(db.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(f.cid).draft,f.draft);
  }finally{db.close();}passed=true;
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-6500));throw error;}
});

for(const locale of ['en','ko'])test('original '+locale+' terminal explains empty scoped receivers and opens registration explicitly',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-empty-receiver-pty-')));let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained empty receiver terminal '+root);});
 const f=await seed(root,locale,false,true),file=path.join(root,'pty.json'),output=file+'.terminal',title=uiText(locale,'result.title');
 const empty=uiText(locale,'integration.receiverListEmpty').split('\n')[0];
 const form=uiText(locale,'integration.localFixed',{project:'A'});
 const steps=[{wait:f.draft,send:'\x07r'},{wait:title+' · B',send:uiText(locale,'change.registry.all')+'\r'},
  {wait:title+' · '+uiText(locale,'change.registry.allScope'),send:'SYNTHETIC_RECORDED_RESULT\r'},
  {wait:'added.txt',send:'\x1b[6~'.repeat(8)},{wait:'Work: '+f.workId,send:'\r'},
  {wait:uiText(locale,'result.nextTitle'),send:uiText(locale,'result.reviewDelivery')+'\r'},
  {wait:uiText(locale,'result.receiverTitle'),send:uiText(locale,'result.receiverOpen')+'\r'},
  {wait:empty,assertDraft:f.draft,send:uiText(locale,'integration.receiverRegisterLocal')+'\r'},
  {wait:form,assertDraft:f.draft,send:uiText(locale,'integration.localReview')+'\r'},
  {wait:uiText(locale,'integration.registrationFields'),assertDraft:f.draft,send:'\x1b'},
  {wait:form,assertDraft:f.draft,send:uiText(locale,'integration.localPath',{value:''}).trim()+'\r'},
  {wait:uiText(locale,'integration.localPathInput'),send:'/retained/intended-receiver.git\r'},
  {wait:form,assertDraft:f.draft,send:uiText(locale,'integration.localReview')+'\r'},
  {wait:uiText(locale,'integration.registrationFields'),assertDraft:f.draft,send:'\x1b'},
  {wait:form,assertDraft:f.draft,send:'\x1b'},
  {wait:empty,assertDraft:f.draft,send:'\r'},
  {wait:'Work: '+f.workId,assertDraft:f.draft,send:'\x1b'},
  {wait:title+' · '+uiText(locale,'change.registry.allScope'),assertDraft:f.draft,send:'\x1b'},
  {wait:f.draft,assertDraft:f.draft,send:'\x07q'}];
 const database=path.join(f.home,'state/controller.sqlite');
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...moduleGuard,'--import',fileURLToPath(new URL('./readiness-no-execution.mjs',import.meta.url)),entry,'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:root,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:9,expectedInputs:0,database,output}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:12000,maxBuffer:2**20})).stdout);
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  const terminal=await fs.readFile(output,'utf8');
  assert.ok(terminal.includes(uiText(locale,'integration.receiverListEmpty').split('\n')[1]));
  assert.ok(terminal.includes(uiText(locale,'integration.localInput.receiverPath')));
  assert.ok(terminal.includes(uiText(locale,'integration.localInput.basis')));
  assert.ok(!terminal.includes('foreign-0'));
  const db=new DatabaseSync(database,{readOnly:true});try{for(const [table,rows]of Object.entries(f.before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows,table);}finally{db.close();}
  passed=true;
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-6500));throw error;}
});

for(const locale of ['en','ko'])for(const earlier of [false,true])
test('original '+locale+' terminal compares '+(earlier?'earlier':'selected')+' case values and returns to the same result',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-case-values-pty-')));
 let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original result terminal '+root);});
 const f=await seed(root,locale,false,true,earlier?'earlier':true),file=path.join(root,'pty.json'),output=file+'.terminal';
 const title=uiText(locale,'result.title'),action=uiText(locale,'result.check.caseValuesAction');
 const comparisonRoute=uiText(locale,'result.openActions')+' → '+action;
 const expected='Expected observation',observed='Actual recorded observation',observation=path.join(root,'frame.json');
 const comparisonFrame=earlier?[expected,observed,uiText(locale,'result.retainedChecks')]:[expected,observed];
 const pick={wait:title+' · '+uiText(locale,'change.registry.allScope'),send:'SYNTHETIC_RECORDED_RESULT\r'};
 const keep={assertDraft:f.draft,expectedSelected:f.cid};
 const replan=uiText(locale,'change.checkReplanAction');
 const workTitle=uiText(locale,'workRecovery.title',{id:f.workId,state:'ACTIVE'});
 const openResultActions={wait:uiText(locale,'result.openActions'),...keep,send:'\r'};
 const reviewCorrection=[
  {wait:uiText(locale,'change.replanReviewRuntimeSetup'),...keep,send:'\x1b[6~'},
  {wait:'synthetic-failed-check',...keep,send:'\r'},
  {wait:uiText(locale,'change.runtimeRequired'),...keep,send:uiText(locale,'requestSetup.openRuntime')+'\r'},
  {wait:uiText(locale,'runtime.title'),...keep,send:'\x1b'},
 ];
 const storedCheck=f.before.check_runs.find(row=>row.id==='synthetic-failed-check');
 const reviseCheck=sql=>({sql,params:[storedCheck.id]});
 const steps=[{wait:f.draft,send:'\x07r'},{wait:title+' · '+f.resultProject,send:uiText(locale,'change.registry.all')+'\r'},pick,
  {wait:uiText(locale,'result.openActions'),...keep,frame:{contains:[comparisonRoute],selected:f.cid,draft:f.draft},send:'\r'},
  {wait:uiText(locale,'result.nextTitle'),...keep,send:action+'\r'},
  {wait:observed,...keep,frame:{contains:comparisonFrame,selected:f.cid,draft:f.draft},send:'\x1b'},
  ...(earlier?[
   openResultActions,
   {wait:uiText(locale,'result.nextTitle'),...keep,send:replan+'\r'},
   ...reviewCorrection,
   openResultActions,
   {wait:uiText(locale,'result.nextTitle'),...keep,send:uiText(locale,'result.recovery')+'\r'},
   {wait:workTitle,...keep,frame:{contains:[replan],selected:f.cid,draft:f.draft},send:replan+'\r'},
   ...reviewCorrection,
   {wait:workTitle,...keep,frame:{contains:[replan],selected:f.cid,draft:f.draft},send:replan+'\r',
    mutations:[reviseCheck("UPDATE check_runs SET data=json_set(data,'$.actual.stdout','{}') WHERE id=?")]},
   {wait:uiText(locale,'workRecovery.workChanged'),...keep,send:'\x1b',
    mutations:[{sql:'UPDATE check_runs SET data=? WHERE id=?',params:[storedCheck.data,storedCheck.id]}]},
  ]:[]),
  {wait:uiText(locale,'result.openActions'),...keep,send:'\x1b'},
  {wait:title+' · '+uiText(locale,'change.registry.allScope'),...keep,send:'\x1b'},
  {wait:f.draft,...keep,send:'\x07q'}];
 const database=path.join(f.home,'state/controller.sqlite');
 const preloads=[...moduleGuard,...['./readiness-no-execution.mjs','./inspection-pty-observer.mjs'].flatMap(module=>['--import',fileURLToPath(new URL(module,import.meta.url))])];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...preloads,entry,'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:root,
  env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},
  steps,timeoutSeconds:9,gracefulShutdownSeconds:2,expectedInputs:0,database,columns:100,rows:24,observation,output}));
 const actual=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:12000,maxBuffer:2**20})).stdout);
 assert.equal(actual.exitCode,0);assert.equal(actual.stages,steps.length);assert.equal(actual.terminalRestored,true);
 const terminal=await fs.readFile(output,'utf8');
 assert.ok(terminal.indexOf(observed)>terminal.indexOf(action));
 if(earlier){
  assert.ok(terminal.includes(uiText(locale,'result.retainedChecks')));
  assert.ok(terminal.includes(replan));
  assert.ok(terminal.includes(uiText(locale,'change.replanReviewRuntimeSetup')));
  assert.ok(!terminal.includes(uiText(locale,'change.scopeReplanAccept')));
 }
 const db=new DatabaseSync(database,{readOnly:true});try{for(const [table,rows]of Object.entries(f.before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows,table);}finally{db.close();}
 passed=true;
});

for(const locale of ['en','ko'])for(const workState of ['UNKNOWN','QUARANTINED'])test('original '+locale+' terminal shows recorded cleanup recovery for '+workState+' results',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-result-recovery-pty-')));let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original result terminal '+root);});
 const f=await seed(root,locale,workState),file=path.join(root,'pty.json'),output=file+'.terminal',title=uiText(locale,'result.title');
 const observation=path.join(root,'frame.json'),action='Inspect original execution ownership and cleanup';
 const blocker='Original execution cleanup is unconfirmed',recorded=uiText(locale,'result.recordedNextAction',{action});
 const owner=uiText(locale,'result.direction.owner',{revision:1}),agent=uiText(locale,'result.direction.agent',{revision:2});
 const steps=[{wait:f.draft,send:'\x07r'},{wait:title+' · B',send:uiText(locale,'change.registry.all')+'\r'},
  {wait:title+' · '+uiText(locale,'change.registry.allScope'),send:'SYNTHETIC_RECORDED_RESULT\r'},
  {wait:action,frame:{contains:[uiText(locale,'result.recovery'),blocker,recorded,'Retained supporting blocker 0'],selected:f.cid,draft:f.draft},send:'\r',assertDraft:f.draft,expectedSelected:f.cid},
  {wait:uiText(locale,'workRecovery.settlementUnconfirmed'),assertDraft:f.draft,send:'\x1b'},
  {wait:action,assertDraft:f.draft,send:'\x1b[6~'.repeat(4)},
  {wait:agent,frame:{contains:[owner,agent],selected:f.cid,draft:f.draft},send:'\x1b',assertDraft:f.draft,expectedSelected:f.cid},
  {wait:title+' · '+uiText(locale,'change.registry.allScope'),assertDraft:f.draft,send:'\x1b'},
  {wait:f.draft,assertDraft:f.draft,send:'\x07q'}];
 const database=path.join(f.home,'state/controller.sqlite');
 const preloads=[...moduleGuard,...['./readiness-no-execution.mjs','./inspection-pty-observer.mjs'].flatMap(module=>['--import',fileURLToPath(new URL(module,import.meta.url))])];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...preloads,entry,'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:root,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation},steps,timeoutSeconds:9,gracefulShutdownSeconds:2,expectedInputs:2,database,columns:100,rows:24,observation,output}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:12000,maxBuffer:2**20})).stdout);
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  const frame=JSON.parse(await fs.readFile(output+'.frame-3.json','utf8')).frame.join('\n');
  assert.ok(frame.indexOf(blocker)<frame.indexOf(recorded)&&frame.indexOf(recorded)<frame.indexOf('Retained supporting blocker 0'),frame);
  const db=new DatabaseSync(database,{readOnly:true});try{for(const [table,rows]of Object.entries(f.before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows,table);}finally{db.close();}
  passed=true;
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-6500));throw error;}
});
