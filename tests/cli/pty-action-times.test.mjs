import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

test('actual PTY records monotonic action times across a controlled delay without changing input or cleanup',{timeout:10000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-pty-action-time-'))),worker=path.join(root,'worker.py'),file=path.join(root,'pty.json'),output=path.join(root,'terminal');
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original PTY timing '+root);});
    await fs.writeFile(worker,"import sys,time,termios,tty\noriginal=termios.tcgetattr(0)\ntty.setraw(0)\nprint('ready',flush=True)\nassert sys.stdin.readline()=='one\\n'\ntime.sleep(.05)\nprint('second',flush=True)\nassert sys.stdin.readline()=='two\\n'\ntermios.tcsetattr(0,termios.TCSANOW,original)\nprint('done',flush=True)\n");
    const steps=[{wait:'ready',send:'one\n'},{wait:'second',send:'two\n'},{wait:'done',send:''}];
    await fs.writeFile(file,JSON.stringify({command:['/usr/bin/python3',worker],env:{PATH:'/usr/bin:/bin',TERM:'xterm-256color'},steps,output,timeoutSeconds:3,noForceKill:true,gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:8000,killSignal:'SIGINT'})).stdout),progress=JSON.parse(await fs.readFile(output+'.progress.json','utf8'));
    assert.equal(result.exitCode,0);assert.equal(result.stages,3);assert.equal(result.terminalRestored,true);assert.equal(progress.forceKilled,false);assert.equal(progress.outputTruncated,false);
    assert.equal(progress.actionElapsedSeconds.length,3);assert.ok(progress.actionElapsedSeconds[0]>=0);assert.ok(progress.actionElapsedSeconds[1]-progress.actionElapsedSeconds[0]>=.025);assert.ok(progress.actionElapsedSeconds[2]>=progress.actionElapsedSeconds[1]);passed=true;
});
