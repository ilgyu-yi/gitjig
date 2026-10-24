import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
import {summaryPublicationFixture} from './summary-publication-fixture.mjs';
const execute=promisify(execFile);
for(const closing of [false,true])test('actual original summary recovery terminal '+(closing?'joins recovered preflight on close':'reuses original and separately sends current revision'),{timeout:18000},async t=>{
 const tls=await repositoryTlsFixture(t),f=await summaryPublicationFixture(t),home=f.c.applicationHome(),file=path.join(f.root,'summary-publication-ui.json'),marker=path.join(f.root,'preflight-entered');
 const priorRead=f.holdPreflight(),abort=new AbortController(),preparing=f.c.prepareContributionSummaryPublication({resourceId:f.parent.resourceId,revisionId:f.summary.revisionId,targetId:f.targetId,signal:abort.signal});await priorRead.entered;abort.abort();const original=await preparing;priorRead.release();assert.equal(original.phase,'REFUSED');
 const old=JSON.parse(f.c.store.one('SELECT data FROM effect_operations WHERE id=?',original.operationId).data),grants=f.c.store.all('SELECT * FROM effect_delegations');
 let current=f.summary;if(!closing){f.merged.add(2);await f.c.refreshContributions({resourceIds:[f.other.resourceId]});current=f.c.prepareContributionSummary({resourceId:f.parent.resourceId});}
 let held;if(closing){held=f.holdPreflight();void held.entered.then(()=>writeFileSync(marker,'entered'));}const frozen=f.c.store.one('SELECT * FROM summary_revisions WHERE id=?',f.summary.revisionId),members=f.c.store.all('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid',f.summary.revisionId);await f.c.close();
 const requests=[];const proxy=https.createServer(tls.tls,(req,res)=>{
  requests.push({method:req.method,path:req.url});if(!(req.method==='GET'||req.method==='POST'&&req.url==='/repos/owner/repo/issues/8/comments')){res.writeHead(405);res.end();return;}
  const request=http.request(new URL(req.url,f.origin),{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});res.once('close',()=>request.destroy());request.once('error',()=>{if(!res.destroyed){res.writeHead(502);res.end();}});req.pipe(request);
 });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(async()=>{held?.release();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));});
 const unchanged=[{sql:'SELECT id,work,phase FROM effect_operations',rows:[[original.operationId,original.workId,'REFUSED']]},{sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[1,0]]}];
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Retained publications\r'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · '+original.operationId,send:'Resume original owner summary preparation\r'},
  {wait:'Review original summary preparation recovery',queries:unchanged,send:'\x1b'},
  {wait:'Explicit original preparation recovery',send:'Prepare current summary on this original\r'},
  {wait:'Private repository credential JSON file',send:f.credential+'\r'},
  ...closing?[{wait:'',waitFiles:[{path:marker,value:'entered'}],terminate:true,send:''}]:[
   {wait:'Original summary preparation recovery retained',queries:[{sql:'SELECT id,work,phase FROM effect_operations',rows:[[original.operationId,original.workId,'RESERVED']]},{sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[2,0]]}],send:'\x1b'},
   {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
   {wait:'Original publication · '+original.operationId,send:'Review and send original prepared publication\r'},
   {wait:'Review exact original publication',send:'\x1b'},
   {wait:'Confirm exact original publication write',send:'Send this original prepared publication\r'},
   {wait:'Private repository credential JSON file',send:f.credential+'\r'},
   {wait:'Original publication send outcome retained',queries:[{sql:'SELECT phase FROM effect_operations',rows:[['CONFIRMED']]}],send:'\x1b'},
   {wait:'Retained publications · recorded facts',send:'Back\r'},
   {wait:'Repository management · owner actions',send:'Close\r'},
   {wait:'INPUT',send:'/quit\x1b\r'},
  ],
 ];
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_PUBLICATION_PORT:String(proxy.address().port)};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/publication-send-network-only.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(requests.filter(r=>r.method==='POST').length,closing?0:1);assert.equal(f.posts.length,closing?0:1);if(!closing)assert.ok(f.posts[0].body.startsWith(current.body));assert.doesNotMatch(await fs.readFile(file+'.terminal','utf8'),/fixture-original/);
  const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{
   const row=db.prepare('SELECT id,work,phase,data FROM effect_operations').get();assert.equal(row.phase,closing?'REFUSED':'CONFIRMED');assert.equal(row.id,original.operationId);assert.equal(row.work,original.workId);assert.deepEqual(db.prepare('SELECT * FROM effect_delegations ORDER BY rowid').all(),grants);const revision=JSON.parse(db.prepare("SELECT data FROM effect_receipts WHERE operation=? AND kind='payload-revision'").get(original.operationId).data);assert.equal(revision.payloadBase64,old.payloadBase64);assert.deepEqual(revision.catalogueProof,old.contributionSnapshot);const data=JSON.parse(row.data);assert.equal(data.contributionSnapshot.revisionId,current.revisionId);assert.equal(data.action.body,current.body);assert.equal(data.ownerAuthorization.payloadHash,data.payloadHash);assert.equal(db.prepare('SELECT COUNT(*) n FROM effect_operations').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,1);
   assert.deepEqual(db.prepare('SELECT * FROM summary_revisions WHERE id=?').get(f.summary.revisionId),frozen);assert.deepEqual(db.prepare('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid').all(f.summary.revisionId),members);
   const budget=db.prepare("SELECT consumed,reserved,lim FROM budgets WHERE lineage=? AND kind='execution'").get(row.work);assert.equal(budget.consumed,closing?2:3);assert.equal(budget.reserved,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE phase='RUNNING'").get().n,0);
  }finally{db.close();}f.pass();
 }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}finally{held?.release();}
});
