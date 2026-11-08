import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {applyApplicationReset,prepareApplicationReset} from '../../dist/app/reset.js';
import {listResetBackups,deleteResetBackup} from '../../dist/app/reset-backups.js';
import {uiText} from '../../dist/ui/i18n.js';
import {resetRecoveryCommand} from '../../dist/installation/reset-recovery-command.js';
const execute=promisify(execFile);
const cliEntry=process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js';

async function holdConfirmedDeletion(root, home) {
 const guard=path.join(root,'hold-deletion.mjs'),started=path.join(root,'deletion-started'),releaseFile=path.join(root,'release-deletion');
 await fs.writeFile(guard,`import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const remove=fs.rm;
fs.rm=async (file,...args)=>{
 if(path.dirname(String(file))===${JSON.stringify(path.join(home,'reset-deletions'))}){
  await fs.writeFile(${JSON.stringify(started)},'held');
  const deadline=Date.now()+5000;
  while(!await fs.access(${JSON.stringify(releaseFile)}).then(()=>true,()=>false)){
   if(Date.now()>=deadline)throw Error('Terminal did not observe its confirmed deletion');
   await delay(20);
  }
 }
 return remove(file,...args);
};`);
 return {guard, waitFiles:[{path:started,value:'held'}],releaseFile};
}

for(const [action,locale] of [['recover','en'],['backup-recover','ko']])test(
 'original terminal reports the confirmed pending '+action+' command in '+locale,{timeout:18000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-pty-'))),home=path.join(root,"owner's app");
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset terminal '+root);});
 const c=await openController({installationHome:home}),cid=c.createConversation().conversationId;
 c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
 await c.close();
 const config=path.join(home,'config'),marker=path.join(config,'original'),backups=action==='backup-recover';
 await fs.mkdir(config,{mode:0o700});await fs.writeFile(marker,'owned original',{mode:0o600});
 if(backups){
  const preview=await prepareApplicationReset(home,'settings');
  await applyApplicationReset(home,'settings',preview.fingerprint);
  await fs.mkdir(config,{mode:0o700});await fs.writeFile(marker,'new active settings',{mode:0o600});
 }
 const guard=path.join(root,'stop.mjs');
 await fs.writeFile(guard,`import fs from 'node:fs/promises';import path from 'node:path';
const remove=fs.rm;
fs.rm=async(file,...args)=>{
 if(path.dirname(String(file))===${JSON.stringify(path.join(home,'reset-deletions'))})
  throw Object.assign(Error('Controlled removal failure'),{code:'EIO'});
 return remove(file,...args);
};`);
 const tr=key=>uiText(locale,key),file=path.join(root,'pty.json'),output=file+'.terminal';
 const steps=[
  {wait:tr('footer.setup'),send:'/reset\r'},
  ...(backups?[
   {wait:tr('reset.title'),send:tr('reset.manageBackups')+'\r'},
   {wait:tr('reset.backupsCloseTitle'),send:tr('reset.backupsClose')+'\r'},
   {wait:'백업 번호',send:'1\n'},
  ]:[
   {wait:tr('reset.title'),send:tr('reset.settings')+'\r'},
   {wait:tr('reset.policyTitle'),send:tr('reset.delete')+'\r'},
   {wait:tr('reset.openShutdown'),send:'\r'},
   {wait:tr('reset.closeTitle'),send:tr('reset.close')+'\r'},
  ]),
  {wait:backups?'DELETE를 입력':'Type DELETE to confirm',send:'DELETE\n'},
 ];
 const env={...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,cliEntry,'conversation','ui','--home',home,'--conversation',cid],
  env,steps,timeoutSeconds:12,output}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[2,steps.length,true]);
 const text=await fs.readFile(output,'utf8');
 assert.ok(text.includes(tr(backups?'reset.backupDeletionInterrupted':'reset.interrupted')));
 assert.ok(text.split(/\r?\n/u).includes(resetRecoveryCommand(home,action)));
 assert.match(text,/Controlled removal failure/);
 assert.ok(!text.includes(tr('reset.reopen')));
 const journal=path.join(home,backups?'reset-backup-delete-pending.json':'reset-pending.json');
 const pending=await fs.readFile(journal,'utf8');
 assert.equal(JSON.parse(pending).phase,'deleting');
 await assert.rejects(execute(process.execPath,['--import',guard,cliEntry,'reset',action,'--home',home],{env}),error=>{
  assert.equal(error.code,2);
  assert.equal(error.stdout,'');
  assert.deepEqual(JSON.parse(error.stderr),{
   error:backups?'RESET_BACKUP_RECOVERY_REQUIRED':'RESET_RECOVERY_REQUIRED',
   message:'Controlled removal failure',
   recovery:resetRecoveryCommand(home,action),
  });
  return true;
 });
 assert.equal(await fs.readFile(journal,'utf8'),pending);
 const recovered=await execute(process.execPath,[cliEntry,'reset',action,'--home',home],{env});
 assert.equal(JSON.parse(recovered.stdout)[backups?'deleted':'reset'],true);
 await assert.rejects(fs.lstat(journal),{code:'ENOENT'});
 if(backups)assert.equal(await fs.readFile(marker,'utf8'),'new active settings');
 else await assert.rejects(fs.lstat(marker),{code:'ENOENT'});
 passed=true;
});

for(const [scope,disposition,answer] of [['settings','backup','cancel'],['settings','backup','RESET'],['all','backup','RESET'],['settings','delete','DELETE'],['all','delete','DELETE'],['settings','delete','RESET']])test('original terminal hands off reset '+scope+' '+disposition+' after close; final word '+answer,{timeout:20000},async t=>{
 const confirm=answer===(disposition==='backup'?'RESET':'DELETE');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-pty-'))),home=path.join(root,"owner's app");let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset terminal '+root);});
 const c=await openController({installationHome:home});const cid=c.createConversation().conversationId;await c.close();
 const config=path.join(home,'config');await fs.mkdir(config,{recursive:true,mode:0o700});const original='{"editorPaddingX":2}\n';await fs.writeFile(path.join(config,'settings.json'),original,{mode:0o600});
 const keptBackup=path.join(home,'reset-backups/kept');await fs.mkdir(keptBackup,{recursive:true,mode:0o700});await fs.writeFile(path.join(keptBackup,'sentinel'),'prior backup retained');
 const held=confirm&&disposition==='delete'?await holdConfirmedDeletion(root,home):undefined;
 const file=path.join(root,'pty.json');const steps=[
  {wait:'/ready',send:confirm?'/reset\r':'/settings\r'},
  ...(!confirm?[{wait:'Application preferences',send:'Reset local application data\r'}]:[]),
  {wait:'Reset local gitjig data',send:scope==='all'?'Reset all local\r':'Reset settings\r'},
  {wait:'Reset data policy',send:disposition==='backup'?'Keep a private backup\r':'Permanently delete selected data\r'},
  {wait:'Open safe shutdown confirmation',send:'\r'},
  {wait:'Continue to reset review',send:'Close safely\r'},
  {wait:disposition==='backup'?'Type RESET to confirm':'Type DELETE to confirm',send:answer+'\n'},
  ...(held?[{wait:'Applying confirmed reset without a backup',waitFiles:held.waitFiles,releaseFile:held.releaseFile,send:''}]:[]),
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(held?['--import',held.guard]:[]),'--import','./tests/cli/account-ui-no-network.mjs',cliEntry,'conversation','ui','--home',home,'--conversation',cid,'--completed-view-limit','4'],env:{...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:14,gracefulShutdownSeconds:3,output:file+'.terminal'}));
 const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:18000,maxBuffer:2**20})).stdout);
 assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
 const output=await fs.readFile(file+'.terminal','utf8');assert.ok(output.includes(home));
 const operand = `conversation ui --home '${root}/owner'\\''s app'`;
 const reopen = output.split(/\r?\n/u).find(line => line.includes(operand));
 assert.ok(reopen, 'The terminal provides the exact same-home reopen command');
 if (scope==='all' && confirm) assert.ok(!reopen.includes('--conversation') && !reopen.includes('--completed-view-limit'));
 else assert.ok(reopen.includes(`--conversation '${cid}' '--completed-view-limit' '4'`));
 assert.equal(output.includes('Applying confirmed reset'),confirm);
 assert.ok(output.includes('Selected paths and all their current contents'));
 assert.ok(output.includes(JSON.stringify(config)));
 assert.equal(output.includes('Private backup directory'),disposition==='backup');
 assert.equal(await fs.readFile(path.join(keptBackup,'sentinel'),'utf8'),'prior backup retained');
 if(confirm){assert.equal(await fs.access(path.join(config,'settings.json')).then(()=>true,()=>false),false);if(disposition==='delete'){assert.match(output,/permanent deletion/);assert.deepEqual(await fs.readdir(path.dirname(keptBackup)),['kept']);}else{const ids=(await fs.readdir(path.dirname(keptBackup))).filter(id=>id!=='kept');assert.equal(ids.length,1);assert.equal(await fs.readFile(path.join(path.dirname(keptBackup),ids[0],'config/settings.json'),'utf8'),original);}}
 else{assert.equal(await fs.readFile(path.join(config,'settings.json'),'utf8'),original);assert.match(output,/Reset cancelled/);}
 const reopened=await openController({installationHome:home});if(scope==='all'&&confirm)assert.equal(reopened.listConversations().length,0);else assert.equal(reopened.inspectConversation(cid).conversationId,cid);await reopened.close();passed=true;
});

test('terminal backup management preserves drafts and deletes only the separately confirmed backup',{timeout:25000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-backups-pty-'))),home=path.join(root,'app');
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained backup terminal '+root);});
 const controller=await openController({installationHome:home}),cid=controller.createConversation().conversationId,draft='  Unsaved 한국어  ';
 controller.setDraft({conversationId:cid,expectedRevision:0,text:draft});await controller.close();
 const config=path.join(home,'config'),receipt=path.join(home,'state/controller.sqlite');
 const ids=[];
 for(const [name,date] of [['first','2024-04-02T12:00:00.000Z'],['second','2024-04-03T12:00:00.000Z']]){
  await fs.mkdir(config,{mode:0o700});
  await fs.writeFile(path.join(config,'original'),name,{mode:0o600});
  const preview=await prepareApplicationReset(home,'settings');
  const applied=await applyApplicationReset(home,'settings',preview.fingerprint);
  await fs.utimes(path.join(applied.backup,'reset-receipt.json'),new Date(date),new Date(date));
  ids.push(path.basename(applied.backup));
 }
 const {backups}=await listResetBackups(home,{includeReceiptTime:true});
 const fileFor=id=>path.join(home,'reset-backups',id,'config/original');
 assert.equal(backups.find(backup=>backup.backupId===ids[1]).receiptModifiedAt,'2024-04-03T12:00:00.000Z');
 assert.ok((await listResetBackups(home)).backups.every(backup=>!Object.hasOwn(backup,'receiptModifiedAt')));
 const terminal=async(label,answer)=>{
  const file=path.join(root,label+'.json');
  const held=answer==='DELETE'?await holdConfirmedDeletion(root,home):undefined;
  const steps=[
   {wait:'/ready',assertDraft:draft,send:'\x07/'},
   {wait:'Gitjig commands · search',assertDraft:draft,send:'/reset\r'},
   {wait:'Reset local gitjig data',assertDraft:draft,send:'Manage saved reset backups\r'},
   {wait:'Close this session to review saved backups?',assertDraft:draft,send:'Close safely and list saved backups\r'},
   {wait:'Enter a backup number',send:'1\n'},
   {wait:'Type DELETE to permanently delete this backup',send:answer+'\n'},
   ...(held?[{wait:'Applying confirmed deletion of backup '+ids[1],waitFiles:held.waitFiles,releaseFile:held.releaseFile,send:''}]:[]),
  ];
  await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(held?['--import',held.guard]:[]),cliEntry,'conversation','ui','--home',home,'--conversation',cid],env:{...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:10,database:receipt,output:file+'.terminal'}));
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  return fs.readFile(file+'.terminal','utf8');
 };
 const cancelled=await terminal('cancel','RESET');
 assert.match(cancelled,/Backup deletion cancelled/);
 assert.doesNotMatch(cancelled,/Applying confirmed deletion/);
 assert.ok(cancelled.includes('1. '+ids[1]+' · Reset settings and saved application accounts · receipt modified 2024-04-03T12:00:00.000Z'));
 assert.ok(cancelled.includes(JSON.stringify(path.join(home,'reset-backups',ids[1]))));
 assert.equal(await fs.readFile(fileFor(ids[1]),'utf8'),'second');
 assert.match(await terminal('delete','DELETE'),new RegExp('Deleted saved reset backup '+ids[1]));
 await assert.rejects(fs.stat(fileFor(ids[1])),{code:'ENOENT'});
 assert.equal(await fs.readFile(fileFor(ids[0]),'utf8'),'first');
 const reopened=await openController({installationHome:home});
 try{assert.equal(reopened.inspectConversation(cid).draft.text,draft);}
 finally{await reopened.close();}
 passed=true;
});

for(const locale of ['en','ko'])test('backup management gives the exact pending recovery home in '+locale,{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-recovery-home-')));
 const home=path.join(root,"owner's private home"),draft='Preserve this 별도 draft';
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const controller=await openController({installationHome:home}),initial=controller.createConversation().conversationId,cid=controller.createConversation().conversationId;
 controller.setConversationLanguage({conversationId:initial,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
 controller.setConversationName({conversationId:cid,expectedGeneration:0,name:'Chosen maintenance conversation'});
 controller.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
 controller.setDraft({conversationId:cid,expectedRevision:0,text:draft});await controller.close();
 const settings=path.join(home,'config');await fs.mkdir(settings,{mode:0o700});
 await fs.writeFile(path.join(settings,'marker'),'original backed-up data',{mode:0o600});
 const preview=await prepareApplicationReset(home,'settings');
 await applyApplicationReset(home,'settings',preview.fingerprint);
 const {backups:[backup]}=await listResetBackups(home);
 const remove=fs.rm;
 const fault=t.mock.method(fs,'rm',async(file,...args)=>{
  if(path.dirname(file)===path.join(home,'reset-deletions'))throw Error('Controlled interrupted deletion');
  return remove(file,...args);
 });
 try{await assert.rejects(deleteResetBackup(home,backup.backupId,backup.fingerprint),/Controlled interrupted deletion/);}
 finally{fault.mock.restore();}
 const journal=path.join(home,'reset-backup-delete-pending.json'),before=await fs.readFile(journal);
 const recovery=`gitjig reset backup-recover --home '${root}/owner'\\''s private home'`;
 const steps=[
  {wait:locale==='ko'?'/ready 설정':'/ready',assertDraft:'',expectedSelected:initial,send:'\x07c'},
  {wait:uiText(locale,'navigation.title'),send:'Chosen maintenance conversation\r'},
  {wait:draft,assertDraft:draft,expectedSelected:cid,send:'\x07/'},
  {wait:locale==='ko'?'gitjig 명령 검색':'Gitjig commands · search',assertDraft:draft,send:'/reset\r'},
  {wait:uiText(locale,'reset.title'),send:uiText(locale,'reset.manageBackups')+'\r'},
  {wait:uiText(locale,'reset.backupsCloseTitle'),send:uiText(locale,'reset.backupsClose')+'\r'},
 ];
 const file=path.join(root,'terminal.json'),output=file+'.terminal';
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,cliEntry,'conversation','ui','--home',home,'--conversation',initial],
  env:{HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,timeoutSeconds:10,database:path.join(home,'state/controller.sqlite'),output}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 const terminal=await fs.readFile(output,'utf8');
 assert.ok(terminal.includes(recovery));
 assert.ok(terminal.includes(`conversation ui --home '${root}/owner'\\''s private home' --conversation '${cid}'`));
 assert.equal((await listResetBackups(home)).pendingDeletion.recovery,recovery);
 assert.deepEqual(await fs.readFile(journal),before);
 const owned=await openController({installationHome:home});
 try{assert.equal(owned.inspectConversation(cid).draft.text,draft);}finally{await owned.close();}
});

test('Korean reset review Escape keeps the session and later shutdown shows the exact roots', {timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-back-ko-'))),home=path.join(root,'home');
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained reset terminal '+root);});
 const c=await openController({installationHome:home}),cid=c.createConversation().conversationId,draft='유지할 초안';
 c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:'ko'});
 c.setDraft({conversationId:cid,expectedRevision:0,text:draft});await c.close();
 const label=key=>uiText('ko',key),file=path.join(root,'terminal.json');
 const open=[
  {wait:'/ready 설정',assertDraft:draft,send:'\x07/'},
  {wait:'gitjig 명령 검색',send:'/reset\r'},
  {wait:label('reset.title'),send:label('reset.all')+'\r'},
  {wait:label('reset.policyTitle'),send:label('reset.delete')+'\r'},
 ];
 const steps=[...open,{wait:label('reset.openShutdown'),send:'\x1b'},...open,
  {wait:label('reset.openShutdown'),send:'\r'},
  {wait:label('reset.closeTitle'),send:label('reset.close')+'\r'},
  {wait:'확인하려면 DELETE',send:'\n'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,cliEntry,'conversation','ui','--home',home,'--conversation',cid],
  env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,output:file+'.terminal',database:path.join(home,'state/controller.sqlite'),timeoutSeconds:9,expectedInputs:0}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
 assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const terminal=await fs.readFile(file+'.terminal','utf8');
 assert.ok(terminal.includes(label('reset.previewRoots')));
 assert.ok(terminal.includes(JSON.stringify(path.join(home,'state/controller.sqlite'))));
 assert.match(terminal,/초기화를 취소했습니다/);
 const reopened=await openController({installationHome:home});
 try{assert.equal(reopened.inspectConversation(cid).draft.text,draft);}
 finally{await reopened.close();}
 passed=true;
});

test('fresh conversation readiness leaves no settings reset targets and preserves the original draft',{timeout:15000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-reset-empty-pty-'))),home=path.join(root,'home');
 let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained empty reset handoff '+root);});
 const c=await openController({installationHome:home}),cid=c.createConversation().conversationId,draft='다시 열면 유지될 초안';
 c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:'ko'});
 c.setDraft({conversationId:cid,expectedRevision:0,text:draft});await c.close();
 assert.deepEqual((await prepareApplicationReset(home,'settings','delete')).paths,[]);
 const label=key=>uiText('ko',key),file=path.join(root,'terminal.json'),output=file+'.terminal';
 const steps=[
  {wait:'/ready 설정',assertDraft:draft,send:'\x07t'},
  {wait:label('ready.title'),send:'\x1b'},
  {wait:'/ready 설정',assertDraft:draft,send:'\x07/'},
  {wait:'gitjig 명령 검색',send:'/reset\r'},
  {wait:label('reset.title'),send:label('reset.settings')+'\r'},
  {wait:label('reset.policyTitle'),send:label('reset.delete')+'\r'},
  {wait:label('reset.openShutdown'),send:'\r'},
  {wait:label('reset.closeTitle'),send:label('reset.close')+'\r'},
 ];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,cliEntry,'conversation','ui','--home',home,'--conversation',cid],
  env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
  steps,output,database:path.join(home,'state/controller.sqlite'),timeoutSeconds:8,expectedInputs:0}));
 const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000})).stdout);
 assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
 const terminal=await fs.readFile(output,'utf8');
 assert.ok(terminal.includes(label('reset.noTargets')));
 assert.doesNotMatch(terminal,/확인하려면 DELETE|초기화 완료|확인한 초기화를 적용/);
 for(const name of ['config','reset-backups','reset-deletions','reset-pending.json'])await assert.rejects(fs.lstat(path.join(home,name)),{code:'ENOENT'});
 const reopened=await openController({installationHome:home});
 try{assert.equal(reopened.inspectConversation(cid).draft.text,draft);}
 finally{await reopened.close();}
 passed=true;
});
