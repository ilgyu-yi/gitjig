import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
const execute=promisify(execFile),image='sha256:'+'a'.repeat(64),oldImage='sha256:'+'b'.repeat(64);

async function fixture(t,{denyCleanup=false,failNative=false}={}) {
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/runtime-preparation-pty-')));
    const home=path.join(root,'application'),owner=path.join(root,'owner'),prefix=path.join(root,'tools'),config=path.join(owner,'.docker');
    for(const folder of [config,path.join(prefix,'bin'),path.join(prefix,'opt/docker-buildx/bin')])await fs.mkdir(folder,{recursive:true,mode:0o700});
    const calls=path.join(root,'calls'),held=path.join(root,'held'),release=path.join(root,'release'),drift=path.join(root,'drift'),client=path.join(prefix,'bin/docker');
    await fs.writeFile(path.join(config,'config.json'),'{"currentContext":"keep","auths":{}}',{mode:0o600});
    const body=`import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const args=process.argv.slice(2),name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args,config:process.env.DOCKER_CONFIG,ambient:process.env.DOCKER_HOST})+'\\n');
if(name==='brew'){if(args[0]==='--prefix')console.log(${JSON.stringify(prefix)});}
else if(name==='colima'){fs.mkdirSync(path.join(process.env.COLIMA_HOME,args[args.indexOf('--profile')+1]),{recursive:true});}
else if(name==='docker'){
 if(${failNative}){console.error('OWNED_CONTEXTUAL_FAILURE');process.exit(1);}
 if(args[4]==='version')console.log(JSON.stringify('owned-engine'));
 else if(args[4]==='image'&&args[5]==='inspect')console.log(JSON.stringify(args.at(-1)));
 else {
 const context=args.at(-1),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
 fs.writeFileSync(${JSON.stringify(held)},JSON.stringify({group:process.pid,child:child.pid,context,files:fs.readdirSync(context)}));
 console.log('OWNED_BUILD_OUTPUT');
 const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);child.once('close',()=>{if(fs.existsSync(${JSON.stringify(drift)}))fs.appendFileSync(${JSON.stringify(path.join(home,'config/startup.json'))},'\\n');fs.writeFileSync(args[args.indexOf('--iidfile')+1],${JSON.stringify(image)});process.exit(0);});child.kill();}},5);
 }
}
`;
    for(const name of ['docker','colima','brew'])await fs.writeFile(path.join(prefix,'bin',name),'#!'+process.execPath+'\n'+body,{mode:0o700});
    await fs.writeFile(path.join(prefix,'opt/docker-buildx/bin/docker-buildx'),'#!'+process.execPath+'\n',{mode:0o700});
    const c=await openController({installationHome:home}),startup=ApplicationStartup.open(c),conversation=c.createConversation();
    c.setConversationView({selectedId:conversation.conversationId});
    await startup.save({version:1,runtime:{dockerBinary:client,dockerConfigDirectory:config,dockerContext:'owned',image:oldImage,memoryMiB:2048}});
    await c.close();
    const saved=await fs.readFile(path.join(home,'config/startup.json'),'utf8');
    const guard=path.join(root,'guard.mjs');await fs.writeFile(guard,`
import ${JSON.stringify(new URL('../cli/account-ui-no-network.mjs',import.meta.url).href)};
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn,allowed=${JSON.stringify(['docker','colima','brew'].map(n=>path.join(prefix,'bin',n)))};let group;
cp.spawn=(file,...rest)=>{if(!allowed.includes(file))throw Error('Only owned preparation tools may execute');const child=spawn(file,...rest);if(file===${JSON.stringify(client)})group=child.pid;return child;};
${denyCleanup?"const kill=process.kill.bind(process);process.kill=(pid,signal)=>{if(pid===-group){const error=Error('Controlled denied native cleanup');error.code='EPERM';throw error;}return kill(pid,signal);};":''}
syncBuiltinESMExports();
`);
    let passed=false;
    t.after(async()=>{
        const observation=await fs.readFile(held,'utf8').then(JSON.parse,()=>undefined);
        if(observation)try{process.kill(-observation.group,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
        if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained preparation PTY '+root);
    });
    const env={PATH:path.join(prefix,'bin')+':'+path.dirname(process.execPath)+':/usr/bin:/bin',HOME:owner,GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',DOCKER_HOST:'POISONED_AMBIENT',DOCKER_CONTEXT:'POISONED_AMBIENT'};
    const empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    return {root,home,owner,config,client,calls,held,release,drift,saved,guard,env,empty,pass(){passed=true;}};
}
async function launch(f,label,steps,{standalone=false,expectedExit=0}={}) {
    const file=path.join(f.root,label+'.json');
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,standalone?'runtime/setup.mjs':'dist/cli/entry.js',...standalone?['--home',f.home]:[]],
        env:f.env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(result.stages,steps.length);assert.equal(result.exitCode,expectedExit);assert.equal(result.terminalRestored,true);
    return fs.readFile(file+'.terminal','utf8');
}
const open=[{wait:'Model: not selected',send:'/setup runtime\x1b\r'}];
const startBuild=[{wait:'Runtime setup · staged',send:'Prepare an execution image\r'},{wait:'Review execution image build',send:'\x1b'},{wait:'Build execution image?',send:'Build execution image\r'}];
const save=[{wait:'Runtime setup · staged',send:'Review and save runtime\r'},{wait:'Review runtime setup before applying',send:'\x1b'},{wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},{wait:'Runtime saved and applied',send:'/quit\x1b\r'}];

test('original terminal Build/Back, bounded live output and elapsed time stage an ID before explicit Save',{timeout:20000},async t=>{
    const f=await fixture(t);
    const output=await launch(f,'build',[
        ...open,{wait:'Runtime setup · staged',send:'Extra image packages\r'},
        {wait:'Extra Debian packages for the next image build',send:'python3;echo\r'},
        {wait:'Correct image package names',send:'\x1b'},
        {wait:'Extra Debian packages for the next image build',send:'\x15python3 build-essential\r'},
        ...startBuild.slice(0,-1),{wait:'Build execution image?',send:'\r'},...startBuild,
        {wait:'OWNED_BUILD_OUTPUT',queries:f.empty,assertDraft:'/setup runtime',send:''},
        {wait:'Running · 1s',releaseFile:f.release,send:''},
        ...save.slice(0,-1),{...save.at(-1),queries:f.empty},
    ]);
    assert.match(output,/Esc cancels local execution/);assert.match(output,/Running · 1s/);
    const current=JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'));
    assert.equal(current.runtime.image,image);assert.equal(current.runtime.memoryMiB,2048);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,1);assert.equal(calls[0].ambient,undefined);assert.ok(calls[0].args.includes('GITJIG_EXTRA_PACKAGES=python3 build-essential'));
    const held=JSON.parse(await fs.readFile(f.held));assert.deepEqual(held.files.sort(),['Dockerfile','Dockerfile.dockerignore','io-helper.mjs']);await assert.rejects(fs.access(held.context));f.pass();
});

for(const close of [false,true])test('actual terminal '+(close?'close':'Escape')+' joins preparation descendants, keeps old settings and preserves its draft',{timeout:20000},async t=>{
    const f=await fixture(t);
    const steps=[...open,...startBuild,{wait:'OWNED_BUILD_OUTPUT',queries:f.empty,assertDraft:'/setup runtime',...close?{terminate:true,send:''}:{send:'\x1b'}}];
    if(!close)steps.push({wait:'Image preparation stopped · previous staged values retained',send:'\x1b'},
        {wait:'Runtime setup · staged',send:'Cancel\r'},{wait:'Command cancelled; draft kept',queries:f.empty,assertDraft:'/setup runtime',terminate:true,send:''});
    await launch(f,close?'close':'cancel',steps);
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    const held=JSON.parse(await fs.readFile(f.held));for(const pid of [held.group,held.child])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
    await assert.rejects(fs.access(held.context));f.pass();
});

test('in-app interactive installer performs owned package/Colima/image steps and stages for original Save',{timeout:20000},async t=>{
    const f=await fixture(t);
    const output=await launch(f,'wizard',[
        ...open,{wait:'Runtime setup · staged',send:'Interactive runtime installer\r'},
        {wait:'Existing Docker backend',send:'\x152\r'},
        {wait:'Install/repair Colima',send:'\x15y\r'},
        {wait:'Colima profile',send:'\x15build\r'},
        {wait:'Run Colima preparation now?',send:'\r'},
        {wait:'Build the installed execution image now?',send:'\r'},
        {wait:'OWNED_BUILD_OUTPUT',queries:f.empty,releaseFile:f.release,send:''},...save,
    ]);
    const current=JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'));
    assert.match(output,/Starting selected Colima profile/);assert.match(output,/Building execution image/);
    assert.equal(current.runtime.dockerContext,'colima-build');assert.equal(current.runtime.image,image);
    assert.equal(await fs.readFile(path.join(f.config,'config.json'),'utf8'),'{"currentContext":"keep","auths":{}}');
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(c=>c.name),['brew','brew','colima','docker']);
    assert.deepEqual(calls[0].args,['install','colima','docker','docker-buildx']);assert.ok(calls[2].args.includes('--activate=false'));
    f.pass();
});

for(const close of [false,true])test('standalone interactive helper '+(close?'handles SIGTERM without a detached build':'uses original captured startup Save') ,{timeout:20000},async t=>{
    const f=await fixture(t);
    const steps=[{wait:'Choose [',send:'1\r'},{wait:'Docker executable [',send:'\r'},{wait:'Docker configuration directory [',send:'\r'},
        {wait:'Docker context [',send:'\r'},{wait:'Create this Docker configuration directory',send:'n\r'},
        {wait:'Build the installed execution image now?',send:'\r'},
        {wait:'OWNED_BUILD_OUTPUT',...close?{terminate:true,send:''}:{send:''}},
    ];
    if(!close)steps.push({wait:'1s elapsed',releaseFile:f.release,send:''},{wait:'Save runtime settings in',send:'y\r'});
    await launch(f,close?'standalone-close':'standalone-save',steps,{standalone:true,expectedExit:close?1:0});
    const current=await fs.readFile(path.join(f.home,'config/startup.json'),'utf8');
    if(close)assert.equal(current,f.saved);else {assert.equal(JSON.parse(current).runtime.image,image);assert.equal(JSON.parse(current).runtime.memoryMiB,2048);}
    const held=JSON.parse(await fs.readFile(f.held));for(const pid of [held.group,held.child])assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});f.pass();
});

test('standalone refuses a competing startup write after the held build without overwriting it',{timeout:20000},async t=>{
    const f=await fixture(t);
    const output=await launch(f,'standalone-drift',[
        {wait:'Choose [',send:'1\r'},{wait:'Docker executable [',send:'\r'},{wait:'Docker configuration directory [',send:'\r'},
        {wait:'Docker context [',send:'\r'},{wait:'Create this Docker configuration directory',send:'n\r'},
        {wait:'Build the installed execution image now?',send:'\r'},
        {wait:'OWNED_BUILD_OUTPUT',releaseFile:f.drift,send:''},{wait:'1s elapsed',releaseFile:f.release,send:''},
        {wait:'Saved startup changed while editing',send:''},
    ],{standalone:true,expectedExit:1});
    assert.doesNotMatch(output,/Runtime saved/);assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved+'\n');
    const held=JSON.parse(await fs.readFile(f.held));await assert.rejects(fs.access(held.context));f.pass();
});

test('standalone EOF closes a pending question without starting a native operation',{timeout:10000},async t=>{
    const f=await fixture(t);await launch(f,'standalone-eof',[{wait:'Choose [',send:'\x04'}],{standalone:true,expectedExit:1});
    await assert.rejects(fs.access(f.calls));assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);f.pass();
});

test('standalone preserves unknown native cleanup as exit2 with its original group',{timeout:15000},async t=>{
    const f=await fixture(t,{denyCleanup:true});
    const output=await launch(f,'standalone-unknown',[
        {wait:'Choose [',send:'1\r'},{wait:'Docker executable [',send:'\r'},{wait:'Docker configuration directory [',send:'\r'},
        {wait:'Docker context [',send:'\r'},{wait:'Create this Docker configuration directory',send:'n\r'},
        {wait:'Build the installed execution image now?',send:'\r'},{wait:'OWNED_BUILD_OUTPUT',terminate:true,send:''},
    ],{standalone:true,expectedExit:2});
    const held=JSON.parse(await fs.readFile(f.held));assert.match(output,/RUNTIME_PREPARATION_CLEANUP_UNKNOWN/);assert.ok(output.includes('process group '+held.group));
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);f.pass();
});

test('unconfirmed local cleanup shows its original group, blocks another build and exits with failure',{timeout:20000},async t=>{
    const f=await fixture(t,{denyCleanup:true});
    const output=await launch(f,'unknown-cleanup',[
        ...open,...startBuild,{wait:'OWNED_BUILD_OUTPUT',send:'\x1b'},
        {wait:'cleanup unconfirmed for process group',queries:f.empty,assertDraft:'/setup runtime',send:'\r'},
        ...startBuild,
        {wait:'cleanup unconfirmed for process group',queries:f.empty,assertDraft:'/setup runtime',terminate:true,send:''},
    ],{expectedExit:2});
    const held=JSON.parse(await fs.readFile(f.held));assert.ok(output.includes('process group '+held.group));
    assert.equal((await fs.readFile(f.calls,'utf8')).trim().split('\n').length,1);
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    process.kill(-held.group,'SIGKILL');
    const deadline=Date.now()+1000;while(Date.now()<deadline){try{process.kill(-held.group,0);}catch(error){if(error.code==='ESRCH')break;throw error;}await new Promise(r=>setTimeout(r,10));}
    assert.throws(()=>process.kill(-held.group,0),{code:'ESRCH'});f.pass();
});

test('actual terminal checks selected engine/image and keeps saved runtime and original draft',{timeout:20000},async t=>{
    const f=await fixture(t);const output=await launch(f,'metadata-check',[
        ...open,{wait:'Runtime setup · staged',send:'Check runtime connection and image\r'},
        {wait:'Review runtime metadata check',queries:f.empty,send:'\x1b'},
        {wait:'Check selected runtime?',send:'Check connection and image\r'},
        {wait:'Runtime setup · staged',queries:f.empty,assertDraft:'/setup runtime',send:'Cancel\r'},
        {wait:'Command cancelled; draft kept',send:'\x15/quit\x1b\r'},
    ]);
    assert.match(output,/Checking selected runtime/);assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(c=>c.args.slice(4,6)),[['version','--format'],['image','inspect']]);await assert.rejects(fs.access(f.held));f.pass();
});

for(const action of ['Prepare an execution image','Check runtime connection and image'])test('actual terminal '+action+' failure opens selected repair immediately',{timeout:20000},async t=>{
 const f=await fixture(t,{failNative:true}),check=action.startsWith('Check');const output=await launch(f,'repair-'+(check?'check':'build'),[
  ...open,{wait:'Runtime setup · staged',send:action+'\r'},
  {wait:check?'Review runtime metadata check':'Review execution image build',send:'\x1b'},
  {wait:check?'Check selected runtime?':'Build execution image?',send:(check?'Check connection and image':'Build execution image')+'\r'},
  {wait:check?'Runtime check stopped':'Image preparation stopped',queries:f.empty,send:'\x1b'},
  {wait:'Choose a recovery action',send:'Edit runtime fields\r'},
  {wait:'Docker executable · canonical absolute path',send:'\r'},
  {wait:'Docker context · explicit name',send:'\r'},
  {wait:'Runtime image · immutable',send:'\r'},
  {wait:'Docker configuration directory · canonical path',send:'\r'},
  {wait:'Runtime setup · staged',queries:f.empty,assertDraft:'/setup runtime',send:'Cancel\r'},
  {wait:'Command cancelled; draft kept',send:'\x15/quit\x1b\r'},
 ]);
 assert.match(output,/OWNED_CONTEXTUAL_FAILURE/);assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);assert.equal((await fs.readFile(f.calls,'utf8')).trim().split('\n').length,1);await assert.rejects(fs.access(f.held));f.pass();
});

test('actual terminal missing Homebrew explains the blocker and switches directly to existing Docker',{timeout:20000},async t=>{
 const f=await fixture(t);await fs.unlink(path.join(f.root,'tools/bin/brew'));const output=await launch(f,'missing-brew-switch',[
  ...open,{wait:'Runtime setup · staged',send:'Interactive runtime installer\r'},
  {wait:'Existing Docker backend',send:'\x152\r'},
  {wait:'Install/repair Colima',send:'\x15y\r'},
  {wait:'Automatic package installation requires Homebrew',queries:f.empty,send:'\x1b'},
  {wait:'Choose another runtime preparation route',send:'Use existing Docker backend\r'},
  {wait:'Docker executable',send:'\r'},{wait:'Docker configuration directory',send:'\r'},
  {wait:'Docker context',send:'\r'},{wait:'Create this Docker configuration directory',send:'\x15n\r'},
  {wait:'Build the installed execution image now?',send:'\x15n\r'},
  {wait:'Runtime setup · staged',queries:f.empty,assertDraft:'/setup runtime',send:'Cancel\r'},
  {wait:'Command cancelled; draft kept',send:'\x15/quit\x1b\r'},
 ]);
 assert.match(output,/Use existing Docker backend/);assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);await assert.rejects(fs.access(f.calls));f.pass();
});
