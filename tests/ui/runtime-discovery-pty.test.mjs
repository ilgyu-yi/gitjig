import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {discoveryFixture,heldIds,image,imageListArgs,markerListArgs} from './runtime-discovery-fixture.mjs';
import {dockerContextInspectionFormat} from '../../runtime/setup.mjs';
import {replacePathAfterReview} from '../helpers/reviewed-path.mjs';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);
test('actual terminal stages observed context and tagged immutable image before original reviewed save',{timeout:20000},async t=>{
    const f=await discoveryFixture(t),home=f.c.applicationHome();await f.startup.save({version:1,runtime:{dockerBinary:f.binary,dockerContext:'old',image:'sha256:'+'0'.repeat(64),memoryMiB:2048}});await f.c.close();
    const alternate=path.join(f.root,'alternate-docker');
    await fs.copyFile(f.binary,alternate);
    const guard=path.join(f.root,'guard.mjs');await fs.writeFile(guard,`
import ${JSON.stringify(new URL('./../cli/account-ui-no-network.mjs',import.meta.url).href)};
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const original=cp.spawn;let denied=0;
const no=()=>{denied++;throw Error('Only the exact owned discovery executable may run');};
cp.spawn=(file,args,options)=>{if(!${JSON.stringify([f.binary,alternate])}.includes(file))return no();return original(file,args,options);};
for(const key of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=no;
syncBuiltinESMExports();process.on('exit',()=>{if(denied)process.exitCode=1;});
`,{mode:0o600});
    const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:f.root,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',SHELL:'/bin/sh',NODE_OPTIONS:'',NODE_PATH:'',DOCKER_HOST:'MUST_NOT_USE',DOCKER_CONTEXT:'MUST_NOT_USE'};
    const empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    const run=async(label,steps)=>{const file=path.join(f.root,label+'.json');await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,'dist/cli/entry.js'],env,steps,timeoutSeconds:7,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
        try{const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);}catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-6000));throw error;}};
    await run('choose',[
        {wait:'Model: not selected',send:'/setup runtime\x1b\r'},
        {wait:'Runtime setup · staged',send:'Runtime setup help\r'},
        {wait:'Runtime is the isolated Docker environment',queries:empty,send:'\x1b'},
        {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
        {wait:'Use command -v docker',send:'\r'},
        {wait:'Named connection to the Docker backend',send:'\r'},
        {wait:'Prepared Linux image with project tools',send:'\r'},
        {wait:'Existing Docker client configuration directory',send:'\r'},
        {wait:'Runtime setup · staged',send:'Choose Docker context\r'},
        {wait:'Docker executable · canonical absolute path',send:'\r'},
        {wait:'Docker configuration directory · required for discovery',send:f.config+'\r'},
        {wait:'Continue to confirmation',send:'\x1b'},
        {wait:'Runtime setup · staged',send:'Choose Docker context\r'},
        {wait:'Docker executable · canonical absolute path',send:'\r'},
        {wait:'Docker configuration directory · required for discovery',send:f.config+'\r'},
        {wait:'Continue to confirmation',send:'\r'},
        {wait:'Use this Docker route for discovery?',send:'Discover with this route\r'},
        {wait:'Observed contexts',send:'owned\r'},
        {wait:'Runtime setup · staged',send:'Choose existing runtime image\r'},
        {wait:'Continue to confirmation',send:'\r'},
        {wait:'Use this Docker route for discovery?',send:'Discover with this route\r'},
        {wait:'Recipe marker · gitjig-runtime:checked',send:'\r'},
        {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
        {wait:'Review runtime setup before applying',queries:empty,send:'\r'},
        {wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},
        {wait:'Runtime saved and applied',queries:empty,send:'/quit\x1b\r'},
    ]);
    assert.deepEqual(JSON.parse(await fs.readFile(f.file)).runtime,{dockerBinary:f.binary,dockerConfigDirectory:f.config,dockerContext:'owned',image,memoryMiB:2048});
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    const inspection=['--config',f.config,'context','inspect','--format',dockerContextInspectionFormat,'owned'];
    assert.deepEqual(calls.map(call=>call.args),[['--config',f.config,'context','ls','--quiet'],inspection,imageListArgs(f.config),inspection,imageListArgs(f.config,true),inspection,markerListArgs(f.config),inspection]);
    for(const call of calls){assert.equal(call.env.DOCKER_HOST,undefined);assert.equal(call.env.DOCKER_CONTEXT,undefined);}
    await run('relaunch',[
        {wait:'Model: not selected',send:'/setup inspect\x1b\r'},
        {wait:'Sources · {"runtime":"saved","bridge":"none"}',queries:empty,send:'\x1b'},
        {wait:'INPUT',send:'/quit\x1b\r'},
    ]);
    assert.equal((await fs.readFile(f.calls,'utf8')).trim().split('\n').length,8);

    const saved = await fs.readFile(f.file,'utf8');
    await fs.writeFile(f.mode,'failed');
    await run('recover',[
        {wait:'Model: not selected',send:'/setup runtime\x1b\r'},
        {wait:'Runtime setup · staged',send:'Choose Docker context\r'},
        {wait:'Continue to confirmation',send:'\r'},
        {wait:'Use this Docker route for discovery?',send:'Discover with this route\r'},
        {wait:'Open recovery actions',queries:empty,send:'\x1b'},
        {wait:'Runtime setup · staged',assertDraft:'/setup runtime',send:'Choose existing runtime image\r'},
        {wait:'Continue to confirmation',send:'\r'},
        {wait:'Use this Docker route for discovery?',send:'Discover with this route\r'},
        {wait:'Open recovery actions',queries:empty,send:'\r'},
        {wait:'Choose a recovery action',send:'Edit runtime fields\r'},
        {wait:'Docker executable · canonical absolute path',send:'\x1b'},
        {wait:'Runtime setup · staged',queries:empty,assertDraft:'/setup runtime',send:'Cancel\r'},
        {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
    ]);
    assert.equal(await fs.readFile(f.file,'utf8'),saved);
    const recoveryCalls = (await fs.readFile(f.calls,'utf8')).trim().split('\n').slice(calls.length).map(JSON.parse);
    assert.deepEqual(recoveryCalls.map(call=>call.args),[
        ['--config',f.config,'context','ls','--quiet'],
        inspection,
        imageListArgs(f.config),
    ]);
    await fs.writeFile(f.mode,'normal');
    const priorCalls = await fs.readFile(f.calls,'utf8');
    const alias=path.join(f.root,'docker-alias'), arm=path.join(f.root,'discovery-reviewed'), changed=path.join(f.root,'discovery-path-changed');
    await fs.symlink(f.binary,alias);
    await Promise.all([run('redirected-discovery',[
        {wait:'Model: not selected',send:'/setup runtime\x1b\r'},
        {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
        {wait:'Docker executable',send:'\x15'+alias+'\r'},
        {wait:'Docker context',send:'\r'},
        {wait:'Runtime image',send:'\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Runtime setup · staged',send:'Choose Docker context\r'},
        {wait:'Continue to confirmation',releaseFile:arm,send:'\r'},
        {wait:'Use this Docker route for discovery?',waitFiles:[{path:changed,value:'changed'}],send:'Discover with this route\r'},
        {wait:'Reviewed Docker route changed',queries:empty,textFiles:[{path:f.calls,value:priorCalls}],send:'\x1b'},
        {wait:'Runtime setup · staged',assertDraft:'/setup runtime',send:'Choose existing runtime image\r'},
        {wait:'Continue to confirmation',send:'\r'},
        {wait:'Use this Docker route for discovery?',send:'Discover with this route\r'},
        {wait:'Observed images',send:'\x1b'},
        {wait:'Runtime setup · staged',queries:empty,assertDraft:'/setup runtime',send:'Cancel\r'},
        {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
    ]),replacePathAfterReview(f.root,arm,changed,f.binary,alternate)]);
    const redirected = await fs.readFile(path.join(f.root,'redirected-discovery.json.terminal'),'utf8');
    assert.ok(redirected.includes(f.binary));
    assert.ok(redirected.includes(alternate));
    assert.deepEqual((await fs.readFile(f.calls,'utf8')).slice(priorCalls.length).trim().split('\n').map(line=>JSON.parse(line).args),[
        inspection, imageListArgs(f.config), inspection, imageListArgs(f.config,true), inspection, markerListArgs(f.config), inspection,
    ]);
    assert.equal(await fs.readFile(f.file,'utf8'),saved);
    f.pass();
});

for(const scenario of ['close','close cleanup unknown','cancel contexts','cancel images'])test(
    `actual terminal ${scenario} settles the owned discovery`,{timeout:16000},async t=>{
    const unknown=scenario==='close cleanup unknown',cancel=scenario.startsWith('cancel'),images=scenario==='cancel images';
    const locale=images?'ko':'en', label=(key,values)=>uiText(locale,key,values);
    const f=await discoveryFixture(t),home=f.c.applicationHome();
    if(images) f.c.setConversationLanguage({conversationId:f.source.conversationId,expectedGeneration:0,expectedRevision:0,replyLanguage:'ko'});
    const saved=await fs.readFile(f.file,'utf8');
    await fs.writeFile(f.mode,images?'dangling-hold':'hold');await f.c.close();
    const guard=path.join(f.root,'close-guard.mjs'),file=path.join(f.root,'close-terminal.json');
    await fs.writeFile(guard,`
import ${JSON.stringify(new URL('./../cli/account-ui-no-network.mjs',import.meta.url).href)};
import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn,kill=process.kill.bind(process);let denied=0,group;
const no=()=>{denied++;throw Error('Only owned discovery is allowed');};
cp.spawn=(file,args,options)=>{if(file!==${JSON.stringify(f.binary)})return no();const child=spawn(file,args,options);group=child.pid;const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(f.held)})){clearInterval(timer);process.stderr.write('OWNED_DISCOVERY_STARTED\\n');}},5);child.once('close',()=>clearInterval(timer));return child;};
for(const key of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=no;
${unknown?"process.kill=(pid,signal)=>{if(pid===-group){const error=Error('Controlled unavailable native group cleanup');error.code='EPERM';throw error;}return kill(pid,signal);};":''}
syncBuiltinESMExports();process.on('exit',()=>{if(denied)process.exitCode=1;});
`,{mode:0o600});
    const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:f.root,USER:'gitjig-fixture',LOGNAME:'gitjig-fixture',GITJIG_HOME:home,TMPDIR:f.root,TERM:'xterm-256color',LANG:'C.UTF-8',SHELL:'/bin/sh',NODE_OPTIONS:'',NODE_PATH:''};
    const action=label(images?'runtime.image':'runtime.context'), draft='/setup runtime';
    const preserve={assertDraft:draft,textFiles:[{path:f.file,value:saved}],queries:['conversation_inputs','works','runs'].map(table=>({sql:`SELECT COUNT(*) FROM ${table}`,rows:[[0]]}))};
    const steps=[{wait:label('footer.setup'),send:draft+'\x1b\r'},{wait:label('runtime.title'),send:action+'\r'},
        {wait:label('review.confirm'),send:'\r'},{wait:label('runtime.discoverTitle'),send:label('runtime.discoverConfirm')+'\r'},
        cancel?{wait:'OWNED_DISCOVERY_STARTED',...preserve,send:'\x1b'}:{wait:'OWNED_DISCOVERY_STARTED',terminate:true,send:''}];
    if(cancel) steps.push(
        {wait:locale==='ko'?'Docker 조회 취소 · 편집 값 보존':'Docker discovery cancelled · staged values kept',...preserve,releaseFile:f.mode,send:action+'\r'},
        {wait:label('review.confirm'),...preserve,send:'\r'},
        {wait:label('runtime.discoverTitle'),...preserve,send:label('runtime.discoverConfirm')+'\r'},
        {wait:label(images?'runtime.observedImages':'runtime.observedContexts'),...preserve,send:'\x1b'},
        {wait:label('runtime.title'),...preserve,send:label('runtime.cancel')+'\r'},
        {wait:label('interaction.commandCancelled',{submit:''}).split(' · ').slice(0,2).join(' · '),...preserve,send:'\x15/quit\x1b\r'},
    );
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,'dist/cli/entry.js','conversation','ui','--conversation',f.source.conversationId],env,steps,timeoutSeconds:7,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
    let ids;
    try{
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);ids=await heldIds(f);
        assert.equal(result.stages,steps.length);assert.equal(result.exitCode,unknown?2:0);assert.equal(result.terminalRestored,true);
        const progress=JSON.parse(await fs.readFile(file+'.terminal.progress.json')),output=await fs.readFile(file+'.terminal','utf8');
        assert.ok(progress.elapsedSeconds<4.5,'Close waited for the five-second discovery deadline');
        if(cancel) {
            const heading=label(images?'runtime.discoveryImagesProgress':'runtime.discoveryContextsProgress',{context:'"owned"'});
            assert.ok(output.slice(0,progress.actionOutputOffsets[4]).includes(heading));
            assert.ok(output.slice(0,progress.actionOutputOffsets[4]).includes(label('runtime.discoveryCancelHint')));
            const observed=label(images?'runtime.observedImages':'runtime.observedContexts');
            assert.ok(!output.slice(0,progress.actionOutputOffsets[5]).includes(observed),'Partial inventory escaped before retry');
        }
        if(unknown){assert.match(output,/RUNTIME_DISCOVERY_CLEANUP_UNKNOWN/);assert.ok(output.includes('process group '+ids.group));}
        else for(const pid of [ids.group,ids.descendant])assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
    }catch(error){t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-6000));throw error;}
    finally{
        ids??=await heldIds(f).catch(()=>undefined);
        if(ids){try{process.kill(-ids.group,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
            const until=Date.now()+2000;while(Date.now()<until){try{process.kill(-ids.group,0);}catch(error){if(error.code==='ESRCH')break;throw error;}await new Promise(resolve=>setTimeout(resolve,10));}
            assert.throws(()=>process.kill(-ids.group,0),error=>error.code==='ESRCH');}
    }
    f.pass();
});
