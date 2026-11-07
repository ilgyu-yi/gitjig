import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {fixture,resource,repository} from '../contributions/fixture.mjs';
import {contributionServer} from '../contributions/native-server.mjs';
import {repositoryTlsFixture} from '../platform/repository-tls-fixture.mjs';
const execute=promisify(execFile);
for(const closing of [false,true])test('actual GitHub summary-parent terminal '+(closing?'aborts and joins accepted read on host close':'links, summarizes and unlinks without raw IDs'),{timeout:20000},async t=>{
    const tls=await repositoryTlsFixture(t),f=await fixture(),native=await contributionServer({tls:tls.tls});let passed=false,release;
    t.after(async()=>{release?.();await native.close();await f.close({preserve:!passed});});
    f.merged.add(1);native.merged.add(1);const child=await f.c.trackRepositoryResource(resource(1)),parent=await f.c.trackRepositoryResource({repository,kind:'issue',number:8});
    const home=f.c.applicationHome(),dbfile=path.join(home,'state/controller.sqlite'),credential=path.join(f.root,'credential'),marker=path.join(f.root,'entered');await fs.writeFile(credential,'{"token":"fixture-only"}',{mode:0o600});await f.c.close();
    if(closing){native.setWait(new Promise(resolve=>release=resolve));native.onReview(()=>writeFileSync(marker,'entered'));}
    const empty=['works','runs','budgets','conversation_inputs','effect_operations'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const steps=[
        {wait:'Model: not selected',send:'/repo\x1b\r'},
        {wait:'Repository management · owner actions',send:'Tracked issues and pull requests\r'},
        {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #1\r'},
        {wait:'Retained pull-request #1',send:'Edit summary parent\r'},
        {wait:'Summary parent · current none · revision 0',send:'issue #8\r'},
        {wait:'Review summary routing · no change yet',queries:[...empty,{sql:'SELECT COUNT(*) FROM resource_links',rows:[[0]]}],send:'\x1b'},
        {wait:'Explicit summary routing action',send:'Save summary routing\r'},
        {wait:'Private repository credential JSON file',send:credential+'\r'},
        ...closing?[{wait:'Repository request in progress',waitFiles:[{path:marker,value:'entered'}],terminate:true,send:''}]:[
            {wait:'Summary routing retained · no automatic summary',queries:[...empty,{sql:'SELECT parent,revision FROM resource_links WHERE child=?',params:[child.resourceId],rows:[[parent.resourceId,1]]}],send:'\x1b'},
            {wait:'Tracked issues and pull requests · retained GitHub',send:'issue #8\r'},
            {wait:'Retained issue #8',send:'Prepare local summary revision\r'},
            {wait:'Local summary revision retained · not published',queries:[{sql:'SELECT COUNT(*) FROM summary_members',rows:[[4]]}],send:'\x1b'},
            {wait:'Retained issue #8',send:'Back\r'},
            {wait:'Tracked issues and pull requests · retained GitHub',send:'pull-request #1\r'},
            {wait:'Retained pull-request #1',send:'Edit summary parent\r'},
            {wait:'Summary parent · current issue #8',send:'Remove current summary parent\r'},
            {wait:'Review summary routing · no change yet',send:'\x1b'},
            {wait:'Explicit summary routing action',send:'Save summary routing\r'},
            {wait:'Private repository credential JSON file',send:credential+'\r'},
            {wait:'Summary routing retained · no automatic summary',queries:[...empty,{sql:'SELECT parent,revision FROM resource_links WHERE child=?',params:[child.resourceId],rows:[[null,2]]}],send:'\x1b'},
            {wait:'Tracked issues and pull requests · retained GitHub',send:'issue #8\r'},
            {wait:'Retained issue #8',send:'Prepare local summary revision\r'},
            {wait:'Local summary revision retained · not published',queries:[{sql:'SELECT COUNT(*) FROM summary_revisions',rows:[[2]]},{sql:'SELECT COUNT(*) FROM summary_members',rows:[[4]]}],send:'\x1b'},
            {wait:'Retained issue #8',send:'Back\r'},
            {wait:'Tracked issues and pull requests · retained GitHub',send:'Back\r'},
            {wait:'Repository management · owner actions',send:'Close\r'},
            {wait:'INPUT',send:'/quit\x1b\r'},
        ],
    ];
    const file=path.join(f.root,'parent-pty.json'),env={PATH:path.dirname(process.execPath),HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',NODE_EXTRA_CA_CERTS:tls.cert,GITJIG_CONTRIBUTION_PORT:new URL(native.origin).port};
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/contribution-network-only.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:10,expectedInputs:0,database:dbfile,output:file+'.terminal',gracefulShutdownSeconds:3}));
    try{
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:16000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
        assert.ok(native.requests.length>0&&native.requests.every(row=>row.method==='GET'&&row.authorization==='Bearer fixture-only'));assert.doesNotMatch(await fs.readFile(file+'.terminal','utf8'),/fixture-only/);
        const db=new DatabaseSync(dbfile,{readOnly:true});try{if(closing){assert.equal(db.prepare('SELECT COUNT(*) n FROM resource_links').get().n,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM sources WHERE json_extract(origin,'$.kind')='owner-resource-parent'").get().n,0);}else{assert.equal(db.prepare('SELECT revision FROM resource_links WHERE child=?').get(child.resourceId).revision,2);const rows=db.prepare("SELECT json_extract(data,'$.contributionCount') AS count FROM summary_revisions ORDER BY rowid").all();assert.deepEqual(rows.map(row=>row.count),[1,0]);}}finally{db.close();}passed=true;
    }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-10000));throw error;}
    finally{release?.();native.setWait(null);native.onReview(null);}
});
