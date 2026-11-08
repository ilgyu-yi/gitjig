// Original opening/store/writer boundaries. No model, engine or successful standing.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import sync from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const root=process.argv[2],mode=process.argv[3],home=path.join(root,'app'),load=relative=>import(new URL('../../dist/'+relative,import.meta.url));
const {openController,Controller}=await load('controller/index.js'),{ApplicationStartup}=await load('app/startup.js'),{ApplicationAccounts}=await load('app/accounts.js');
const runtime={dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTED',image:'sha256:'+'0'.repeat(64),dockerConfigDirectory:path.join(root,'docker')};await fs.mkdir(runtime.dockerConfigDirectory,{mode:0o700});
const tables=['projects','sources','conversations','conversation_state','conversation_views','conversation_inputs','works','change_state','runs','budgets','capacity_leases','obligations'];
const ledger=c=>Object.fromEntries(tables.map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
let c;
if(mode==='opening'){
 const order=[],recover=Controller.prototype.recover,changes=Controller.prototype.recoverChanges;
 Controller.prototype.recover=async function(){order.push('recover');assert.equal(this.options.runtimeProfile.dockerContext,'EXPLICIT');assert.equal(this.options.runtimeProfile.dockerConfigDirectory,undefined);return recover.call(this);};Controller.prototype.recoverChanges=function(){order.push('changes');return changes.call(this);};
 try{
  c=await openController({installationHome:home,runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'EXPLICIT',image:runtime.image}},{prepareStartup:async context=>{order.push('prepare');assert.equal(context.installationHome,home);assert.equal(Object.isFrozen(context),true);assert.equal(Object.isFrozen(context.projectRoots),true);assert.deepEqual(context.projectRoots,[]);return{runtimeProfile:runtime};}});
  assert.deepEqual(order,['prepare','recover','changes']);await c.close();c=undefined;
  order.length=0;c=await openController({installationHome:home},{managementOnly:true,prepareStartup:async()=>{order.push('prepare');return{runtimeProfile:runtime};}});assert.deepEqual(order,['prepare']);assert.equal(c.options.runtimeProfile.dockerConfigDirectory,runtime.dockerConfigDirectory);await c.close();c=undefined;assert.deepEqual(order,['prepare']);
  console.log(JSON.stringify({complete:true,actualPrepareBeforeRecovery:true,wholeInvocationOverride:true,managementSkipsBothRecovery:true}));
 }finally{Controller.prototype.recover=recover;Controller.prototype.recoverChanges=changes;await c?.close();}
}else{
 assert.equal(mode,'storage');c=await openController({installationHome:home});
 try{
  const project=path.join(root,'project');await fs.mkdir(project,{mode:0o700});await fs.writeFile(path.join(project,'file.txt'),'SOURCE');await c.registerProject({id:'P',sourceRoot:project});
  const conversation=c.createConversation();await c.queueConversationInput({conversationId:conversation.conversationId,expectedGeneration:0,text:'Original pending owner input',mode:'idle'});
  const work=await c.beginChange({projectId:'P',request:'Original source baseline; no role execution'});
  // Deliberate retained uncertainty; this is NOT generated completion or standing.
  c.store.run('UPDATE works SET state=? WHERE id=?','UNKNOWN',work.workId);const before=ledger(c);await fs.writeFile(path.join(root,'before.json'),JSON.stringify(before));await c.close();c=undefined;
  c=await openController({installationHome:home},{managementOnly:true});assert.deepEqual(ledger(c),before);
  const startup=ApplicationStartup.open(c),accounts=ApplicationAccounts.open(c);await fs.mkdir(path.join(home,'config'),{recursive:true,mode:0o700});
  assert.throws(()=>c.queueConversationInput({conversationId:conversation.conversationId,expectedGeneration:0,text:'MUST_NOT_QUEUE',mode:'idle'}),/MANAGEMENT_ONLY/);
  assert.throws(()=>c.runConversation({conversationId:conversation.conversationId}),/MANAGEMENT_ONLY/);
  await assert.rejects(c.beginChange({projectId:'P',request:'MUST_NOT_BEGIN'}),/MANAGEMENT_ONLY/);await assert.rejects(c.cancelWork({workId:work.workId}),/MANAGEMENT_ONLY/);
  assert.throws(()=>c.createConversation(),/MANAGEMENT_ONLY/);
  await assert.rejects(async()=>c.planChange({workId:work.workId}),/MANAGEMENT_ONLY/);
  assert.throws(()=>c.prepareIntegration({workId:work.workId,targetId:'UNUSED',operationId:'UNUSED'}),/MANAGEMENT_ONLY/);
  await assert.rejects(accounts.configure({providers:{}}),/Settle active/);assert.deepEqual(ledger(c),before);
  const file=path.join(home,'config/startup.json'),original=fs.realpath;let injected=false;
  fs.realpath=async function(value,...args){const result=await original.call(this,value,...args);if(value==='/usr/bin/false'&&!injected){injected=true;sync.writeFileSync(file,'',{mode:0o600});}return result;};
  try{await assert.rejects(startup.save({version:1,runtime}),/changed during validation/);assert.equal(injected,true);assert.equal((await fs.readFile(file)).length,0);}finally{fs.realpath=original;}
  const marker='STARTUP_MALFORMED_SECRET_NEVER_RENDER';await fs.writeFile(file,'{"runtime":"'+marker,{mode:0o600});const inspected=await startup.inspect();assert.ok(inspected.diagnostic);assert.equal(JSON.stringify(inspected).includes(marker),false);
  await startup.save({version:1,runtime});assert.equal((await startup.inspect()).saved.runtime.dockerConfigDirectory,runtime.dockerConfigDirectory);assert.deepEqual(ledger(c),before);
  await assert.rejects(startup.save({version:1,runtime:{...runtime,dockerConfigDirectory:path.join(project,'missing')}}));assert.deepEqual(ledger(c),before);
  const executable=await fs.realpath(process.execPath),profile={kind:'installed-claude-bridge',cwd:path.join(root,'host'),agentDir:path.join(root,'agent'),executable:{file:executable,sha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex')}};
  await fs.writeFile(path.join(root,'agent/claude-bridge.json'),'{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}',{mode:0o600});
  const previous=await fs.readFile(file);await assert.rejects(startup.save({version:1,bridge:{profile,nativeAccountDirectory:path.join(home,'state')}}),/disjoint/);assert.ok((await fs.readFile(file)).equals(previous));assert.deepEqual(ledger(c),before);
  await startup.clear();assert.deepEqual((await startup.inspect()).saved,{version:1});assert.deepEqual(ledger(c),before);
  const cleared=await fs.readFile(file),entered=Promise.withResolvers(),release=Promise.withResolvers();let held=false;
  fs.realpath=async function(value,...args){const result=await original.call(this,value,...args);if(value==='/usr/bin/false'&&!held){held=true;entered.resolve();await release.promise;}return result;};
  let closing;
  try{
   const saving=startup.save({version:1,runtime}).then(value=>({value}),error=>({error}));await entered.promise;
   let closed=false;closing=c.close().then(()=>{closed=true;});
   await assert.rejects(openController({installationHome:home},{managementOnly:true}),error=>error.code==='OWNER_BUSY');assert.equal(closed,false);assert.ok((await fs.readFile(file)).equals(cleared));
   release.resolve();const outcome=await saving;assert.match(outcome.error?.message??'',/Startup setup is closing/);await closing;c=undefined;assert.ok((await fs.readFile(file)).equals(cleared));
  }finally{release.resolve();fs.realpath=original;await closing;}

  c=await openController({installationHome:home},{managementOnly:true});assert.deepEqual(ledger(c),before);await fs.writeFile(path.join(root,'after.json'),JSON.stringify(ledger(c)));await c.close();c=undefined;
  console.log(JSON.stringify({complete:true,retainedAuthorityUnchanged:true,actualPendingInput:true,controlledUnknownWork:true,managementAdmissionRefused:true,accountSourceGuardRetained:true,emptyFilePresenceRefused:true,malformedRepair:true,reservedAccountRefused:true,closeJoinsSaveWithHomeOwner:true,noLateWrite:true}));
 }finally{await c?.close();}
}
