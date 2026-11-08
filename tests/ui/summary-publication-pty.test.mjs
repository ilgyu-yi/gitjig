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
for(const closing of [false,true])test('actual retained host-summary terminal '+(closing?'joins preparation on close without POST':'registers target, prepares then separately sends original'),{timeout:18000},async t=>{
 const tls=await repositoryTlsFixture(t),f=await summaryPublicationFixture(t,{withTarget:closing}),home=f.c.applicationHome(),file=path.join(f.root,'summary-publication-ui.json'),marker=path.join(f.root,'preflight-entered');
 let held;if(closing){held=f.holdPreflight();void held.entered.then(()=>writeFileSync(marker,'entered'));}const frozen=f.c.store.one('SELECT * FROM summary_revisions WHERE id=?',f.summary.revisionId),members=f.c.store.all('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid',f.summary.revisionId);await f.c.close();
 const requests=[];const proxy=https.createServer(tls.tls,(req,res)=>{
  requests.push({method:req.method,path:req.url});if(!(req.method==='GET'||req.method==='POST'&&req.url==='/repos/owner/repo/issues/8/comments')){res.writeHead(405);res.end();return;}
  const request=http.request(new URL(req.url,f.origin),{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});res.once('close',()=>request.destroy());request.once('error',()=>{if(!res.destroyed){res.writeHead(502);res.end();}});req.pipe(request);
 });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(async()=>{held?.release();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));});
 const empty=['works','runs','effect_operations','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
 const recorded=(phase,consumed)=>[
  {sql:'SELECT phase FROM effect_operations',rows:[[phase]]},
  {sql:"SELECT consumed,reserved FROM budgets WHERE kind='execution'",rows:[[consumed,0]]},
 ];
 const sendAction='Review and send original prepared publication';
 const prepared={wait:'Original publication · ',queries:recorded('RESERVED',1),send:sendAction+'\r'};
 const confirmed={wait:'Original publication · ',queries:recorded('CONFIRMED',2),send:'Inspect original publication facts\r'};
 const afterDetails={wait:'Original publication · ',queries:recorded('CONFIRMED',2),send:'Back without action\r'};
 const chooseTarget=closing?[
   {wait:'Publication target · same native repository',send:'owner/repo\r'},
  ]:[
   {wait:'Publication target · same native repository',send:'Register default-policy\r'},
   {wait:'Select registered GitHub identity',send:'owner/repo\r'},
  ];
 const steps=[
  {wait:'Model: not selected',send:'/repo\x1b\r'},
  {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
  {wait:'Tracked issues and pull requests · retained GitHub',send:'issue #8\r'},
  {wait:'Retained issue #8',send:'Prepare publication from current local summary\r'},
  ...chooseTarget,
  {wait:'Continue to confirmation',queries:empty,send:'\x1b'},
  {wait:'Retained issue #8',send:'Prepare publication from current local summary\r'},
  ...chooseTarget,
  {wait:'Review host summary publication preparation',queries:empty,send:'\r'},
  {wait:'Explicit summary publication preparation',send:'Prepare this exact summary publication\r'},
  {wait:'Private repository credential JSON file',send:f.credential+'\r'},
  ...closing?[{wait:'Working · Preparing the summary publication',waitFiles:[{path:marker,value:'entered'}],terminate:true,send:''}]:[
   {wait:'Summary publication preparation retained',queries:recorded('RESERVED',1),send:'Review this original publication\r'},
   prepared,{wait:'Continue to confirmation',queries:recorded('RESERVED',1),send:'\x1b'},
   prepared,
   {wait:'Continue to confirmation',send:'\r'},
   {wait:'Confirm exact original publication write',send:'Send this original prepared publication\r'},
   {wait:'Private repository credential JSON file',send:f.credential+'\r'},
   {wait:'Original publication send outcome retained',queries:recorded('CONFIRMED',2),send:'\x1b'},
   confirmed,
   {wait:'Original publication · phase, transport',send:'\x1b'},
   afterDetails,
   {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
   {wait:'Repository management · owner actions',send:'Close\r'},
   {wait:'INPUT',send:'/quit\x1b\r'},
  ],
 ];
 const entry=process.env.GITJIG_TEST_CLI_ENTRY,guard=process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[],output=file+'.terminal';
 const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_PUBLICATION_PORT:String(proxy.address().port),...entry?{GITJIG_TEST_CLI_ENTRY:path.resolve(entry)}:{}};
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,...guard,'--import','./tests/ui/publication-send-network-only.mjs',entry??'dist/cli/entry.js'],env,steps,timeoutSeconds:10,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output,gracefulShutdownSeconds:3}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.equal(requests.filter(r=>r.method==='POST').length,closing?0:1);assert.equal(f.posts.length,closing?0:1);if(!closing)assert.ok(f.posts[0].body.startsWith(f.summary.body));const bytes=await fs.readFile(output);assert.doesNotMatch(bytes.toString('utf8'),/fixture-original/);
  const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{
   const row=db.prepare('SELECT id,work,phase,data FROM effect_operations').get();assert.equal(row.phase,closing?'REFUSED':'CONFIRMED');const data=JSON.parse(row.data);assert.equal(data.contributionSnapshot.revisionId,f.summary.revisionId);assert.equal(data.action.body,f.summary.body);assert.equal(data.ownerAuthorization.payloadHash,data.payloadHash);assert.equal(db.prepare('SELECT COUNT(*) n FROM effect_operations').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n,1);
   if(!closing){
    const {actionOutputOffsets:offsets}=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
    for(const marker of [prepared,confirmed,afterDetails]){
     const index=steps.indexOf(marker),picker=bytes.subarray(offsets[index-1],offsets[index]).toString('utf8');
     assert.ok(picker.includes('Original publication · '+row.id),'Pinned picker must show the exact original publication');
     assert.ok(picker.includes('Recorded phase · '+(marker===prepared?'RESERVED':'CONFIRMED')));
     assert.equal(picker.includes(sendAction),marker===prepared);
    }
   }
   assert.deepEqual(db.prepare('SELECT * FROM summary_revisions WHERE id=?').get(f.summary.revisionId),frozen);assert.deepEqual(db.prepare('SELECT * FROM summary_members WHERE revision=? ORDER BY rowid').all(f.summary.revisionId),members);
   const budget=db.prepare("SELECT consumed,reserved,lim FROM budgets WHERE lineage=? AND kind='execution'").get(row.work);assert.equal(budget.consumed,closing?1:2);assert.equal(budget.reserved,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE phase='RUNNING'").get().n,0);
  }finally{db.close();}f.pass();
 }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}finally{held?.release();}
});
