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
import {reconciliationFixture} from './publication-reconcile-fixture.mjs';
const execute=promisify(execFile);
for(const closing of [false,true])test('actual original-publication reconciliation terminal '+(closing?'joins read cancellation on host close':'confirms by native reads without resend'),{timeout:16000},async t=>{
    const tls=await repositoryTlsFixture(t),f=await reconciliationFixture(t),home=f.c.applicationHome(),file=path.join(f.root,'reconcile-ui.json'),marker=path.join(f.root,'read-entered');
    const context=f.c.inspectPublicationReconciliation(f.op.operationId),grants=f.c.store.all('SELECT * FROM effect_delegations'),payload=f.c.store.one('SELECT data FROM effect_operations WHERE id=?',f.op.operationId).data;
    let held;if(closing){held=f.holdRead();f.onRead(()=>writeFileSync(marker,'entered'));}await f.c.close();
    // Owned TLS front for the same synthetic service that accepted the original HTTP fixture POST.
    const requests=[];const proxy=https.createServer(tls.tls,(req,res)=>{
        requests.push({method:req.method,path:req.url});if(req.method!=='GET'){res.writeHead(405);res.end();return;}
        const request=http.request(new URL(req.url,f.origin),{method:'GET',headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
        res.once('close',()=>request.destroy());request.once('error',()=>{if(!res.destroyed){res.writeHead(502);res.end();}});request.end();
    });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(async()=>{held?.release();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));});
    const fixed=[{sql:'SELECT COUNT(*) FROM effect_operations',rows:[[1]]},{sql:'SELECT COUNT(*) FROM works',rows:[[1]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]},{sql:'SELECT * FROM effect_delegations ORDER BY rowid',rows:grants.map(row=>Object.values(row))}];
    const steps=[
        {wait:'Model: not selected',send:'/repo\x1b\r'},
        {wait:'Repository management · owner actions',send:'Retained publications\r'},
        {wait:'Retained publications · recorded facts',send:'owner/repo\r'},
        {wait:'Original publication · '+f.op.operationId,send:'Reconcile original publication\r'},
        {wait:'Review original read-only reconciliation',queries:fixed,send:'\x1b'},
        {wait:'Explicit original-publication action',send:'Reconcile original with read requests\r'},
        {wait:'Private repository credential JSON file',send:f.credential+'\r'},
        ...closing?[{wait:'Repository request in progress',waitFiles:[{path:marker,value:'entered'}],terminate:true,send:''}]:[
            {wait:'Original publication reconciliation retained',queries:[...fixed,{sql:'SELECT phase FROM effect_operations WHERE id=?',params:[f.op.operationId],rows:[['CONFIRMED']]}],send:'\x1b'},
            {wait:'Retained publications · recorded facts',send:'Back\r'},
            {wait:'Repository management · owner actions',send:'Close\r'},
            {wait:'INPUT',send:'/quit\x1b\r'},
        ],
    ];
    const env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_CONTRIBUTION_PORT:String(proxy.address().port)};
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/contribution-network-only.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:7,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
    try{
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.ok(requests.length>0&&requests.every(row=>row.method==='GET'));assert.equal(f.posts.length,1);assert.doesNotMatch(await fs.readFile(file+'.terminal','utf8'),/fixture-original/);
        const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{
            const row=db.prepare('SELECT phase,data FROM effect_operations WHERE id=?').get(f.op.operationId);assert.equal(row.phase,closing?'UNKNOWN':'CONFIRMED');assert.equal(JSON.parse(row.data).payloadHash,JSON.parse(payload).payloadHash);assert.equal(JSON.parse(row.data).payloadBase64,JSON.parse(payload).payloadBase64);
            const budget=db.prepare("SELECT consumed,reserved,lim FROM budgets WHERE lineage=? AND kind='execution'").get(context.lineage);assert.equal(budget.consumed,context.execution.consumed+1);assert.equal(budget.reserved,0);assert.equal(budget.lim,context.execution.limit);assert.deepEqual(db.prepare('SELECT * FROM effect_delegations ORDER BY rowid').all(),grants);assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE phase='RUNNING'").get().n,0);
        }finally{db.close();}f.pass();
    }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}
    finally{held?.release();}
});
