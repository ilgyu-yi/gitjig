// Controlled drive boundary over the original source CLI/UI. No model or engine request.
import fs from 'node:fs/promises';import path from 'node:path';
import {ChangeCore} from '../../dist/controller/change-core.js';
import {Store} from '../../dist/controller/store.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const run=Store.prototype.run;Store.prototype.run=function(sql,...args){const result=run.call(this,sql,...args);if(cfg.failAdmission&&sql.startsWith('INSERT INTO change_state'))throw Error('CONTROLLED_ADMISSION_FAILURE');return result;};
let calls=0,active=false,settled=false,accountsClosed=false;
const record=()=>fs.writeFile(cfg.receipt,JSON.stringify({calls,active,settled,accountsClosed}));
const close=ApplicationAccounts.prototype.close;
ApplicationAccounts.prototype.close=async function(){if(active)throw Error('Account resources closed before supervised work settled');accountsClosed=true;await record();return close.call(this);};
if(cfg.holdBeforeCapture){
 const begin=ChangeCore.prototype.begin;
 ChangeCore.prototype.begin=async function(input,...rest){
  active=true;await record();
  await new Promise(resolve=>{const finish=()=>{input.signal.removeEventListener('abort',finish);resolve();};if(input.signal.aborted)finish();else input.signal.addEventListener('abort',finish,{once:true});});
  active=false;settled=true;await record();
  return begin.call(this,input,...rest);
 };
}
ChangeCore.prototype.drive=async function(input){
 if(++calls>1)throw Error('Unexpected duplicate UI drive');active=true;await record();
 await new Promise(resolve=>{let timer;const finish=()=>{clearInterval(timer);input.signal.removeEventListener('abort',finish);resolve();};timer=setInterval(()=>{fs.access(cfg.release).then(finish,()=>{});},15);if(input.signal.aborted)finish();else input.signal.addEventListener('abort',finish,{once:true});});
 active=false;settled=true;await record();
 if(cfg.fail)throw Error('CONTROLLED_SOURCE_FAILURE');
 return this.inspect(input.workId);
};
process.argv=[process.execPath,path.resolve('dist/cli/entry.js'),'conversation','ui','--home',cfg.home,'--conversation',cfg.cid];
await import('../../dist/cli/entry.js');await record();
