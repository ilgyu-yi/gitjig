// Explicit human observation fixture; never a product startup hook or a PASS oracle.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const receiptPath=process.argv[2],resumePath=process.argv[3]==='--resume'?process.argv[4]:null;
const upgradeFrom=process.argv[5]==='--upgrade-from'?process.argv[6]:null;
if(!receiptPath||![3,5,7].includes(process.argv.length)||(process.argv.length>=5&&!resumePath)||(process.argv.length===7&&(!upgradeFrom||!/^[a-f0-9]{64}$/.test(upgradeFrom))))throw Error('Usage: OWNED_INSTALLED_NODE installed-terminal.mjs EXACT_INSTALL_RECEIPT [--resume PRIOR_OBSERVATION_JSON [--upgrade-from EXACT_PRIOR_PAYLOAD_ID]]');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function readObservation(file){
 const canonical=await fs.realpath(file),stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o022)!==0||stat.size>2*1024*1024)throw Error('Prior observation must be an owned bounded regular JSON file');
 const bytes=await fs.readFile(canonical);return{path:canonical,sha256:sha(bytes),value:JSON.parse(bytes.toString('utf8'))};
}
const prior=resumePath?await readObservation(resumePath):null;
const installed=JSON.parse(await fs.readFile(receiptPath,'utf8')),home=installed.home,payloadId=installed.payloadId,payload=path.join(home,'versions',payloadId);
if(!path.isAbsolute(home)||await fs.realpath(home)!==home||!/^[a-f0-9]{64}$/.test(payloadId))throw Error('Exact canonical installed receipt required');
if(JSON.parse(await fs.readFile(path.join(home,'binding.json'),'utf8')).payloadId!==payloadId)throw Error('Installation receipt is not the actual selected payload');
if(upgradeFrom&&(!prior||prior.value.payloadId!==upgradeFrom||payloadId===upgradeFrom||prior.value.cleanupConfirmed!==true))throw Error('Upgrade resume requires the explicit different prior payload and confirmed original cleanup');
if(prior&&(prior.value.home!==home||(prior.value.payloadId!==payloadId&&prior.value.payloadId!==upgradeFrom)||typeof prior.value.parent!=='string'||typeof prior.value.child!=='string'||prior.value.parent===prior.value.child))throw Error('Resume observation does not name this exact home/payload/conversation pair');
if(await fs.realpath(process.execPath)!==path.join(home,'bootstrap/node'))throw Error('Use this installation\'s copied Node');
process.env.TMPDIR=path.join(home,'artifacts');delete process.env.NODE_OPTIONS;delete process.env.NODE_PATH;delete process.env.PI_PACKAGE_DIR;
const {openController}=await import(pathToFileURL(path.join(payload,'dist/controller/index.js')).href);
const {startConversationUI}=await import(pathToFileURL(path.join(payload,'dist/ui/index.js')).href);
const {createAssistantMessageEventStream}=await import(pathToFileURL(path.join(payload,'node_modules/@earendil-works/pi-ai/dist/compat.js')).href);
const outputRoot=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig human terminal '))),output=path.join(outputRoot,'observations.json');
const c=await openController({installationHome:home});let parent,child;
try{
 if(prior){parent=c.inspectConversation(prior.value.parent);child=c.inspectConversation(prior.value.child);if(parent.archived||child.archived)throw Error('Recorded conversations are archived');if(child.parentId!==parent.conversationId)throw Error('Recorded child no longer belongs to the retained fixture parent');}
 else{parent=c.createConversation();child=c.createConversation();c.setConversationParent({childId:child.conversationId,parentId:parent.conversationId,expectedRevision:0});}
}catch(error){await c.close();throw error;}
async function snapshot(id){
 const view=c.inspectConversation(id),history=await c.getConversationHistory(id);
 return{...view,history:history?{path:view.historyRef,sha256:sha(await fs.readFile(view.historyRef)),leafId:history.sessionManager.getLeafId()}:null};
}
async function snapshotPair(){return{parent:await snapshot(parent.conversationId),child:await snapshot(child.conversationId),conversationIds:c.listConversations().map(v=>v.conversationId)};}
const baseRecord={format:1,home,payloadId,parent:parent.conversationId,child:child.conversationId,mode:prior?'resume':'new',upgradeFromPayload:upgradeFrom,priorObservation:prior?{path:prior.path,sha256:prior.sha256}:null,paidCalls:0,networkCalls:0};
let beforeUI,afterUI,cleanupConfirmed=false,snapshotError;
const previouslyStarted=prior?.value.firstHumanRequestStarted??(prior?.value.calls??[]).some(call=>call.kind==='child-dialog'||(call.kind==='ordinary'&&!call.text.startsWith('Owned retained history ')));
let armed=false,started=previouslyStarted,resolveEntered,resolveDialog,dialogAnswer=prior?.value.dialogAnswer??null,background;const entered=new Promise(r=>resolveEntered=r),dialogDone=new Promise(r=>resolveDialog=r);const calls=[];
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
function model(kind){return{provider:'owned-human-'+kind,modelId:'fixture',definition:{api:'owned-human-api',apiKey:'fixture-no-network',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'Human observation fixture — no paid model',reasoning:false,input:['text'],cost:usage.cost,contextWindow:200000,maxTokens:1000}],streamSimple(m,context,options){
 const stream=createAssistantMessageEventStream(),raw=context.messages.filter(m=>m.role==='user').at(-1)?.content,text=typeof raw==='string'?raw:(raw??[]).filter(v=>v.type==='text').map(v=>v.text).join('');calls.push({kind,text,time:new Date().toISOString()});let settled=false,timer;
 const message={role:'assistant',content:[],api:m.api,provider:m.provider,model:m.id,usage,stopReason:'stop',timestamp:Date.now()};
 const finish=(value,aborted=false)=>{if(settled)return;settled=true;clearTimeout(timer);options?.signal?.removeEventListener('abort',abort);const result={...message,content:[{type:'text',text:value}],stopReason:aborted?'aborted':'stop',...(aborted?{errorMessage:'Actual fixture response aborted by host'}:{})};stream.push(aborted?{type:'error',reason:'aborted',error:result}:{type:'done',reason:'stop',message:result});stream.end(result);};
 const abort=()=>finish('',true);options?.signal?.addEventListener('abort',abort,{once:true});if(options?.signal?.aborted){abort();return stream;}
 if(kind==='child-dialog'){queueMicrotask(async()=>{try{const handle=c.getNativeHandle(child.conversationId);dialogAnswer=await handle.session.extensionRunner.getUIContext().confirm('자식의 실제 대화상자','이 자식 창에서만 직접 응답해 주세요.');resolveDialog();finish('Child dialog answer: '+String(dialogAnswer));}catch(e){finish(String(e),true);}});}
 else if(armed&&!started){started=true;resolveEntered();dialogDone.then(()=>finish('Parent resumed after the actual child dialog. Exact submitted input: '+JSON.stringify(text)));}
 else timer=setTimeout(()=>finish('Exact submitted input: '+JSON.stringify(text)),armed?1800:0);
 return stream;
}}};}
const mainModel=model('ordinary');let closed=false;
try{
 if(!prior)for(let i=0;i<4;i++){await c.queueConversationInput({conversationId:parent.conversationId,expectedGeneration:c.inspectConversation(parent.conversationId).generation,text:'Owned retained history '+i+' '+('scroll and compaction context '.repeat(1000)),mode:'idle'});await c.runConversation({conversationId:parent.conversationId,model:mainModel});}
 if(!prior)c.setDraft({conversationId:child.conversationId,expectedRevision:0,text:'자식의 보존된 초안'});
 beforeUI=await snapshotPair();armed=true;
 if(!started)background=(async()=>{await entered;if(closed)return;await c.queueConversationInput({conversationId:child.conversationId,expectedGeneration:c.inspectConversation(child.conversationId).generation,text:'Owned human observation: request an actual child-only native dialog',mode:'idle'});return c.runConversation({conversationId:child.conversationId,model:model('child-dialog')});})();
 await fs.writeFile(output,JSON.stringify({...baseRecord,beforeUI,firstHumanRequestStarted:started,humanObservation:'NOT RECORDED'},null,2),{mode:0o600});
 console.error('Human fixture receipt: '+output+'\n'+(prior?'Resuming the exact retained conversations without reseeding or dispatch. Continue retained draft/history. ':'Type Korean in parent first; ')+ 'F2 selects child, F4 splits, F6 history tree, F7 compacts. This does not record a human PASS.');
 await startConversationUI({controller:c,model:mainModel,conversationId:parent.conversationId,retention:{completedLimit:0,idleGraceMs:0}});
}finally{
 closed=true;
 try{await c.settleInteractionHost({identities:[]});}
 finally{
  resolveEntered();resolveDialog();
  try{await background?.catch(()=>{});}
  finally{
   try{afterUI=await snapshotPair();}catch(error){snapshotError=String(error.message);}
   try{await c.close();cleanupConfirmed=true;}
   finally{
    await fs.writeFile(output,JSON.stringify({...baseRecord,beforeUI,afterUI,snapshotError,cleanupConfirmed,firstHumanRequestStarted:started,dialogAnswer,calls,humanObservation:'NOT RECORDED — observer must record actual IME/focus/editing outcomes separately'},null,2),{mode:0o600});
    console.error('Retained human fixture evidence: '+output);
   }
  }
 }
}
