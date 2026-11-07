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
 const steps=[
  {wait:draft,send:'\x07r'},
  {wait:t('result.title')+' · P',send:'Consumer exports3\r'},
  {wait:t('result.ready'),send:'\x1b'},
  {wait:t('result.nextTitle'),send:t('result.saveBranch')+'\r'},
  {wait:t('save.new'),send:t('save.new')+'\r'},
  {wait:t('save.branch'),send:branch+'\r'},
  {wait:t('save.git'),send:'\r'},
  {wait:t('save.prepareScope'),send:t('save.prepare')+'\r'},
  {wait:t('save.title'),send:'\x1b'},
  {wait:t('save.wholeFiles'),send:t('save.wholeFiles')+'\r'},
  {wait:'module.exports=3;',send:'\x1b'},
  {wait:t('save.fileComplete'),send:t('save.fileComplete')+'\r'},
  {wait:t('save.title'),send:'\x1b'},
  {wait:t('save.confirm'),send:t('save.confirm')+'\r'},
 ];
 if(kind==='cancel')steps.push({wait:t('save.progressCancelHint'),waitFiles:[{path:ready,value:proxy.nonce}],queries:[{sql:"SELECT COUNT(*) FROM effect_operations WHERE work=? AND phase='INVOKING'",params:[workId],rows:[[1]]},{sql:"SELECT consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",params:[workId],rows:[[8,1]]}],send:'\x1b'}, {wait:t('save.uncertain'),send:t('save.back')+'\r'});
 else if(kind==='lost')steps.push({wait:t('save.uncertain'),send:t('save.check')+'\r'}, {wait:t('save.readAllowance',{remaining:1}),send:'\x1b'}, {wait:t('save.checkScope'),send:t('save.checkConfirm')+'\r'}, {wait:t('save.confirmed'),send:t('save.back')+'\r'});
 else steps.push({wait:t('save.confirmed'),send:t('save.back')+'\r'});
 steps.push({wait:draft,assertDraft:draft,expectedInputs:initialInputs.length,send:'\x07q'});
 const checkout=await fs.realpath(process.env.GITJIG_SAVE_FIXTURE_CONTROL_ROOT??'.'),packageRoot=await fs.realpath(process.env.GITJIG_SAVE_FIXTURE_PACKAGE_ROOT??'.'),installedCommand=process.env.GITJIG_SAVE_FIXTURE_INSTALLED_COMMAND;
 if(installedCommand){assert.ok(path.isAbsolute(installedCommand));assert.equal(await fs.realpath(installedCommand),path.join(packageRoot,'dist/cli/entry.js'));assert.ok(process.env.GITJIG_SAVE_FIXTURE_UI_NODE_OPTIONS);}
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:operator,GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_SAVE_FIXTURE_PACKAGE_ROOT:packageRoot,GITJIG_SAVE_FIXTURE_TRACE:trace,GITJIG_SAVE_FIXTURE_WORK_ID:workId,...installedCommand?{NODE_OPTIONS:process.env.GITJIG_SAVE_FIXTURE_UI_NODE_OPTIONS,GITJIG_INSTALLED_SOURCE_PAYLOAD:packageRoot,GITJIG_INSTALLED_SOURCE_MANIFEST:process.env.GITJIG_INSTALLED_SOURCE_MANIFEST,GITJIG_INSTALLED_SOURCE_TRACE:process.env.GITJIG_INSTALLED_SOURCE_TRACE,GITJIG_INSTALLED_SOURCE_MODE:'ui'}:{}};
 await fs.writeFile(file,JSON.stringify({command:[...installedCommand?[installedCommand]:[process.execPath,'--import',path.join(checkout,'tests/ui/source-save-no-provider.mjs'),...kind==='lost'?['--import',path.join(checkout,'tests/ui/source-save-drop-reply.mjs')]:[],path.join(packageRoot,'dist/cli/entry.js')],'conversation','ui','--conversation',cid,'--git-binary',options.effectsProfile.gitBinary],cwd:checkout,env,steps,timeoutSeconds:35,noForceKill:true,gracefulShutdownSeconds:5,expectedInputs:initialInputs.length,database:path.join(home,'state/controller.sqlite'),output}));
 let result,held;
 const running=execute('/usr/bin/python3',[path.join(checkout,'tests/cli/fork-ui-pty.py'),file],{cwd:checkout,timeout:45000,killSignal:'SIGINT',maxBuffer:2**20});void running.catch(()=>{});
 const observing=kind==='cancel'?observeOriginalSender({home,root,workId,branch,git,proxy,ready}):Promise.resolve(null);void observing.catch(()=>{});
 try{const [pty,observed]=await Promise.all([running,observing]);result=JSON.parse(pty.stdout);held=observed;}
 catch(error){await Promise.allSettled([running,observing]);throw Error('Original source terminal retained at '+file+'; '+String(error.stdout??'')+' '+String(error.stderr??''),{cause:error});}
 assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(result.alternateEntered,true);assert.equal(result.alternateExited,true);const progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));assert.equal(progress.forceKilled,false);assert.equal(progress.outputTruncated,false);assert.equal(progress.exitCode,0);assert.equal(progress.stage,steps.length);assert.ok(Number.isSafeInteger(progress.childPid)&&progress.childPid>0);assert.equal(progress.actionElapsedSeconds.length,steps.length);assert.ok(progress.actionElapsedSeconds.every((value,i)=>Number.isFinite(value)&&value>=0&&(!i||value>=progress.actionElapsedSeconds[i-1])));
 const terminal=await fs.readFile(output,'utf8');assert.ok(terminal.includes(t('save.preparing')));assert.ok(terminal.includes(t('save.saving')));assert.ok(terminal.includes(t('save.progressCancelHint')));assert.ok(terminal.includes('0s')||terminal.includes('1s'));
 const events=(await fs.readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.ok(events.some(e=>e.kind==='native'));assert.ok(events.some(e=>e.kind==='exit'&&e.denied===0));assert.ok(!events.some(e=>e.kind==='denied'));
 const timings={prepareThroughFirstReviewSeconds:progress.actionElapsedSeconds[8]-progress.actionElapsedSeconds[7],saveThroughOutcomeSeconds:progress.actionElapsedSeconds[kind==='cancel'?15:14]-progress.actionElapsedSeconds[13],nativeHelperCalls:events.filter(e=>e.kind==='native').length,scope:'Observed combined preparation/capture-open/eligibility/render and adoption/send/cleanup; not isolated backend timings'};
 const createEvent=events.find(e=>e.kind==='fixture-create');if(kind==='lost'){assert.equal(events.filter(e=>e.kind==='fixture-create').length,1);assert.equal(events.filter(e=>e.kind==='fixture-lost-return').length,1);assert.equal(events.find(e=>e.kind==='fixture-lost-return').receipt.handoff,'started');assert.ok(terminal.includes(t('save.checking')));}
 const clientRoot=held?.original.nativeAttempt.intent.prepared.clientRoot??createEvent?.clientRoot;
 const beforeReopen=clientRoot?(await fs.readdir(path.join(clientRoot,'runs'))).sort():null;
 const reopened=await openController(options);
 try{
  const page=reopened.listSourceSnapshotOperations({limit:25});assert.equal(page.operations.length,1);const original=page.operations[0];assert.equal(original.state,'RETAINED');assert.equal(original.recordedPhase,kind==='cancel'?'UNKNOWN':'CONFIRMED');assert.equal(original.workId,workId);assert.equal(original.nativeReads.length,kind==='lost'?1:0);
  assert.deepEqual(reopened.store.one('SELECT * FROM works WHERE id=?',workId),priorWork);assert.deepEqual(await reopened.changeCore.currentEvidence(workId),evidence);assert.deepEqual({...reopened.store.one("SELECT lim,consumed,reserved FROM budgets WHERE lineage=? AND kind='execution'",workId)},{lim:kind==='lost'?10:9,consumed:kind==='lost'?10:9,reserved:0});assert.equal(reopened.inspectConversation(cid).draft.text,draft);assert.deepEqual(reopened.store.all('SELECT * FROM conversation_inputs ORDER BY rowid'),initialInputs);assert.equal(reopened.store.one('SELECT count(*) n FROM conversation_inputs WHERE conversation=?',cid).n,0);
  if(kind==='cancel'){assert.equal(original.nativeAttempt.settlement.classification,'unknown');assert.ok(original.nativeAttempt.intent);assert.notEqual(original.nativeAttempt.settlement.send?.handoff,'not-started');for(const pid of [held.start.pid,held.start.gitPid,-held.start.gitPid,held.marker.pid])assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');await assert.rejects(setup(['show-ref','--verify','refs/heads/'+branch]));}else assert.equal((await setup(['rev-parse','refs/heads/'+branch])).stdout.trim(),original.binding.projectedCommit);
  if(kind==='lost'){assert.equal(original.nativeAttempt.settlement.classification,'unknown');assert.match(original.nativeAttempt.settlement.reason,/CONTROLLED_TERMINAL_SAVE_LOST_REPLY/);assert.equal(original.nativeReads[0].settlement.classification,'confirmed');}
  if(clientRoot)assert.deepEqual((await fs.readdir(path.join(clientRoot,'runs'))).sort(),beforeReopen);assert.equal((await setup(['rev-parse','HEAD'])).stdout,head);assert.deepEqual(await fs.readFile(path.join(source,'.git/index')),index);assert.deepEqual(await fs.readFile(path.join(source,'consumer.cjs')),sourceBytes);assert.equal((await setup(['--no-optional-locks','status','--porcelain=v1'])).stdout,status);
  await fs.writeFile(path.join(root,'source-save-terminal-result.json'),JSON.stringify({scope:'Actual registered result/command ENKO PTY, normal procedure and local Native; no installed claim; cancellation gate precedes receiver exec and dropped return is not crash coverage',kind,held,locale,workId,cid,draft,priorWork,initialInputs,original,result,progress,timings,events},null,2));
 }finally{await reopened.close();}
}
