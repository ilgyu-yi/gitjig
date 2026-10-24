// Execute the real installer with an inert owned npm implementation, never a personal install.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
async function fixture(t,{denyStop=false,blockedDefault=false,appStatus=0,helperFailure='none',failPhase,mutateSource=false,tamperArchive=false,prefixName='prefix'}={}) {
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/installer-interactive-'))),source=path.join(root,'source'),prefix=path.join(root,prefixName),calls=path.join(root,'calls'),held=path.join(root,'held');
    await fs.mkdir(source);for(const folder of ['src','runtime','qualification','tools'])await fs.mkdir(path.join(source,folder));
    const defaultPrefix=path.join(root,'default-prefix');
    if(blockedDefault){await fs.mkdir(path.join(defaultPrefix,'lib/node_modules'),{recursive:true});await fs.chmod(path.join(defaultPrefix,'lib/node_modules'),0o555);}
    const installer=path.join(source,'install.mjs');await fs.copyFile('install.mjs',installer);await fs.copyFile('install.sh',path.join(source,'install.sh'));
    const pkg={name:'gitjig',version:'0.0.0',type:'module',engines:{node:'>=22.19.0'},dependencies:{'@earendil-works/pi-coding-agent':'1.3.0'},files:['dist/','runtime/']};
    await fs.writeFile(path.join(source,'package.json'),JSON.stringify(pkg));
    for(const name of ['package-lock.json','tsconfig.json','tsconfig.qualification.json','tools/build.mjs'])await fs.writeFile(path.join(source,name),'{}');
    const version='#!'+process.execPath+'\n'+`if(process.argv.includes('--version'))console.log(JSON.stringify({application:'gitjig',version:'0.0.0',piSdkVersion:'1.3.0'}));else {console.log('OWNED_APPLICATION_LAUNCHED '+process.env.GITJIG_HOME);if(${appStatus}){console.error('OWNED_STARTUP_UNAVAILABLE: correct the selected application setup');process.exitCode=${appStatus};}}`;
    const helper=helperFailure !== 'none' ? `import fs from 'node:fs';const mark=${JSON.stringify(path.join(root,'helper-attempts'))};const count=fs.existsSync(mark)?2:1;fs.writeFileSync(mark,String(count));if(count===1||${helperFailure==='always'}){console.error('OWNED_HELPER_FAILURE');process.exit(1);}console.log('OWNED_HELPER_RECOVERED');` : `import fs from 'node:fs';import {spawn} from 'node:child_process';${denyStop?'process.stdin.setRawMode(true);':''}const native=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'inherit'});fs.writeFileSync(${JSON.stringify(held)},JSON.stringify({helper:process.pid,native:native.pid}));const stop=()=>{native.once('close',()=>process.exit(1));process.kill(-native.pid,'SIGKILL');};process.on('SIGINT',stop);process.on('SIGTERM',stop);console.log('OWNED_RUNTIME_HELPER_STARTED');setInterval(()=>{},1000);`;
    const npm=path.join(root,'owned-npm.js');await fs.writeFile(npm,`import fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
const failed=${JSON.stringify(path.join(root,'phase-failed'))};
if(args[0]===${JSON.stringify(failPhase)}&&!fs.existsSync(failed)){
 fs.writeFileSync(failed,'once');
 if(args[0]==='pack')fs.writeFileSync(path.join(args[args.indexOf('--pack-destination')+1],'partial.tgz'),'partial');
 if(args[0]==='install'){fs.mkdirSync(${JSON.stringify(prefix)},{recursive:true});fs.writeFileSync(path.join(${JSON.stringify(prefix)},'partial-state'),'kept');if(${tamperArchive})fs.appendFileSync(args.at(-1),'tampered');}
 if(${mutateSource})fs.writeFileSync('src/changed-input','changed');
 console.error('OWNED_NPM_PHASE_FAILURE');process.exit(1);
}
if(args[0]==='prefix')console.log(${JSON.stringify(defaultPrefix)});
if(args[0]==='run'){fs.mkdirSync('dist/cli',{recursive:true});fs.writeFileSync('dist/cli/entry.js',${JSON.stringify(version)},{mode:0o700});}
if(args[0]==='pack'){const name='gitjig-0.0.0.tgz';fs.writeFileSync(path.join(args[args.indexOf('--pack-destination')+1],name),'owned inert archive');console.log(name);}
if(args[0]==='install'){const prefix=args[args.indexOf('--prefix')+1],payload=path.join(prefix,'lib/node_modules/gitjig');fs.mkdirSync(path.join(payload,'dist/cli'),{recursive:true});fs.mkdirSync(path.join(payload,'runtime'),{recursive:true});fs.mkdirSync(path.join(prefix,'bin'),{recursive:true});fs.writeFileSync(path.join(payload,'dist/cli/entry.js'),${JSON.stringify(version)},{mode:0o700});fs.writeFileSync(path.join(payload,'runtime/setup.mjs'),${JSON.stringify(helper)});fs.symlinkSync('../lib/node_modules/gitjig/dist/cli/entry.js',path.join(prefix,'bin/gitjig'));}
`,{mode:0o700});
    const guard=path.join(root,'guard.mjs');await fs.writeFile(guard,`import fs from 'node:fs/promises';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const realpath=fs.realpath,spawnSync=cp.spawnSync,spawn=cp.spawn;fs.realpath=async file=>String(file).endsWith('/npm')?${JSON.stringify(npm)}:realpath(file);cp.spawnSync=(file,args,...rest)=>{if(!(file===process.execPath&&args[0]===${JSON.stringify(npm)})&&![${JSON.stringify(path.join(prefix,'bin/gitjig'))},${JSON.stringify(path.join(root,'.local/bin/gitjig'))},${JSON.stringify(path.join(defaultPrefix,'bin/gitjig'))}].includes(file))throw Error('Actual package installation forbidden in this fixture');return spawnSync(file,args,...rest);};
${denyStop?"cp.spawn=(...args)=>{const child=spawn(...args);child.kill=()=>{child.emit('error',Object.assign(Error('Controlled unavailable helper termination'),{code:'EPERM'}));return false;};return child;};":''}
syncBuiltinESMExports();`);
    let passed=false;t.after(async()=>{
        const ids=await fs.readFile(held,'utf8').then(JSON.parse,()=>undefined);
        if(ids){
            const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
            const signal=(pid,name)=>{try{process.kill(pid,name);}catch(error){if(error.code!=='ESRCH')throw error;}};
            const settled=()=>!alive(ids.helper)&&!alive(ids.native)&&!alive(-ids.native);
            signal(-ids.native,'SIGKILL');signal(ids.helper,'SIGTERM');
            let deadline=performance.now()+400;
            while(!settled()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
            if(alive(ids.helper))signal(ids.helper,'SIGKILL');
            deadline=performance.now()+2000;
            while(!settled()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
            assert.ok(settled(),'Owned helper/native cleanup did not settle; fixture root retained');
        }
        if(blockedDefault)await fs.chmod(path.join(defaultPrefix,'lib/node_modules'),0o755);
        if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained inert installer '+root);
    });
    const env={...process.env,HOME:root,GITJIG_HOME:path.join(root,'application-home'),TMPDIR:root,NODE_OPTIONS:'',NODE_PATH:'',npm_config_cache:path.join(root,'cache')};
    return {root,source,prefix,defaultPrefix,calls,held,installer,guard,env,pass(){passed=true;}};
}
test('installer --setup-runtime refuses noninteractive input before any package action',{timeout:10000},async t=>{
    const f=await fixture(t);await assert.rejects(execute(process.execPath,['--import',f.guard,f.installer,'--prefix',f.prefix,'--setup-runtime'],{env:f.env}),error=>/requires an interactive terminal; no installation started/.test(error.stderr));
    await assert.rejects(fs.access(f.calls));await assert.rejects(fs.access(f.prefix));f.pass();
});
test('noninteractive installer retains application-only behavior with no runtime helper launch',{timeout:10000},async t=>{
    const f=await fixture(t),result=await execute(process.execPath,['--import',f.guard,f.installer,'--prefix',f.prefix],{env:f.env,timeout:7000});
    assert.match(result.stdout,/Installed:/);assert.doesNotMatch(result.stdout,/Prepare a Docker/);await assert.rejects(fs.access(f.held));
    assert.deepEqual((await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse).map(a=>a[0]),['ci','run','pack','install']);f.pass();
});
test('printed uninstall command preserves literal shell metacharacters in the installed prefix',{timeout:10000},async t=>{
    const f=await fixture(t,{prefixName:"prefix $GITJIG_TEST_EXPANSION `printf expanded` 'quote"});
    const result=await execute(process.execPath,['--import',f.guard,f.installer,'--prefix',f.prefix],{env:f.env,timeout:7000});
    const command=result.stdout.split('\n').find(line=>line.startsWith('Uninstall: ')).slice('Uninstall: '.length);
    const parsed=await execute('/bin/bash',['-c','npm() { printf "%s\\n" "$@"; }; '+command],{env:{...f.env,GITJIG_TEST_EXPANSION:'EXPANDED'}});
    assert.deepEqual(parsed.stdout.trim().split('\n'),['uninstall','--global','--prefix',f.prefix,'gitjig']);f.pass();
});
for(const route of ['shadowed','exact','alias'])test('installer launch guidance resolves the first PATH command: '+route,{timeout:15000},async t=>{
    const f=await fixture(t),tools=path.join(f.root,'first-bin');await fs.mkdir(tools);
    if(route==='shadowed')await fs.writeFile(path.join(tools,'gitjig'),'#!/bin/sh\necho WRONG_OLDER_APPLICATION\n',{mode:0o700});
    if(route==='alias')await fs.symlink(path.join(f.prefix,'bin/gitjig'),path.join(tools,'gitjig'));
    const env={...f.env,PATH:[tools,path.join(f.prefix,'bin'),f.env.PATH].join(path.delimiter)},file=path.join(f.root,'path-'+route+'.json');
    const steps=[{wait:'Prepare a Docker/Colima runtime',send:'n\r'},...route==='shadowed'?[{wait:'Launch gitjig now using the installed command?',send:'y\r'}]:[]];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix],env,steps,timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout),output=await fs.readFile(file+'.output','utf8');
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.doesNotMatch(output,/WRONG_OLDER_APPLICATION/);
    if(route==='shadowed'){assert.match(output,/gitjig currently resolves to/);assert.match(output,/OWNED_APPLICATION_LAUNCHED/);assert.doesNotMatch(output,/Run: gitjig\r?\n/);}
    else{assert.doesNotMatch(output,/PATH setup remains|Launch gitjig now/);assert.match(output,/Run: gitjig\r?\n/);}
    f.pass();
});
for(const explicit of [false,true])test('actual installer terminal '+(explicit?'joins its helper on SIGTERM and retains app installation':'offers runtime preparation with a clean decline'),{timeout:15000},async t=>{
    const f=await fixture(t),file=path.join(f.root,'terminal.json');
    const steps=explicit?[{wait:'OWNED_RUNTIME_HELPER_STARTED',terminate:true,send:''}]:[{wait:'Prepare a Docker/Colima runtime and execution image now?',send:'n\r'},{wait:'Launch gitjig now using the installed command?',send:'n\r'}];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix,...explicit?['--setup-runtime']:[]],env:f.env,steps,timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,explicit?1:0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
    await fs.access(path.join(f.prefix,'bin/gitjig'));
    if(explicit){const ids=JSON.parse(await fs.readFile(f.held));for(const pid of [ids.helper,ids.native])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});assert.match(await fs.readFile(file+'.output','utf8'),/Gitjig remains installed/);}
    else await assert.rejects(fs.access(f.held));
    assert.equal((await fs.readdir(f.root)).some(n=>n.startsWith('gitjig-install-')),false);f.pass();
});

test('installer live-helper error waits for bounded unknown cleanup and restores terminal before reporting exit2',{timeout:20000},async t=>{
    const f=await fixture(t,{denyStop:true}),file=path.join(f.root,'unknown.json');
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix,'--setup-runtime'],env:f.env,
        steps:[{wait:'OWNED_RUNTIME_HELPER_STARTED',terminate:true,send:''}],timeoutSeconds:14,output:file+'.output',gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:18000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,2);assert.equal(result.terminalRestored,true);assert.equal(result.stages,1);
    const ids=JSON.parse(await fs.readFile(f.held)),output=await fs.readFile(file+'.output','utf8');
    assert.doesNotThrow(()=>process.kill(ids.helper,0),'Unknown-cleanup control must leave the helper live before fixture-owned cleanup');
    assert.ok(output.includes('original helper PID '+ids.helper));assert.match(output,/Inspect the original helper\/subprocesses and saved runtime before retrying/);
    const progress=JSON.parse(await fs.readFile(file+'.output.progress.json'));
    assert.ok(progress.elapsedSeconds>=9.5&&progress.elapsedSeconds<13,'A live helper error cannot settle early or wait forever');
    await fs.access(path.join(f.prefix,'bin/gitjig'));f.pass();
});

for(const explicit of [false,true])test('unwritable '+(explicit?'explicit':'noninteractive default')+' prefix refuses before build and never redirects',{timeout:10000},async t=>{
    const f=await fixture(t,{blockedDefault:true});
    await assert.rejects(execute(process.execPath,['--import',f.guard,f.installer,...explicit?['--prefix',f.defaultPrefix]:[]],{env:f.env}),error=>/no build or installation started/.test(error.stderr));
    const calls=await fs.readFile(f.calls,'utf8').catch(()=> '');
    assert.deepEqual(calls.trim().split('\n').filter(Boolean).map(JSON.parse).map(a=>a[0]),explicit?[]:['prefix']);
    await assert.rejects(fs.access(path.join(f.root,'.local')));f.pass();
});

test('terminal accepts an early user-prefix fallback and launches the verified command without PATH or profile edits',{timeout:15000},async t=>{
    const f=await fixture(t,{blockedDefault:true}),file=path.join(f.root,'fallback.json');
    const steps=[{wait:'Install into your user directory',send:'\r'},
        {wait:'Prepare a Docker/Colima runtime and execution image now?',send:'n\r'},
        {wait:'Launch gitjig now using the installed command?',send:'\r'}];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer],env:f.env,steps,timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,3);assert.equal(result.terminalRestored,true);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(a=>a[0]),['prefix','ci','run','pack','install']);
    assert.equal(calls.at(-1)[calls.at(-1).indexOf('--prefix')+1],path.join(f.root,'.local'));
    assert.ok((await fs.readFile(file+'.output','utf8')).includes('OWNED_APPLICATION_LAUNCHED '+f.env.GITJIG_HOME));
    for(const name of ['.zprofile','.zshrc','.bash_profile','.profile','.npmrc'])await assert.rejects(fs.access(path.join(f.root,name)));
    f.pass();
});

test('actual shell bootstrap exec preserves installer SIGTERM ownership through the runtime helper',{timeout:15000},async t=>{
    const f=await fixture(t),tools=path.join(f.root,'bootstrap-tools');await fs.mkdir(tools);
    await fs.writeFile(path.join(tools,'node'),'#!/bin/bash\nexec '+JSON.stringify(process.execPath)+' --import '+JSON.stringify(f.guard)+' "$@"\n',{mode:0o700});
    for(const name of ['npm','docker','brew'])await fs.writeFile(path.join(tools,name),'#!/bin/bash\nexit 3\n',{mode:0o700});
    const file=path.join(f.root,'bootstrap-signal.json');await fs.writeFile(file,JSON.stringify({command:['/bin/bash',path.join(f.source,'install.sh'),'--prefix',f.prefix,'--setup-runtime'],env:{...f.env,PATH:tools+':/usr/bin:/bin'},steps:[{wait:'OWNED_RUNTIME_HELPER_STARTED',terminate:true,send:''}],timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,1);assert.equal(result.stages,1);assert.equal(result.terminalRestored,true);
    const ids=JSON.parse(await fs.readFile(f.held));for(const pid of [ids.helper,ids.native])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});f.pass();
});

test('ordinary application startup exit2 preserves its diagnostic without claiming cleanup uncertainty',{timeout:15000},async t=>{
    const f=await fixture(t,{appStatus:2}),file=path.join(f.root,'startup-refusal.json');
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix],env:f.env,
        steps:[{wait:'Prepare a Docker/Colima runtime and execution image now?',send:'n\r'},{wait:'Launch gitjig now using the installed command?',send:'\r'}],timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,2);assert.equal(result.stages,2);assert.equal(result.terminalRestored,true);
    const output=await fs.readFile(file+'.output','utf8');assert.match(output,/OWNED_STARTUP_UNAVAILABLE/);assert.match(output,/follow its startup diagnostic/);assert.doesNotMatch(output,/cleanup unconfirmed|inspect the reported process/i);f.pass();
});

for(const mode of ['retry','open'])test('confirmed runtime helper failure offers '+mode+' without reinstalling the application',{timeout:15000},async t=>{
 const f=await fixture(t,{helperFailure:mode==='retry'?'once':'always'}),file=path.join(f.root,'helper-recovery-'+mode+'.json');const steps=[{wait:'Choose how to continue after runtime preparation',send:mode==='retry'?'2\r':'3\r'},...mode==='retry'?[{wait:'Launch gitjig now using the installed command?',send:'n\r'}]:[]];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix,'--setup-runtime'],env:f.env,steps,timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
 const output=await fs.readFile(file+'.output','utf8');assert.match(output,mode==='retry'?/OWNED_HELPER_RECOVERED/:/OWNED_APPLICATION_LAUNCHED/);assert.equal(await fs.readFile(path.join(f.root,'helper-attempts'),'utf8'),mode==='retry'?'2':'1');assert.deepEqual((await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse).map(a=>a[0]),['ci','run','pack','install']);f.pass();
});
for(const phase of ['ci','run','pack','install'])test('ordinary npm '+phase+' failure retries only that phase after source/payload rechecks',{timeout:15000},async t=>{
 const f=await fixture(t,{failPhase:phase}),file=path.join(f.root,'phase-'+phase+'.json');const steps=[{wait:'Retry only npm '+phase,send:'y\r'},{wait:'Prepare a Docker/Colima runtime',send:'n\r'},{wait:'Launch gitjig now',send:'n\r'}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix],env:f.env,steps,timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,3);assert.equal(result.terminalRestored,true);
 const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);for(const name of ['ci','run','pack','install'])assert.equal(calls.filter(a=>a[0]===name).length,name===phase?2:1);
 if(phase==='pack'){const attempts=calls.filter(a=>a[0]==='pack').map(a=>a[a.indexOf('--pack-destination')+1]);assert.notEqual(attempts[0],attempts[1]);await assert.rejects(fs.access(attempts[0]));}
 if(phase==='install')assert.equal(await fs.readFile(path.join(f.prefix,'partial-state'),'utf8'),'kept');f.pass();
});
for(const changed of ['source','archive'])test('manual npm retry refuses changed '+changed+' before a second native phase',{timeout:15000},async t=>{
 const phase=changed==='source'?'ci':'install',f=await fixture(t,{failPhase:phase,mutateSource:changed==='source',tamperArchive:changed==='archive'}),file=path.join(f.root,'stale-'+changed+'.json');
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix],env:f.env,steps:[{wait:'Retry only npm '+phase,send:'y\r'}],timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,1);assert.equal(result.stages,1);assert.match(await fs.readFile(file+'.output','utf8'),/changed; retry refused/);assert.equal((await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse).filter(a=>a[0]===phase).length,1);f.pass();
});

for(const kind of ['confirmation','choice'])test('installer prompt EOF preserves the '+kind+' closed outcome',{timeout:15000},async t=>{
 const f=await fixture(t,{blockedDefault:kind==='confirmation',helperFailure:kind==='choice'?'always':'none'}),file=path.join(f.root,'prompt-eof-'+kind+'.json');
 const args=kind==='confirmation'?[]:['--prefix',f.prefix,'--setup-runtime'];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,...args],env:f.env,steps:[{wait:kind==='confirmation'?'Install into your user directory':'Choose how to continue after runtime preparation',send:'\x04'}],timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,1);assert.equal(result.stages,1);assert.equal(result.terminalRestored,true);
 const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
 if(kind==='confirmation'){assert.deepEqual(calls.map(a=>a[0]),['prefix']);await assert.rejects(fs.access(path.join(f.root,'.local')));}
 else{assert.deepEqual(calls.map(a=>a[0]),['ci','run','pack','install']);assert.equal(await fs.readFile(path.join(f.root,'helper-attempts'),'utf8'),'1');assert.doesNotMatch(await fs.readFile(file+'.output','utf8'),/OWNED_APPLICATION_LAUNCHED/);}
 f.pass();
});
test('installer confirmation correction remains in the same prompt without starting setup',{timeout:15000},async t=>{
 const f=await fixture(t),file=path.join(f.root,'prompt-correction.json');
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix],env:f.env,steps:[{wait:'Prepare a Docker/Colima runtime',send:'maybe\r'},{wait:'Please answer yes or no',send:'n\r'},{wait:'Launch gitjig now',send:'n\r'}],timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,3);assert.equal(result.terminalRestored,true);await assert.rejects(fs.access(f.held));f.pass();
});
test('installer numeric correction preserves the default Finish alternative',{timeout:15000},async t=>{
 const f=await fixture(t,{helperFailure:'always'}),file=path.join(f.root,'choice-correction.json');
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,f.installer,'--prefix',f.prefix,'--setup-runtime'],env:f.env,steps:[{wait:'Choose how to continue after runtime preparation',send:'9\r'},{wait:'Choose one of the numbered actions',send:'\r'}],timeoutSeconds:8,output:file+'.output',gracefulShutdownSeconds:3}));
 const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:12000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,1);assert.equal(result.stages,2);assert.equal(result.terminalRestored,true);assert.equal(await fs.readFile(path.join(f.root,'helper-attempts'),'utf8'),'1');f.pass();
});
