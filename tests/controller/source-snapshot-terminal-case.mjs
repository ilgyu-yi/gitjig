import {observeOriginalSender} from './source-save-terminal-observer.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);

export async function qualifySourceSaveTerminal({c,options,root,workId,git,setup,source,head,index,sourceBytes,status,locale,kind='healthy',proxy}) {
 const cid=c.createConversation({projectId:'P'}).conversationId,draft='KEEP 원래 초안 '+locale;
 if(locale==='ko'){const view=c.inspectConversation(cid),language=c.getConversationLanguage(cid);c.setConversationLanguage({conversationId:cid,expectedGeneration:view.generation,expectedRevision:language.revision,replyLanguage:'ko'});}
 c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 const initialInputs=c.store.all('SELECT * FROM conversation_inputs ORDER BY rowid'),priorWork=c.store.one('SELECT * FROM works WHERE id=?',workId),evidence=await c.changeCore.currentEvidence(workId),home=options.installationHome,operator=options.sourceGitRoute.environment.home;
 await c.close();
 const t=(id,values)=>uiText(locale,id,...values?[values]:[]),file=path.join(root,'source-save-terminal.json'),output=file+'.terminal',trace=path.join(root,'source-save-native-trace.jsonl'),branch='terminal-'+locale,ready=path.join(root,'sender-observed-ready');
 const cancelPreparation=kind==='healthy'&&locale==='ko';
 const cancelReview=kind==='healthy'&&locale==='en';
 const observeReview={opening:t('save.opening').split(' · ')[0],eligibility:t('save.reviewing')};
 const gitContext=t('save.preparedGit',{path:JSON.stringify(options.effectsProfile.gitBinary)});
 const beforePreparation=[
  {sql:'SELECT COUNT(*) FROM source_branch_previews WHERE work=?',params:[workId],rows:[[0]]},
  {sql:'SELECT COUNT(*) FROM effect_operations WHERE work=?',params:[workId],rows:[[0]]},
  {sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[workId],rows:[[8,0]]},
 ];
 const proposalBranch='refs/heads/'+branch, quotedProposalBranch=JSON.stringify(proposalBranch);
 const occupied=[
    {sql:"SELECT state,terminal_source IS NOT NULL FROM source_branch_previews WHERE work=?",params:[workId],rows:[['SETTLED',1]]},
    {sql:"SELECT COUNT(*) FROM change_versions WHERE work=? AND kind='source-snapshot-proposal'",params:[workId],rows:[[0]]},
    ...beforePreparation.slice(1),
 ];
 const beforeSave=[
  {sql:"SELECT json_extract(data,'$.destinationRef') FROM change_versions WHERE work=? AND kind='source-snapshot-proposal'",params:[workId],rows:[[proposalBranch]]},
  {sql:'SELECT COUNT(*) FROM effect_operations WHERE work=?',params:[workId],rows:[[0]]},
  {sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[workId],rows:[[8,0]]},
 ];
 const proposalRow=t('save.proposalRow',{id:'',branch:quotedProposalBranch}).split(quotedProposalBranch)[0]+quotedProposalBranch;
 const reopenPreview={wait:proposalRow,assertDraft:draft,queries:beforeSave,send:proposalBranch+'\r'};
 const steps=[
  {wait:draft,send:'\x07r'},
  {wait:t('result.title')+' · P',send:'Consumer exports3\r'},
  {wait:t('result.openActions'),send:'\r'},
  {wait:t('result.nextTitle'),send:t('result.saveBranch')+'\r'},
  ...kind==='healthy'?[
   {wait:t('save.new'),assertDraft:draft,queries:[
    {sql:"SELECT COUNT(*) FROM change_versions WHERE work=? AND kind='source-snapshot-proposal'",params:[workId],rows:[[0]]},
    {sql:'SELECT COUNT(*) FROM effect_operations WHERE work=?',params:[workId],rows:[[0]]},
   ],send:'\r'},
   {wait:t('result.openActions'),assertDraft:draft,send:'\r'},
   {wait:t('result.nextTitle'),send:t('result.saveBranch')+'\r'},
  ]:[],
  {wait:t('save.new'),send:t('save.new')+'\r'},
  {wait:t('save.branch'),send:'bad branch\r'},
  {wait:t('save.branchInvalid').split('. ')[0],send:cancelReview
   ? '\x1b[200~\u2028extra\x1b[201~\r' : '\x15'+(kind==='healthy'?'temporary-destination':branch)+'\r'},
  ...cancelReview?[
   {wait:t('save.fieldSingleLine'),assertDraft:draft,queries:beforePreparation,send:'\x15temporary-destination\r'},
   {wait:gitContext,queries:beforePreparation,send:t('save.editGit')+'\r'},
   {wait:t('save.git'),send:'\x1b[200~\u0085extra\x1b[201~\r'},
   {wait:t('save.fieldSingleLine'),assertDraft:draft,queries:beforePreparation,send:'\x15git\r'},
   {wait:t('save.gitInvalid'),send:'\x15'+options.effectsProfile.gitBinary+'\r'},
  ]:[],
  ...kind==='healthy'?[
   {wait:gitContext,assertDraft:draft,queries:beforePreparation,send:t('save.editBranch')+'\r'},
   {wait:t('save.branch'),send:'\x1b'},
   {wait:gitContext,assertDraft:draft,queries:beforePreparation,send:t('save.editBranch')+'\r'},
   {wait:t('save.branch'),send:'\x15main\r'},
  ]:[],
  {wait:t('save.prepareScope'),send:t('save.prepare')+'\r'},
  ...kind==='healthy'?[
   {wait:t('save.branchExists'),assertDraft:draft,queries:occupied,send:t('save.editBranch')+'\r'},
   {wait:t('save.branch'),send:'\x1b'},
   {wait:t('save.branchExists'),assertDraft:draft,queries:occupied,send:t('save.editBranch')+'\r'},
   {wait:t('save.branch'),send:'\x15'+branch+'\r'},
   {wait:t('save.prepareScope'),send:t('save.prepare')+'\r'},
  ]:[],
  ...cancelPreparation?[
   {wait:t('save.preparingSnapshot'),send:'\x1b'},
   {wait:t('save.prepareCancelled'),assertDraft:draft,queries:[
    {sql:"SELECT state,terminal_source IS NOT NULL FROM source_branch_previews WHERE work=?",params:[workId],rows:[['SETTLED',1],['SETTLED',1]]},
    {sql:"SELECT COUNT(*) FROM change_versions WHERE work=? AND kind='source-snapshot-proposal'",params:[workId],rows:[[0]]},
    {sql:'SELECT COUNT(*) FROM effect_operations WHERE work=?',params:[workId],rows:[[0]]},
   ],send:t('save.prepare')+'\r'},
   {wait:t('save.opening').split(' · ')[0],send:'\x1b'},
   reopenPreview,
  ]:[],
  ...cancelReview?[
   {wait:t('save.openOptions'),send:'\x1b',observe:observeReview},
   reopenPreview,
   {wait:t('save.openOptions'),send:'\x1b'},
   {...reopenPreview,send:'\r'},
  ]:[],
  {wait:t('save.openOptions'),send:'\r',...!cancelReview?{observe:observeReview}:{}},
  {wait:t('save.wholeFiles'),send:t('save.wholeFiles')+'\r'},
  ...cancelReview?[
   {wait:t('save.fileComplete'),send:'\x1b'},
   {wait:t('save.openOptions'),assertDraft:draft,queries:beforeSave,send:'\r'},
   {wait:t('save.wholeFiles'),send:t('save.wholeFiles')+'\r'},
  ]:[],
  {wait:t('save.fileComplete'),send:'\r'},
  {wait:t('save.openOptions'),send:'\r'},
  {wait:t('save.confirm'),send:t('save.confirm')+'\r'},
 ];
 const reviewGate=path.join(root,'read-review-wait');
 const beforeCheck=[
  {sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[workId],rows:[[9,0]]},
  {sql:"SELECT COUNT(*) FROM effect_receipts WHERE kind='source-native-read-admission'",rows:[[0]]},
 ];
 if(kind==='cancel')steps.push({wait:t('save.progressCancelHint'),waitFiles:[{path:ready,value:proxy.nonce}],queries:[{sql:"SELECT COUNT(*) FROM effect_operations WHERE work=? AND phase='INVOKING'",params:[workId],rows:[[1]]},{sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[workId],rows:[[8,1]]}],send:'\x1b'}, {wait:t('save.uncertain'),send:t('save.back')+'\r'});
 else if(kind==='lost')steps.push(
  {wait:t('save.uncertain'),send:t('save.check')+'\r'},
  {wait:t('save.progressCancelHint'),waitFiles:[{path:reviewGate,value:'waiting-for-escape'}],queries:beforeCheck,send:'\x1b'},
  {wait:t('save.uncertain'),assertDraft:draft,queries:beforeCheck,send:t('save.check')+'\r'},
  {wait:t('review.confirm'),send:'\x1b'},
  {wait:t('save.uncertain'),send:t('save.check')+'\r'}, {wait:t('review.confirm'),send:'\r'}, {wait:t('save.checkScope'),send:t('save.checkConfirm')+'\r'}, {wait:t('save.confirmed'),send:t('save.back')+'\r'});
 else steps.push({wait:t('save.confirmed'),send:t('save.back')+'\r'});
 const settledNotice=(locale==='ko'?'로컬 저장 · ':'Local save · ')+t(kind==='cancel'?'save.uncertain':'save.confirmed');
 const spent=kind==='lost'?10:9,recorded=kind==='cancel'?'UNKNOWN':'CONFIRMED';
 const savedLedger=[
  {sql:'SELECT phase FROM effect_operations WHERE work=?',params:[workId],rows:[[recorded]]},
  {sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[workId],rows:[[spent,0]]},
 ];
 const retainedStep=(wait,send)=>({wait,send,assertDraft:draft,expectedInputs:initialInputs.length,queries:savedLedger});
 steps.push(
  retainedStep(kind==='healthy'?settledNotice:'/save operation ','\x07r'),
  retainedStep(t('result.title')+' · P','Consumer exports3\r'),
  retainedStep(t('result.openActions'),'\r'),
  retainedStep(t('result.nextTitle'),t('save.workHistory')+'\r'),
  retainedStep(t(kind==='cancel'?'save.history.uncertain':'save.history.confirmed')+' · '+JSON.stringify('refs/heads/'+branch),branch+'\r'),
  retainedStep(t(kind==='cancel'?'save.uncertain':'save.confirmed'),'\x1b'),
  retainedStep(t('save.workHistoryTitle',{work:workId,project:'P'}).split(' · ')[0],'\r'),
  retainedStep(t(kind==='cancel'?'save.uncertain':'save.confirmed'),'\x1b'),
  retainedStep(t('save.workHistoryTitle',{work:workId,project:'P'}).split(' · ')[0],'\x1b'),
  retainedStep(t('result.openActions'),'\x1b'),
  retainedStep(t('result.title')+' · P','\x1b'),
  retainedStep(draft,'\x07q'),
 );
 const checkout=await fs.realpath(process.env.GITJIG_SAVE_FIXTURE_CONTROL_ROOT??'.'),packageRoot=await fs.realpath(process.env.GITJIG_SAVE_FIXTURE_PACKAGE_ROOT??'.'),installedCommand=process.env.GITJIG_SAVE_FIXTURE_INSTALLED_COMMAND;
 if(installedCommand){assert.ok(path.isAbsolute(installedCommand));assert.equal(await fs.realpath(installedCommand),path.join(packageRoot,'dist/cli/entry.js'));assert.ok(process.env.GITJIG_SAVE_FIXTURE_UI_NODE_OPTIONS);}
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:operator,GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_SAVE_FIXTURE_PACKAGE_ROOT:packageRoot,GITJIG_SAVE_FIXTURE_TRACE:trace,GITJIG_SAVE_FIXTURE_WORK_ID:workId,...installedCommand?{NODE_OPTIONS:process.env.GITJIG_SAVE_FIXTURE_UI_NODE_OPTIONS,GITJIG_INSTALLED_SOURCE_PAYLOAD:packageRoot,GITJIG_INSTALLED_SOURCE_MANIFEST:process.env.GITJIG_INSTALLED_SOURCE_MANIFEST,GITJIG_INSTALLED_SOURCE_TRACE:process.env.GITJIG_INSTALLED_SOURCE_TRACE,GITJIG_INSTALLED_SOURCE_MODE:'ui'}:{}};
 if(kind==='lost')env.GITJIG_SAVE_FIXTURE_READ_REVIEW_WAIT=reviewGate;
 const timeoutSeconds=kind==='healthy'?55:35;
 const moduleGuard=process.env.GITJIG_UI_MODULE_GUARD;
 const entry=installedCommand?[installedCommand]:[
  process.execPath,...moduleGuard?['--import',moduleGuard]:[],'--import',path.join(checkout,'tests/ui/source-save-no-provider.mjs'),
  ...kind==='lost'?['--import',path.join(checkout,'tests/ui/source-save-drop-reply.mjs')]:[],path.join(packageRoot,'dist/cli/entry.js'),
 ];
 await fs.writeFile(file,JSON.stringify({command:[...entry,'conversation','ui','--conversation',cid,'--git-binary',options.effectsProfile.gitBinary],cwd:checkout,env,steps,columns:kind==='healthy'?80:140,timeoutSeconds,noForceKill:true,gracefulShutdownSeconds:5,expectedInputs:initialInputs.length,database:path.join(home,'state/controller.sqlite'),output}));
 let result,held;
 const running=execute('/usr/bin/python3',[path.join(checkout,'tests/cli/fork-ui-pty.py'),file],{cwd:checkout,timeout:(timeoutSeconds+10)*1000,killSignal:'SIGINT',maxBuffer:2**20});void running.catch(()=>{});
 const observing=kind==='cancel'?observeOriginalSender({home,root,workId,branch,git,proxy,ready}):Promise.resolve(null);void observing.catch(()=>{});
 try{const [pty,observed]=await Promise.all([running,observing]);result=JSON.parse(pty.stdout);held=observed;}
 catch(error){await Promise.allSettled([running,observing]);throw Error('Original source terminal retained at '+file+'; '+String(error.stdout??'')+' '+String(error.stderr??''),{cause:error});}
 assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(result.alternateEntered,true);assert.equal(result.alternateExited,true);const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));assert.equal(progress.forceKilled,false);assert.equal(progress.outputTruncated,false);assert.equal(progress.exitCode,0);assert.equal(progress.stage,steps.length);assert.ok(Number.isSafeInteger(progress.childPid)&&progress.childPid>0);assert.equal(progress.actionElapsedSeconds.length,steps.length);assert.ok(progress.actionElapsedSeconds.every((value,i)=>Number.isFinite(value)&&value>=0&&(!i||value>=progress.actionElapsedSeconds[i-1])));
 const terminal=await fs.readFile(output,'utf8');assert.ok(terminal.includes(t('save.preparing')));assert.ok(terminal.includes(t('save.saving')));assert.ok(terminal.includes(t('save.progressCancelHint')));assert.ok(terminal.includes('0s')||terminal.includes('1s'));
 assert.ok(terminal.includes(kind==='healthy'?gitContext:t('save.preparedGit',{path:''}).trim()));
 assert.equal(terminal.includes(t('save.gitInvalid')),cancelReview);
 const preparationStages=['save.preparingBasis','save.preparingSnapshot','save.preparingPreview'];
 let marker=-1;
 for(const stage of preparationStages){const next=terminal.indexOf(t(stage),marker+1);assert.ok(next>marker,'Missing ordered preparation progress '+stage);marker=next;}
 const events=(await fs.readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.ok(events.some(e=>e.kind==='native'));assert.ok(events.some(e=>e.kind==='exit'&&e.denied===0));assert.ok(!events.some(e=>e.kind==='denied'));
 const prepareStep=steps.findLastIndex(step=>step.wait===t('save.prepareScope'));
 const discloseStep=steps.findIndex(step=>step.wait===t('save.fileComplete')&&step.send==='\r');
 const saveStep=steps.findIndex(step=>step.wait===t('save.confirm'));
 const firstReview=steps.findIndex(step=>step.wait===t('save.openOptions'));
 const elapsed=progress.actionElapsedSeconds;
 const {opening,eligibility}=progress.observedOutputSeconds;
 for(const point of [opening,eligibility])if(point!==undefined)assert.ok(point>=elapsed[prepareStep]&&point<=elapsed[firstReview]);
 if(opening!==undefined&&eligibility!==undefined)assert.ok(eligibility>=opening);
 const firstReviewStages={prepareThroughOpeningSeconds:cancelPreparation||opening===undefined?null:opening-elapsed[prepareStep],
  openingThroughEligibilitySeconds:opening===undefined||eligibility===undefined?null:eligibility-opening,
  eligibilityThroughReviewSeconds:eligibility===undefined?null:elapsed[firstReview]-eligibility};
 const timings={prepareThroughFirstReviewSeconds:elapsed[firstReview]-elapsed[prepareStep],firstReviewStages,disclosureThroughReviewSeconds:elapsed[discloseStep+1]-elapsed[discloseStep],saveThroughOutcomeSeconds:elapsed[saveStep+(kind==='cancel'?2:1)]-elapsed[saveStep],nativeHelperCalls:events.filter(e=>e.kind==='native').length,scope:'Observed terminal transitions from preparation, completed disclosure and save'+(cancelPreparation?', including cancellation and reopen before first review':'')+'; not isolated backend timings'};
 const createEvent=events.find(e=>e.kind==='fixture-create');if(kind==='lost'){assert.equal(events.filter(e=>e.kind==='fixture-create').length,1);assert.equal(events.filter(e=>e.kind==='fixture-lost-return').length,1);assert.equal(events.find(e=>e.kind==='fixture-lost-return').receipt.handoff,'started');assert.ok(terminal.includes(t('save.checking')));}
 const clientRoot=held?.original.nativeAttempt.intent.prepared.clientRoot??createEvent?.clientRoot;
 const beforeReopen=clientRoot?(await fs.readdir(path.join(clientRoot,'runs'))).sort():null;
 const reopened=await openController(options);
 try{
  const page=reopened.listSourceSnapshotOperations({limit:25});assert.equal(page.operations.length,1);const original=page.operations[0];assert.equal(original.state,'RETAINED');assert.equal(original.recordedPhase,kind==='cancel'?'UNKNOWN':'CONFIRMED');assert.equal(original.workId,workId);assert.equal(original.nativeReads.length,kind==='lost'?1:0);
  assert.deepEqual(reopened.store.one('SELECT * FROM works WHERE id=?',workId),priorWork);assert.deepEqual(await reopened.changeCore.currentEvidence(workId),evidence);assert.deepEqual({...reopened.store.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",workId)},{lim:kind==='lost'?10:9,consumed:kind==='lost'?10:9,reserved:0});assert.equal(reopened.inspectConversation(cid).draft.text,draft);assert.deepEqual(reopened.store.all('SELECT * FROM conversation_inputs ORDER BY rowid'),initialInputs);assert.equal(reopened.store.one('SELECT count(*) n FROM conversation_inputs WHERE conversation=?',cid).n,0);
  if(kind==='cancel'){assert.equal(original.nativeAttempt.settlement.classification,'unknown');assert.ok(original.nativeAttempt.intent);assert.notEqual(original.nativeAttempt.settlement.send?.handoff,'not-started');for(const pid of [held.start.pid,held.start.gitPid,-held.start.gitPid,held.marker.pid])assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');await assert.rejects(setup(['show-ref','--verify','refs/heads/'+branch]));}else assert.equal((await setup(['rev-parse','refs/heads/'+branch])).stdout.trim(),original.binding.projectedCommit);
  if(kind==='lost'){assert.equal(original.nativeAttempt.settlement.classification,'unknown');assert.match(original.nativeAttempt.settlement.reason,/CONTROLLED_TERMINAL_SAVE_LOST_REPLY/);assert.equal(original.nativeReads[0].settlement.classification,'confirmed');}
  const receipt=terminal.slice(0,terminal.indexOf(settledNotice));
  const destination={branch:JSON.stringify(original.binding.destinationRef),commit:original.binding.projectedCommit};
  const target=t(kind==='cancel'?'save.intendedTarget':'save.confirmedTarget',destination);
  const scope=t('save.originalScope',{work:workId,id:original.operationId});
  const heading=receipt.lastIndexOf(t(kind==='cancel'?'save.uncertain':'save.confirmed'));
  assert.ok(heading>=0);
  for(const line of (target+'\n'+scope).split('\n'))
   assert.ok(receipt.slice(heading).includes(line),'Original save receipt line hidden: '+line);
  if(kind==='lost'){
   const uncertain=receipt.lastIndexOf(t('save.uncertain'),heading);
   assert.ok(uncertain>=0&&uncertain<heading);
   for(const line of t('save.intendedTarget',destination).split('\n'))
    assert.ok(receipt.slice(uncertain,heading).includes(line),'Uncertain save omitted intended target: '+line);
  }
  if(kind!=='healthy'){
   assert.ok(terminal.includes(t('save.uncertainSendRecorded')));
   assert.ok(terminal.includes('/save operation '+original.operationId));
  }
  if(kind==='healthy'){
   const previews=reopened.store.all('SELECT id,state,terminal_source FROM source_branch_previews WHERE work=?',workId);
   assert.equal(previews.length,cancelPreparation?3:2);
   assert.ok(previews.every(preview=>preview.state==='SETTLED'&&preview.terminal_source));
   assert.equal(previews.filter(preview=>preview.id===original.binding.previewId).length,1);
  }
  assert.ok(terminal.slice(terminal.indexOf(settledNotice)).includes(original.operationId),'Work-scoped history must lead to the original save');
  if(clientRoot)assert.deepEqual((await fs.readdir(path.join(clientRoot,'runs'))).sort(),beforeReopen);assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),sourceBytes);assert.equal((await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout,status);
  await fs.writeFile(path.join(root,'source-save-terminal-result.json'),JSON.stringify({scope:'Actual registered result/command ENKO PTY, normal procedure and local Native; no installed claim; cancellation gate precedes receiver exec and dropped return is not crash coverage',kind,held,locale,workId,cid,draft,priorWork,initialInputs,original,result,progress,timings,events},null,2));
 }finally{await reopened.close();}
}
