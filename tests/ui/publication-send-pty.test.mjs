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
import {preparedPublicationFixture} from './publication-send-fixture.mjs';
const execute=promisify(execFile);
for(const closing of [false,true])test('actual prepared publication send terminal '+(closing?'joins after accepted POST without replay':'reviews exact carrier then sends original once'),{timeout:16000},async t=>{
 const tls=await repositoryTlsFixture(t),f=await preparedPublicationFixture(t,'x'.repeat(90000)+' LATE_OWNER_SUFFIX \u0085'),home=f.c.applicationHome(),file=path.join(f.root,'send-ui.json'),marker=path.join(f.root,'post-entered');
 const before=f.c.inspectPublicationDispatch(f.op.operationId),grants=f.c.store.all('SELECT * FROM effect_delegations'),raw=f.c.store.one('SELECT data FROM effect_operations WHERE id=?',f.op.operationId).data;
 let held;if(closing){held=f.holdDrop();f.onPost(()=>writeFileSync(marker,'entered'));}await f.c.close();
 const requests=[];const proxy=https.createServer(tls.tls,(req,res)=>{
  requests.push({method:req.method,path:req.url});if(!(req.method==='GET'||req.method==='POST'&&req.url==='/repos/owner/repo/issues/8/comments')){res.writeHead(405);res.end();return;}
  const request=http.request(new URL(req.url,f.origin),{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  res.once('close',()=>request.destroy());request.once('error',()=>{if(!res.destroyed){res.writeHead(502);res.end();}});req.pipe(request);
 });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(async()=>{held?.release();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));});
 const fixed=[{sql:'SELECT COUNT(*) FROM effect_operations',rows:[[1]]},{sql:'SELECT COUNT(*) FROM works',rows:[[1]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]}];
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Retained publications\r'},
  {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
  {wait:'Original publication · '+f.op.operationId,send:'Review and send original prepared publication\r'},
  {wait:'Review exact original publication · page 1 of 3',queries:fixed,send:'\x1b'},
  {wait:'Review exact original publication · page 2 of 3',send:'\x1b'},
  {wait:'Review exact original publication · page 3 of 3',send:'\x1b[6~'.repeat(40)},
  {wait:'LATE_OWNER_SUFFIX',send:'\x1b'},
  {wait:'Confirm exact original publication write',send:'Back without sending\r'},
  {wait:'Retained publications · recorded facts',queries:fixed,send:'owner/repo\r'},
  {wait:'Original publication · '+f.op.operationId,send:'Review and send original prepared publication\r'},
  {wait:'Review exact original publication · page 1 of 3',send:'\x1b'},
  {wait:'Review exact original publication · page 2 of 3',send:'\x1b'},
  {wait:'Review exact original publication · page 3 of 3',send:'\x1b[6~'.repeat(40)},
  {wait:'LATE_OWNER_SUFFIX',send:'\x1b'},
  {wait:'Confirm exact original publication write',send:'Send this original prepared publication\r'},
  {wait:'Private repository credential JSON file',send:f.credential+'\r'},
  ...closing?[{wait:'Repository request in progress',waitFiles:[{path:marker,value:'entered'}],terminate:true,send:''}]:[
   {wait:'Original publication send outcome retained',send:'\x1b'},
   {wait:'Retained publications · recorded facts',send:'Back\r'},
   {wait:'Repository management · owner actions',send:'Close\r'},
   {wait:'INPUT',send:'/quit\x1b\r'},
  ],
 ];
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_PUBLICATION_PORT:String(proxy.address().port)};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/publication-send-network-only.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:7,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.equal(f.posts.length,1);assert.equal(f.posts[0].body,JSON.parse(before.payloadUtf8).body);const terminal=await fs.readFile(file+'.terminal','utf8');assert.doesNotMatch(terminal,/fixture-original/);assert.match(terminal,/LATE_OWNER_SUFFIX/);assert.match(terminal,/gitjig-operation:/);assert.match(terminal,/\\u0085/);
  const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{
   const row=db.prepare('SELECT phase,data FROM effect_operations WHERE id=?').get(f.op.operationId);assert.equal(row.phase,closing?'UNKNOWN':'CONFIRMED');assert.equal(JSON.parse(row.data).payloadHash,JSON.parse(raw).payloadHash);assert.equal(JSON.parse(row.data).payloadBase64,JSON.parse(raw).payloadBase64);
   const budget=db.prepare("SELECT consumed,reserved,lim FROM budgets WHERE lineage=? AND kind='execution'").get(before.context.lineage);assert.equal(budget.consumed,before.context.execution.consumed+1);assert.equal(budget.reserved,0);assert.equal(budget.lim,before.context.execution.limit);assert.deepEqual(db.prepare('SELECT * FROM effect_delegations ORDER BY rowid').all(),grants);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE phase='RUNNING'").get().n,0);
  }finally{db.close();}f.pass();
 }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}finally{held?.release();}
});
