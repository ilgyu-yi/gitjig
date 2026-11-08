// Explicit owned fixture seam: lose only the return of one real started send.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=fs.realpathSync(process.env.GITJIG_SAVE_FIXTURE_PACKAGE_ROOT),trace=process.env.GITJIG_SAVE_FIXTURE_TRACE,work=process.env.GITJIG_SAVE_FIXTURE_WORK_ID;
if(!work)throw Error('Exact original fixture work required');
const {SourceSnapshotActions}=await import(pathToFileURL(path.join(root,'dist/controller/source-snapshot-actions.js')).href);
const reviewGate=process.env.GITJIG_SAVE_FIXTURE_READ_REVIEW_WAIT;
if(reviewGate){
 const review=SourceSnapshotActions.prototype.reviewReconciliation;
 let waiting=false;
 SourceSnapshotActions.prototype.reviewReconciliation=function(id,controls){
  const original=this.inspect(id);
  if(waiting||original.state!=='RETAINED'||original.workId!==work)return review.call(this,id,controls);
  waiting=true;
  const signal=controls.signal;
  signal.throwIfAborted();
  return new Promise((_resolve,reject)=>{
   signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
   fs.writeFileSync(reviewGate,'waiting-for-escape',{mode:0o600});
  });
 };
}
const original=SourceSnapshotActions.prototype.executeDispatch;
let dropped=false;
SourceSnapshotActions.prototype.executeDispatch=function(dispatch,client,signal){
 if(dispatch.purpose!=='create'||dispatch.original.workId!==work)return original.call(this,dispatch,client,signal);
 fs.appendFileSync(trace,JSON.stringify({kind:'fixture-create',pid:process.pid,operationId:dispatch.original.operationId,clientRoot:dispatch.proof.native.initialized.namespace.clientRoot})+'\n');
 return original.call(this,dispatch,{
  prepareSourceBranchCreate:client.prepareSourceBranchCreate.bind(client),preparedSourceReference:client.preparedSourceReference.bind(client),
  async spawnPreparedSourceBranchCreate(handle){
   const receipt=await client.spawnPreparedSourceBranchCreate(handle);
   if(!dropped&&receipt.handoff==='started'){
    dropped=true;fs.appendFileSync(trace,JSON.stringify({kind:'fixture-lost-return',pid:process.pid,operationId:dispatch.original.operationId,receipt})+'\n');
    throw Error('CONTROLLED_TERMINAL_SAVE_LOST_REPLY');
   }
   return receipt;
  },
  reconcileSourceBranchCreate:client.reconcileSourceBranchCreate.bind(client),
 },signal);
};
