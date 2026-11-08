import {randomUUID} from 'node:crypto';
import {failedWaitWorld} from './original-failed-wait-fixture.mjs';
/** Real assignment/WAIT/publication; controlled retained version proves display only. */
export async function recordedResultWorld(t, options={}) {
 const retain=process.env.GITJIG_RETAIN_RECORDED_RESULT_FIXTURE==='1';
 const f=await failedWaitWorld(t,{...options,...(retain?{retainRoot:true}:{}),originalGovernedDispatch:true,prepareResult(c,child){
  const base=c.store.one("SELECT * FROM change_versions WHERE work=? AND kind='base'",child.workId),id=randomUUID();
  c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,child.workId,'candidate',base.id,base.artifact,base.hash,base.data);
  c.store.run('UPDATE change_state SET candidate=? WHERE work=?',id,child.workId);
 },onContinuation:()=>({text:'No candidate was produced. No checks ran.'})});
 await f.settle();if(retain)t.diagnostic('Retained recorded-result controller fixture '+f.root);return f;
}
