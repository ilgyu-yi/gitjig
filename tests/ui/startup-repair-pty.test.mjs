import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

test('actual terminal cancels JSON editing, rejects duplicate keys, saves next-launch metadata and clears without execution',{timeout:20000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-startup-json-ui-'))),home=path.join(root,'app');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained startup JSON terminal: '+root);});
    const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',SHELL:'/bin/sh',NODE_OPTIONS:'',NODE_PATH:''};
    const empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const run=async(label,steps)=>{
        const file=path.join(root,label+'.json');
        await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs','dist/cli/entry.js'],env,steps,timeoutSeconds:6,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
        try {const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);}
        catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-7000));throw error;}
    };
    const runtime={dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',image:'sha256:'+'0'.repeat(64)};
    await run('save',[
        {wait:'Model: not selected',send:'/setup save\x1b\r'},
        {wait:'Future startup · version1 JSON',send:'\x1b'},
        {wait:'INPUT',assertDraft:'/setup save',send:'\x15/setup save {"version":1,"version":1}\x1b\r'},
        {wait:'Enter valid unambiguous startup JSON',queries:empty,send:'\x15/setup save '+JSON.stringify({version:1,runtime})+'\x1b\r'},
        {wait:'Future startup saved',queries:empty,send:'/quit\x1b\r'},
    ]);
    const file=path.join(home,'config/startup.json');assert.deepEqual(JSON.parse(await fs.readFile(file)),{version:1,runtime});
    await run('clear',[
        {wait:'Model: not selected',send:'/setup inspect\x1b\r'},
        {wait:'Sources · {"runtime":"saved","bridge":"none"}',queries:empty,send:'\x1b'},
        {wait:'INPUT',send:'/setup clear\x1b\r'},
        {wait:'Future startup cleared',queries:empty,send:'/quit\x1b\r'},
    ]);
    assert.deepEqual(JSON.parse(await fs.readFile(file)),{version:1});passed=true;
});
