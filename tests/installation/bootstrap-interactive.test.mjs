// Exact source bootstrap, real Bash/PTY, owned tool replacements; no host provisioning/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
async function fixture(t,{oldNode=false,missingBrew=false,badChecksum=false,officialFailure=false,curlFailOnce=false,officialFailOnce=false,nodeInstallFailOnce=false,docker=true}={}) {
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/bootstrap-'))),tools=path.join(root,'tools'),prefix=path.join(root,'node24');
    for(const dir of [tools,path.join(prefix,'bin')])await fs.mkdir(dir,{recursive:true});
    const script=path.join(root,'install.sh'),calls=path.join(root,'calls'),installed=path.join(root,'installed');
    await fs.copyFile('install.sh',script);
    await fs.writeFile(path.join(root,'install.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(installed)},JSON.stringify({args:process.argv.slice(2),home:process.env.HOME}));console.log('OWNED_INSTALLER_FINISHED');`);
    const shell=async(file,body)=>fs.writeFile(file,'#!/bin/bash\nset -eu\n'+body,{mode:0o700});
    const nodeBody=(old)=>`if [ "\${1-}" = -e ]; then exit ${old?1:0}; fi\necho "NODE_ROUTE:$0"\nexec ${JSON.stringify(process.execPath)} "$@"\n`;
    await shell(path.join(tools,'node'),nodeBody(oldNode));await shell(path.join(prefix,'bin/node'),nodeBody(false));
    for(const dir of [tools,path.join(prefix,'bin')])await shell(path.join(dir,'npm'),'exit 0\n');
    const brew=path.join(root,'available-brew');
    await shell(brew,`echo "BREW:$*" >> ${JSON.stringify(calls)}\n${nodeInstallFailOnce?'if [ "$1" = install ] && [ ! -f '+JSON.stringify(path.join(root,'node-once'))+' ]; then touch '+JSON.stringify(path.join(root,'node-once'))+'; exit 1; fi\n':''}if [ "$1" = --prefix ]; then echo ${JSON.stringify(prefix)}; fi\n`);
    if(!missingBrew)await fs.copyFile(brew,path.join(tools,'brew'));
    if(docker)await shell(path.join(tools,'docker'),'exit 0\n');
    const official=path.join(root,'owned-official.sh');
    await shell(official,`echo OWNED_OFFICIAL_INSTALLER\necho OFFICIAL >> ${JSON.stringify(calls)}\n/bin/cp ${JSON.stringify(brew)} ${JSON.stringify(path.join(tools,'brew'))}\n${officialFailure?'exit 9\n':''}${officialFailOnce?'if [ ! -f '+JSON.stringify(path.join(root,'official-once'))+' ]; then touch '+JSON.stringify(path.join(root,'official-once'))+'; exit 9; fi\n':''}`);
    await shell(path.join(tools,'curl'),`echo "CURL:$*" >> ${JSON.stringify(calls)}\n${curlFailOnce?'if [ ! -f '+JSON.stringify(path.join(root,'curl-once'))+' ]; then touch '+JSON.stringify(path.join(root,'curl-once'))+'; exit 22; fi\n':''}output=''\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then output=$2; shift 2; else shift; fi; done\n[ -n "$output" ]\n/bin/cp ${JSON.stringify(official)} "$output"\n`);
    await shell(path.join(tools,'shasum'),`echo SHA >> ${JSON.stringify(calls)}\nprintf '%s  %s\\n' '${badChecksum?'0'.repeat(64):'5f333bbe53bc490e51e7ccb1df8779b3dd6ee73a1a7379efda216edb08ccb148'}' "$3"\n`);
    // Hide only conventional system brew probes; the exact bootstrap still owns all decisions.
    const harness=path.join(root,'harness.sh');await shell(harness,`
function [() { if [[ "\${1-}" = -x && "\${2-}" =~ ^(/opt/homebrew|/usr/local|/home/linuxbrew/.linuxbrew)/bin/brew$ ]]; then return 1; fi; builtin [ "$@"; }
export -f '['
exec /bin/bash ${JSON.stringify(script)} "$@"
`);
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained bootstrap '+root);});
    const env={...process.env,PATH:tools+':/usr/bin:/bin',HOME:root,NODE_OPTIONS:'',NODE_PATH:''};
    return {root,script,harness,tools,prefix,calls,installed,env,pass(){passed=true;}};
}
async function terminal(f,label,steps,args=[]) {
    const file=path.join(f.root,label+'.json');await fs.writeFile(file,JSON.stringify({command:['/bin/bash',f.harness,...args],env:f.env,steps,timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:2}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:11000,maxBuffer:2**20})).stdout);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    return {...result,output:await fs.readFile(file+'.output','utf8')};
}
test('compatible Node and existing Docker bypass Homebrew and forward installer options noninteractively',async t=>{
    const f=await fixture(t,{missingBrew:true});await execute('/bin/bash',[f.harness,'--prefix',path.join(f.root,'prefix with spaces')],{env:f.env,timeout:5000});
    assert.deepEqual(JSON.parse(await fs.readFile(f.installed)).args,['--prefix',path.join(f.root,'prefix with spaces')]);await assert.rejects(fs.access(f.calls));f.pass();
});
test('incompatible Node in noninteractive bootstrap refuses before any host or app action',async t=>{
    const f=await fixture(t,{oldNode:true,missingBrew:true});await assert.rejects(execute('/bin/bash',[f.harness],{env:f.env,timeout:5000}),e=>/No application installation started/.test(e.stderr));
    await assert.rejects(fs.access(f.calls));await assert.rejects(fs.access(f.installed));f.pass();
});
test('existing Homebrew prepares exact keg-only Node then continues the same installer',async t=>{
    const f=await fixture(t,{oldNode:true});const result=await terminal(f,'node',[{wait:'Prepare Node/npm with',send:'\r'}]);
    assert.equal(result.exitCode,0);assert.ok(result.output.includes('NODE_ROUTE:'+path.join(f.prefix,'bin/node')));assert.match(result.output,/Future terminals still need/);
    assert.equal(await fs.readFile(f.calls,'utf8'),'BREW:install node@24\nBREW:--prefix node@24\n');await fs.access(f.installed);f.pass();
});
for(const badChecksum of [false,true])test('optional missing Homebrew '+(badChecksum?'refuses a corrupt download before execution':'runs reviewed verified terminal bootstrap and continues'),async t=>{
    const f=await fixture(t,{missingBrew:true,badChecksum,docker:false});const result=await terminal(f,'brew',[
        {wait:'Prepare Homebrew for optional Colima',send:'\r'},{wait:'Download, verify and run',send:'\r'},
        ...badChecksum?[{wait:'Retry this prerequisite step',send:'\r'}]:[],
    ]);
    const calls=await fs.readFile(f.calls,'utf8');assert.match(calls,/https:\/\/raw.githubusercontent.com\/Homebrew\/install\/85d1a3fc80d8a63932f632aca8f787de11d14a64\/install.sh/);assert.match(calls,/SHA/);
    assert.equal(result.exitCode,badChecksum?1:0);
    if(badChecksum){assert.doesNotMatch(calls,/OFFICIAL/);await assert.rejects(fs.access(f.installed));assert.match(result.output,/checksum mismatch/);}
    else {assert.match(calls,/OFFICIAL/);assert.match(result.output,/OWNED_OFFICIAL_INSTALLER/);await fs.access(f.installed);}
    f.pass();
});

test('official bootstrap failure cannot fall through through a partially installed brew command',async t=>{
    const f=await fixture(t,{missingBrew:true,docker:false,officialFailure:true});const result=await terminal(f,'partial',[
        {wait:'Prepare Homebrew for optional Colima',send:'\r'},{wait:'Download, verify and run',send:'\r'},{wait:'Retry this prerequisite step',send:'\r'},
    ]);
    assert.equal(result.exitCode,1);assert.match(result.output,/Homebrew installation did not complete/);assert.doesNotMatch(result.output,/installation finished/);
    await fs.access(path.join(f.tools,'brew'));await assert.rejects(fs.access(f.installed));f.pass();
});
for(const args of [['--prefix','/one','--prefix','/two'],['--setup-runtime','--setup-runtime']])test('duplicate bootstrap option refuses before any prerequisite action: '+args[0],async t=>{
    const f=await fixture(t,{oldNode:true,missingBrew:true});await assert.rejects(execute('/bin/bash',[f.harness,...args],{env:f.env,timeout:5000}),e=>/Duplicate/.test(e.stderr));
    await assert.rejects(fs.access(f.calls));await assert.rejects(fs.access(f.installed));f.pass();
});

for(const failure of ['curlFailOnce','officialFailOnce'])test('bootstrap contextual retry uses a fresh verified download after '+failure,async t=>{
 const f=await fixture(t,{missingBrew:true,docker:false,[failure]:true});const result=await terminal(f,'retry-'+failure,[
  {wait:'Prepare Homebrew for optional Colima',send:'\r'},{wait:'Download, verify and run',send:'\r'},
  {wait:'Retry this prerequisite step',send:'y\r'},{wait:'Download, verify and run',send:'\r'},
 ]);
 assert.equal(result.exitCode,0);const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n');const downloads=calls.filter(c=>c.startsWith('CURL:'));
 assert.equal(downloads.length,2);assert.notEqual(downloads[0].match(/--output (\S+)/)[1],downloads[1].match(/--output (\S+)/)[1]);
 assert.equal(calls.filter(c=>c==='SHA').length,failure==='curlFailOnce'?1:2);assert.equal(calls.filter(c=>c==='OFFICIAL').length,failure==='curlFailOnce'?1:2);await fs.access(f.installed);f.pass();
});

test('Node formula failure offers same-step retry without replaying a Homebrew bootstrap',async t=>{
 const f=await fixture(t,{oldNode:true,nodeInstallFailOnce:true});const result=await terminal(f,'retry-node',[{wait:'Prepare Node/npm with',send:'\r'},{wait:'Retry this prerequisite step',send:'y\r'}]);
 assert.equal(result.exitCode,0);assert.equal(await fs.readFile(f.calls,'utf8'),'BREW:install node@24\nBREW:install node@24\nBREW:--prefix node@24\n');await fs.access(f.installed);f.pass();
});
