import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {replacePathAfterReview} from '../helpers/reviewed-path.mjs';
import {dockerContextInspection} from '../helpers/docker-context-inspection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify,stripVTControlCharacters} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile),image='sha256:'+'a'.repeat(64),oldImage='sha256:'+'b'.repeat(64);
const cliEntry=process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js';
const retainedColimaSettings='runtime: docker\nmemory: 6\n';

async function fixture(t,{denyCleanup=false,failNative=false,failContext,observeStartup=false,largeOutput=false,firstRun=false,failFirstColima=false,locale='en',alternateDocker=false,engineFailure,missingContext=false,waitForImage=false,emptyImages=false}={}) {
    const root=await temporaryDirectory('runtime-preparation-pty');
    const home=path.join(root,'application'),owner=path.join(root,'owner'),prefix=path.join(root,'tools'),config=path.join(owner,'.docker');
    for(const folder of [config,path.join(prefix,'bin'),path.join(prefix,'opt/docker-buildx/bin')])await fs.mkdir(folder,{recursive:true,mode:0o700});
    const inspections=path.join(root,'startup-inspections.jsonl'),calls=path.join(root,'calls'),held=path.join(root,'held'),release=path.join(root,'release'),drift=path.join(root,'drift'),client=path.join(prefix,'bin/docker');
    const engineReady = path.join(root, 'engine-ready');
    const configText=JSON.stringify({currentContext:firstRun?'owned':'keep',auths:{}});
    await fs.writeFile(path.join(config,'config.json'),configText,{mode:0o600});
    const body=`import fs from 'node:fs';import path from 'node:path';
import {pathToFileURL} from 'node:url';import {spawn} from 'node:child_process';
const args=process.argv.slice(2),name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args,config:process.env.DOCKER_CONFIG,ambient:process.env.DOCKER_HOST})+'\\n');
if(name==='brew'){if(args[0]==='--prefix')console.log(${JSON.stringify(prefix)});}
else if(name==='colima'){
 const profile=path.join(process.env.COLIMA_HOME,args[args.indexOf('--profile')+1]);
 const settings=path.join(profile,'colima.yaml');
 fs.mkdirSync(profile,{recursive:true});
 if(${failFirstColima}&&!fs.existsSync(settings)){
  fs.writeFileSync(settings,${JSON.stringify(retainedColimaSettings)});
  console.error('downloading disk image ...');
  console.error('error starting vm: error at creating and starting');
  process.exit(1);
 }
 if(${failFirstColima}&&!args.includes('--save-config=false'))fs.writeFileSync(settings,'settings were rewritten');
}
else if(name==='docker'){
 ${await dockerContextInspection(config, ['owned', 'colima-build', ...(failContext?[failContext]:[])])}
 if(args[2]==='context'&&args[3]==='inspect'){console.error('PRIVATE_CONTEXT_DIAGNOSTIC');process.exit(1);}
 if(args[2]==='context'&&args[3]==='ls'){console.log('owned');process.exit(0);}
 if(${firstRun}&&args[3]!=='owned'){console.error('Default Docker socket is unavailable in this fixture');process.exit(1);}
 if(${failNative}||${JSON.stringify(failContext??null)}&&args[3]===${JSON.stringify(failContext??null)}){console.error('OWNED_CONTEXTUAL_FAILURE');process.exit(1);}
 if(args[4]==='version'){
  if(${JSON.stringify(engineFailure ?? null)}&&!fs.existsSync(${JSON.stringify(engineReady)})){
   if(${engineFailure === 'signal'})process.kill(process.pid,'SIGTERM');
   console.error('OWNED_ENGINE_UNREACHABLE');process.exit(1);
  }
  console.log(JSON.stringify('owned-engine'));
 }
 else if(args[4]==='image'&&args[5]==='inspect'){
  if(${waitForImage}&&!fs.existsSync(${JSON.stringify(engineReady)})){console.error('OWNED_IMAGE_NOT_VERIFIED');process.exit(1);}
  console.log(JSON.stringify(args.at(-1)));
 }
 else if(${emptyImages}&&args[4]==='image'&&args[5]==='ls')process.exit(0);
 else {
 const context=args.at(-1),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
 fs.writeFileSync(${JSON.stringify(held)},JSON.stringify({group:process.pid,child:child.pid,context,files:fs.readdirSync(context)}));
 if(${largeOutput})console.log('OLDER_OUTPUT_DISCARDED\\n'+'trace line\\n'.repeat(2000));
 console.log('OWNED_BUILD_OUTPUT');
 const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);child.once('close',()=>{if(fs.existsSync(${JSON.stringify(drift)}))fs.appendFileSync(${JSON.stringify(path.join(home,'config/startup.json'))},'\\n');fs.writeFileSync(args[args.indexOf('--iidfile')+1],${JSON.stringify(image)});process.exit(0);});child.kill();}},5);
 }
}
`;
    for(const name of ['docker','colima','brew'])await fs.writeFile(path.join(prefix,'bin',name),'#!'+process.execPath+'\n'+body,{mode:0o700});
    const alternate=path.join(prefix,'alternate','docker');
    if(alternateDocker){
        await fs.mkdir(path.dirname(alternate),{mode:0o700});
        await fs.copyFile(client,alternate);
    }
    await fs.writeFile(path.join(prefix,'opt/docker-buildx/bin/docker-buildx'),'#!'+process.execPath+'\n',{mode:0o700});
    const c=await openController({installationHome:home}),startup=ApplicationStartup.open(c),conversation=c.createConversation();
    c.setConversationView({selectedId:conversation.conversationId});
    if(locale==='ko')c.setConversationLanguage({conversationId:conversation.conversationId,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    if(!firstRun)await startup.save({version:1,runtime:{dockerBinary:client,dockerConfigDirectory:config,dockerContext:missingContext?'missing':failContext??'owned',image:oldImage,memoryMiB:2048}});
    await c.close();
    const saved=firstRun?null:await fs.readFile(path.join(home,'config/startup.json'),'utf8');
    const guard=path.join(root,'guard.mjs');await fs.writeFile(guard,`
import ${JSON.stringify(new URL('../cli/account-ui-no-network.mjs',import.meta.url).href)};
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn,allowed=${JSON.stringify([...['docker','colima','brew'].map(n=>path.join(prefix,'bin',n)),...(alternateDocker?[alternate]:[])])};let group;
cp.spawn=(file,...rest)=>{if(!allowed.includes(file))throw Error('Only owned preparation tools may execute');const child=spawn(file,...rest);if(file===${JSON.stringify(client)}&&rest[0][4]==='build')group=child.pid;return child;};
${denyCleanup?"const kill=process.kill.bind(process);process.kill=(pid,signal)=>{if(pid===-group){const error=Error('Controlled denied native cleanup');error.code='EPERM';throw error;}return kill(pid,signal);};":''}
syncBuiltinESMExports();
${observeStartup?`import fs from 'node:fs/promises';
import {ApplicationStartup} from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(await fs.realpath(cliEntry)),'../app/startup.js')).href)};
const inspect=ApplicationStartup.prototype.inspect;ApplicationStartup.prototype.inspect=async function(...args){const view=await inspect.apply(this,args);await fs.appendFile(${JSON.stringify(inspections)},JSON.stringify(view)+'\\n');return view;};
`:''}
`);
    let passed=false;
    t.after(async()=>{
        const observation=await fs.readFile(held,'utf8').then(JSON.parse,()=>undefined);
        if(observation)try{process.kill(-observation.group,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
        if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained preparation PTY '+root);
    });
    const env={PATH:path.join(prefix,'bin')+':'+path.dirname(process.execPath)+':/usr/bin:/bin',HOME:owner,GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:'',DOCKER_HOST:'POISONED_AMBIENT',DOCKER_CONTEXT:'POISONED_AMBIENT'};
    const empty=['works','runs','conversation_inputs'].map(table=>({sql:'SELECT COUNT(*) FROM '+table,rows:[[0]]}));
    return {root,home,owner,config,configText,client,alternate,calls,inspections,held,release,drift,saved,guard,env,empty,engineReady,pass(){passed=true;}};
}
async function launch(f,label,steps,{standalone=false,standaloneEntry,expectedExit=0}={}) {
    const file=path.join(f.root,label+'.json');
    const entry = standalone ? standaloneEntry ?? await fs.realpath('runtime/setup.mjs') : cliEntry;
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',f.guard,entry,...standalone?['--home',f.home]:[]],
        env:f.env,steps,timeoutSeconds:12,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output:file+'.terminal',gracefulShutdownSeconds:3}));
    const result=JSON.parse((await execute('python3',['tests/cli/fork-ui-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(result.stages,steps.length);assert.equal(result.exitCode,expectedExit);assert.equal(result.terminalRestored,true);
    return fs.readFile(file+'.terminal','utf8');
}
const open=[{wait:'Model: not selected',send:'/setup runtime\x1b\r'}];
const startBuild=[{wait:'Runtime setup · staged',send:'Prepare an execution image\r'},{wait:'Continue to confirmation',send:'\r'},{wait:'Build execution image?',send:'Build execution image\r'}];
const save=[{wait:'Runtime setup · staged',send:'Review and save runtime\r'},{wait:'Review runtime setup before applying',send:'\r'},{wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},{wait:'Runtime saved and applied',send:'/quit\x1b\r'}];
const dockerPhase = ({args}) => args[2] === 'context' ? args[3] : args[4];
const buildPhases = ['inspect', 'version', 'inspect', 'build', 'inspect'];

for (const boundary of ['review','confirmation']) test('runtime check retires changed route metadata at '+boundary, {timeout:20000}, async t => {
    const f=await fixture(t);
    const armed=path.join(f.root,'change-checked-route'), changed=path.join(f.root,'checked-route-changed');
    const stale='Last check · Docker route changed · check again';
    const savedFile=path.join(f.home,'config/startup.json');
    const unchanged={queries:f.empty,textFiles:[{path:savedFile,value:f.saved}]};
    const mutate=async()=>{
        for await (const _event of fs.watch(f.root,{signal:AbortSignal.timeout(12000)})) {
            if (!await fs.stat(armed).then(()=>true,()=>false)) continue;
            await fs.writeFile(path.join(f.config,'config.json'),JSON.stringify({...JSON.parse(f.configText),HttpHeaders:{Fixture:'changed'}}));
            await fs.writeFile(changed,'changed');
            return;
        }
    };
    const arrived=[{path:changed,value:'changed'}];
    const scenario=[
        ...open,
        {wait:'Runtime setup · staged',send:'Check runtime connection and image\r'},
        {wait:'Continue to confirmation',send:'\r'},
        {wait:'Check selected runtime?',send:'Check connection and image\r'},
        ...boundary==='review'?[
            {wait:'Docker connection and image found',releaseFile:armed,send:'Inspect current runtime\r'},
            {wait:'Current runtime · read only',waitFiles:arrived,send:'\x1b'},
            {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
        ]:[
            {wait:'Docker connection and image found',send:'Review and save runtime\r'},
            {wait:'Open settings confirmation',releaseFile:armed,send:'\r'},
            {wait:'Explicit runtime setup action',waitFiles:arrived,send:'Save and apply runtime\r'},
            {wait:stale,...unchanged,send:'Review and save runtime\r'},
        ],
        {wait:stale,...unchanged,send:'\r'},
        {wait:'Check connection and image first',...unchanged,send:'Save and apply runtime\r'},
        {wait:'Runtime saved and applied',queries:f.empty,send:'/quit\x1b\r'},
    ];
    await Promise.all([mutate(),launch(f,'retire-check-'+boundary,scenario)]);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase),['inspect','version','inspect','image','inspect']);
    assert.deepEqual(JSON.parse(await fs.readFile(savedFile,'utf8')),JSON.parse(f.saved));
    f.pass();
});

for (const locale of ['en','ko']) test('empty image inventory can build from the observed route in '+locale, {timeout:20000}, async t => {
    const f = await fixture(t,{firstRun:true,emptyImages:true,locale});
    const label = (key, values) => uiText(locale,key,...values?[values]:[]);
    const choose = (key, value) => ({wait:label(key),send:label(value)+'\r'});
    const preserve = {queries:f.empty,assertDraft:'/setup runtime'};
    const emptyTitle = locale==='en'?'No images found in Docker context':'Docker 컨텍스트에 이미지가 없습니다';
    const discover = [
        choose('runtime.title','runtime.image'),
        {wait:label('runtime.dockerField'),send:f.client+'\r'},
        {wait:label('runtime.contextField'),send:'owned\r'},
        {wait:label('runtime.discoveryConfigField'),send:f.config+'\r'},
        {wait:label('review.confirm'),send:'\r'},
        choose('runtime.discoverTitle','runtime.discoverConfirm'),
    ];
    await launch(f,'empty-discovery',[
        {wait:label('footer.setup'),send:'/setup runtime\x1b\r'},
        ...discover,
        {wait:emptyTitle,...preserve,send:'\r'},
        ...discover,
        {wait:emptyTitle,...preserve,send:label('runtime.build')+'\r'},
        {wait:label('review.confirm'),...preserve,send:'\r'},
        locale==='en' ? choose('runtime.buildTitle','runtime.buildConfirm') : {wait:label('runtime.buildTitle'),...preserve,send:'\r'},
        ...locale==='en'?[
            {wait:'OWNED_BUILD_OUTPUT',releaseFile:f.release,send:''},
            {wait:JSON.stringify(image),...preserve,send:label('runtime.cancel')+'\r'},
        ]:[{...choose('runtime.title','runtime.cancel'),...preserve}],
        {wait:label('interaction.commandCancelled',{submit:'Enter'}),send:'\x15/quit\x1b\r'},
    ]);
    const calls = (await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    const discoveryPhases = ['inspect','image','inspect','image','inspect'];
    assert.deepEqual(calls.map(dockerPhase),[...discoveryPhases,...discoveryPhases,...locale==='en'?buildPhases:[]]);
    assert.ok(calls.every(({name,args})=>name==='docker'&&args[1]===f.config&&(args[2]==='context'?args.at(-1):args[3])==='owned'));
    await assert.rejects(fs.access(path.join(f.home,'config/startup.json')),{code:'ENOENT'});
    f.pass();
});

test('first-run existing Docker accepts the selected configuration context and never dispatches to default',{timeout:20000},async t=>{
    const f=await fixture(t,{firstRun:true});
    const output=await launch(f,'existing-context',[
        ...open,{wait:'Runtime setup · staged',send:'Interactive runtime installer\r'},
        {wait:'Existing Docker backend',send:'\x151\r'},
        {wait:'Docker executable',send:'\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Docker context',send:'\r'},
        {wait:'Create this Docker configuration directory',send:'\x15n\r'},
        {wait:'Build the installed execution image now?',send:'\x15y\r'},
        {wait:'OWNED_BUILD_OUTPUT',queries:f.empty,releaseFile:f.release,send:''},
        ...save,
    ]);
    assert.doesNotMatch(output,/Default Docker socket is unavailable/);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(call=>[call.name,call.args[2]==='context'?call.args.at(-1):call.args[3]]),Array.from({length:buildPhases.length},()=>['docker','owned']));
    assert.deepEqual(calls.map(dockerPhase),buildPhases);
    assert.ok(calls.every(call=>call.ambient===undefined&&call.args[1]===f.config));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8')).runtime,
        {dockerBinary:f.client,dockerConfigDirectory:f.config,dockerContext:'owned',image});
    assert.equal(await fs.readFile(path.join(f.config,'config.json'),'utf8'),f.configText);
    await assert.rejects(fs.access(path.join(f.owner,'.colima')),{code:'ENOENT'});
    f.pass();
});

for(const engineFailure of ['exit','signal']) test('interactive installer retries the unavailable Docker connection after '+engineFailure, {timeout:20000}, async t => {
    const f = await fixture(t, {engineFailure});
    const retry = uiText('en', 'runtime.install.retryBuildConnection');
    const output=await launch(f, 'retry-server', [
        ...open, {wait:'Runtime setup · staged',send:'Interactive runtime installer\r'},
        {wait:'Existing Docker backend',send:'\x151\r'},
        {wait:'Docker executable',send:'\r'}, {wait:'Docker configuration directory',send:'\r'},
        {wait:'Docker context',send:'\r'}, {wait:'Create this Docker configuration directory',send:'\x15n\r'},
        {wait:'Build the installed execution image now?',send:'\x15y\r'},
        {wait:'Open recovery actions',send:'\r'},
        {wait:retry,releaseFile:f.engineReady,queries:f.empty,send:retry+'\r'},
        {wait:'OWNED_BUILD_OUTPUT',releaseFile:f.release,send:''},
        {wait:JSON.stringify(image),queries:f.empty,assertDraft:'/setup runtime',send:'Cancel\r'},
        {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
    ]);
    assert.match(output,engineFailure==='signal'?/SIGTERM/:/OWNED_ENGINE_UNREACHABLE/);
    const calls = (await fs.readFile(f.calls, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase), ['inspect', 'version', 'inspect', ...buildPhases]);
    assert.ok(calls.every(call => call.name === 'docker' && call.args[1] === f.config));
    assert.equal(await fs.readFile(path.join(f.home, 'config/startup.json'), 'utf8'), f.saved);
    f.pass();
});

test('Escape from an installer failure returns to the runtime form without opening recovery actions',{timeout:20000},async t=>{
    const f=await fixture(t,{engineFailure:'exit'});
    const output=await launch(f,'dismiss-installer-failure',[
        ...open, {wait:'Runtime setup · staged',send:'Interactive runtime installer\r'},
        {wait:'Existing Docker backend',send:'\x151\r'},
        {wait:'Docker executable',send:'\r'}, {wait:'Docker configuration directory',send:'\r'},
        {wait:'Docker context',send:'\r'}, {wait:'Create this Docker configuration directory',send:'\x15n\r'},
        {wait:'Build the installed execution image now?',send:'\x15y\r'},
        {wait:'Docker connection check failed · image build did not start',send:'\x1b'},
        {wait:'Runtime setup · staged',queries:f.empty,assertDraft:'/setup runtime',send:'Cancel\r'},
        {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
    ]);
    assert.match(output,/Open recovery actions/);
    assert.doesNotMatch(output,/Retry connection check and build/);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase),['inspect','version','inspect']);
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    f.pass();
});

for(const surface of ['editor','installer','check'])test('missing selected context offers correction in '+surface,{timeout:20000},async t=>{
    const installer=surface==='installer',check=surface==='check';
    const f=await fixture(t,{missingContext:true});
    const choice=installer?'Correct Docker route':'Choose Docker context';
    const recovery=installer?'Choose image build recovery':'Choose a recovery action';
    const output=await launch(f,'missing-context',[
        ...open,
        ...installer?[
            {wait:'Runtime setup · staged',send:'Interactive runtime installer\r'},
            {wait:'Existing Docker backend',send:'\x151\r'},
            {wait:'Docker executable',send:'\r'}, {wait:'Docker configuration directory',send:'\r'},
            {wait:'Docker context',send:'\r'}, {wait:'Create this Docker configuration directory',send:'\x15n\r'},
            {wait:'Build the installed execution image now?',send:'\x15y\r'},
        ]:check? [
            {wait:'Runtime setup · staged',send:'Check runtime connection and image\r'},
            {wait:'Continue to confirmation',send:'\r'},
            {wait:'Check selected runtime?',send:'Check connection and image\r'},
        ]:startBuild,
        {wait:check?'Docker context could not be verified · connection and image were not checked':'Docker context could not be verified · image build did not start',queries:f.empty,send:'\r'},
        {wait:choice,send:'\x1b'},
        {wait:check?'Last check · Docker context unverified':'Runtime setup · staged',assertDraft:'/setup runtime',send:'Cancel\r'},
        {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
    ]);
    assert.ok(output.includes(recovery));
    assert.doesNotMatch(output,/PRIVATE_CONTEXT_DIAGNOSTIC|Retry connection check and build/);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase),['inspect']);
    assert.equal(calls[0].args.at(-1),'missing');
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    f.pass();
});

test('original terminal Build/Back, bounded live output and elapsed time stage an ID before explicit Save',{timeout:20000},async t=>{
    const f=await fixture(t,{largeOutput:true});
    const output=await launch(f,'build',[
        ...open,{wait:'Runtime setup · staged',send:'Extra image packages\r'},
        {wait:'Extra Debian packages for the next image build',send:'python3;echo\r'},
        {wait:'Correct image package names',send:'\x1b'},
        {wait:'Extra Debian packages for the next image build',send:'\x15python3 build-essential\r'},
        startBuild[0],{...startBuild[1],send:'\x1b'},
        ...startBuild.slice(0,-1),{wait:'Build execution image?',send:'\r'},...startBuild,
        {wait:'Running · 1s',queries:f.empty,assertDraft:'/setup runtime',releaseFile:f.release,send:''},
        ...save.slice(0,-1),{...save.at(-1),queries:f.empty},
    ]);
    assert.match(output,/Esc cancels local execution/);assert.match(output,/Running · 1s/);assert.match(output,/OWNED_BUILD_OUTPUT/);assert.match(output,/Earlier output omitted · showing latest output/);
    const current=JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'));
    assert.equal(current.runtime.image,image);assert.equal(current.runtime.memoryMiB,2048);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase),buildPhases);
    assert.ok(calls.every(call=>call.ambient===undefined));
    assert.ok(calls.find(call=>dockerPhase(call)==='build').args.includes('GITJIG_EXTRA_PACKAGES=python3 build-essential'));
    const held=JSON.parse(await fs.readFile(f.held));assert.deepEqual(held.files.sort(),['Dockerfile','Dockerfile.dockerignore','io-helper.mjs']);await assert.rejects(fs.access(held.context));f.pass();
});

test('Escape from Colima failure does not reopen the route picker or restart preparation',{timeout:20000},async t=>{
    const f=await fixture(t,{failFirstColima:true});
    const output=await launch(f,'dismiss-colima-failure',[
        ...open,{wait:'Runtime setup · staged',send:'Interactive runtime installer\r'},
        {wait:'Existing Docker backend',send:'\x152\r'},
        {wait:'Install/repair Colima',send:'\x15n\r'},
        {wait:'Colima profile',send:'\x15build\r'},
        {wait:'Run Colima preparation now',send:'\r'},
        {wait:'Open recovery actions',queries:f.empty,send:'\x1b'},
        {wait:'Runtime setup · staged',assertDraft:'/setup runtime',send:'Cancel\r'},
        {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
    ]);
    assert.match(output,/downloading disk image/);
    assert.doesNotMatch(output,/Choose another runtime preparation route|Retry existing Colima profile/);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(call=>call.name),['colima']);
    assert.equal(await fs.readFile(path.join(f.owner,'.colima/build/colima.yaml'),'utf8'),retainedColimaSettings);
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    f.pass();
});

for(const close of [false,true])test('actual terminal '+(close?'close':'Escape')+' joins preparation descendants, keeps old settings and preserves its draft',{timeout:20000},async t=>{
    const f=await fixture(t);
    const steps=[...open,...startBuild,{wait:'OWNED_BUILD_OUTPUT',queries:f.empty,assertDraft:'/setup runtime',...close?{terminate:true,send:''}:{send:'\x1b'}}];
    if(!close)steps.push({wait:'Image preparation stopped · previous staged values retained',send:'\x1b'},
        {wait:'Runtime setup · staged',send:'Cancel\r'},{wait:'Command cancelled · draft kept',queries:f.empty,assertDraft:'/setup runtime',terminate:true,send:''});
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
        {wait:'Build the installed execution image now?',send:'\x15y\r'},
        {wait:'OWNED_BUILD_OUTPUT',queries:f.empty,releaseFile:f.release,send:''},...save,
    ]);
    const current=JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'));
    assert.match(output,/Starting selected Colima profile/);assert.match(output,/Building execution image/);
    assert.equal(current.runtime.dockerContext,'colima-build');assert.equal(current.runtime.image,image);
    assert.equal(await fs.readFile(path.join(f.config,'config.json'),'utf8'),'{"currentContext":"keep","auths":{}}');
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(c=>c.name),['brew','brew','colima',...buildPhases.map(()=> 'docker')]);
    assert.deepEqual(calls.slice(3).map(dockerPhase),buildPhases);
    assert.deepEqual(calls[0].args,['install','colima','docker','docker-buildx']);assert.ok(calls[2].args.includes('--activate=false'));
    f.pass();
});

for(const standalone of [false,true])test((standalone?'standalone':'in-app')+' wizard refuses a changed canonical Docker path after build review',{timeout:20000},async t=>{
    const f=await fixture(t,{failNative:true,alternateDocker:true});
    const alias=path.join(f.root,'client-alias'),arm=path.join(f.root,'build-review'),changed=path.join(f.root,'route-changed');
    await fs.symlink(f.client,alias);
    const steps=[
        ...(standalone?[]:[...open,{wait:'Runtime setup · staged',send:'Interactive runtime installer\r'}]),
        {wait:standalone?'Choose [':'Existing Docker backend',send:standalone?'1\r':'\x151\r'},
        {wait:'Docker executable',send:(standalone?'':'\x15')+alias+'\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Docker context',send:'\r'},
        {wait:'Create this Docker configuration directory',send:standalone?'n\r':'\x15n\r'},
        {wait:'Build the installed execution image now?',releaseFile:arm,send:''},
        {wait:'',waitFiles:[{path:changed,value:'changed'}],send:standalone?'y\r':'\x15y\r'},
        ...(standalone?[{wait:'Reviewed Docker route changed',send:''}]:[
            {wait:'Open recovery actions',queries:f.empty,send:'\x1b'},
            {wait:'Runtime setup · staged',assertDraft:'/setup runtime',send:'Cancel\r'},
            {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
        ]),
    ];
    const [output]=await Promise.all([launch(f,'wizard-reviewed-route',steps,{standalone,expectedExit:standalone?1:0}),
        replacePathAfterReview(f.root,arm,changed,f.client,f.alternate)]);
    assert.match(output,/Reviewed Docker route changed/);
    const review=stripVTControlCharacters(output).replace(/\s/gu,'');
    assert.ok(review.includes(('Executable: '+JSON.stringify(f.client)).replace(/\s/gu,'')));
    await assert.rejects(fs.access(f.calls));
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    f.pass();
});

for(const locale of ['en','ko'])test(locale+' Colima download failure resumes the saved profile without repeating packages or rewriting its configuration',{timeout:20000},async t=>{
    const f=await fixture(t,{failFirstColima:true,locale});
    const text=(id,values)=>uiText(locale,id,...values?[values]:[]);
    const wizard=(id,values)=>text('runtime.install.'+id,values);
    const retry=wizard('retryExisting',{profile:'build'});
    const approve=locale==='ko'?'예':'y';
    const output=await launch(f,'colima-download-retry',[
        {wait:text('model.unselected'),send:'/setup runtime\x1b\r'},
        {wait:text('runtime.title'),send:text('runtime.install')+'\r'},
        {wait:wizard('chooseRoute').split('\n')[0],send:'\x152\r'},
        {wait:wizard('installPackages'),send:'\x15'+approve+'\r'},
        {wait:wizard('colimaProfile'),send:'\x15build\r'},
        {wait:wizard('prepareColima'),send:'\r'},
        {wait:text('runtime.openRecovery'),send:'\r'},
        {wait:retry,send:retry+'\r'},
        {wait:wizard('build'),send:'\x15'+approve+'\r'},
        {wait:'OWNED_BUILD_OUTPUT',queries:f.empty,releaseFile:f.release,send:''},
        {wait:text('runtime.title'),send:text('runtime.review')+'\r'},
        {wait:text('common.openSettingsConfirmation'),send:'\r'},
        {wait:text('runtime.saveTitle'),send:text('runtime.save')+'\r'},
        {wait:text('runtime.saved'),send:'/quit\x1b\r'},
    ]);
    assert.match(output,/downloading disk image/);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(call=>call.name),['brew','brew','colima','colima',...buildPhases.map(()=> 'docker')]);
    assert.deepEqual(calls.slice(4).map(dockerPhase),buildPhases);
    assert.deepEqual(calls[2].args,['start','--profile','build','--runtime','docker','--activate=false']);
    assert.deepEqual(calls[3].args,['start','--profile','build','--save-config=false','--activate=false']);
    assert.equal(await fs.readFile(path.join(f.owner,'.colima/build/colima.yaml'),'utf8'),retainedColimaSettings);
    const current=JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'));
    assert.equal(current.runtime.dockerContext,'colima-build');
    assert.equal(current.runtime.image,image);
    assert.equal(await fs.readFile(path.join(f.config,'config.json'),'utf8'),f.configText);
    f.pass();
});

for(const close of [false,true])test('standalone interactive helper '+(close?'handles SIGTERM without a detached build':'uses original captured startup Save') ,{timeout:20000},async t=>{
    const f=await fixture(t);
    const steps=[{wait:'Choose [',send:'1\r'},{wait:'Docker executable [',send:'\r'},{wait:'Docker configuration directory [',send:'\r'},
        {wait:'Docker context [',send:'\r'},{wait:'Create this Docker configuration directory',send:'n\r'},
        {wait:'Build the installed execution image now?',send:'y\r'},
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
        {wait:'Build the installed execution image now?',send:'y\r'},
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

test('standalone runtime installer follows the terminal locale through a symlink while library import stays inert',{timeout:10000},async t=>{
    const f=await fixture(t);
    const helper = await fs.realpath('runtime/setup.mjs'), alias = path.join(f.root,'실행 환경 설정.mjs');
    await fs.symlink(helper,alias);
    const probe = path.join(f.root,'import-runtime.mjs');
    await fs.writeFile(probe,`import * as setup from ${JSON.stringify(pathToFileURL(alias).href)}; console.log(typeof setup.interactiveSetup);\n`);
    const imported = await execute(process.execPath,['--import',f.guard,probe,'--help'],{env:f.env,timeout:5000});
    assert.equal(imported.stdout,'function\n');
    assert.equal(imported.stderr,'');
    const help = await execute(process.execPath,[helper,'--help'],{env:f.env,timeout:5000});
    assert.match(help.stdout,/^Usage: node runtime\/setup\.mjs/);
    f.env.LANG='ko_KR.UTF-8';
    const output=await launch(f,'standalone-korean',[{wait:'번호 선택 [',send:'3\r'}],{standalone:true,standaloneEntry:alias});
    assert.ok(output.includes(uiText('ko','runtime.install.standaloneControls')));
    assert.ok(output.includes('기존 Docker 백엔드 사용'));
    await assert.rejects(fs.access(f.calls));
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    f.pass();
});

test('standalone preserves unknown native cleanup as exit2 with its original group',{timeout:15000},async t=>{
    const f=await fixture(t,{denyCleanup:true});
    const output=await launch(f,'standalone-unknown',[
        {wait:'Choose [',send:'1\r'},{wait:'Docker executable [',send:'\r'},{wait:'Docker configuration directory [',send:'\r'},
        {wait:'Docker context [',send:'\r'},{wait:'Create this Docker configuration directory',send:'n\r'},
        {wait:'Build the installed execution image now?',send:'y\r'},{wait:'OWNED_BUILD_OUTPUT',terminate:true,send:''},
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
    const calls = (await fs.readFile(f.calls, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase), ['inspect', 'version', 'inspect', 'build']);
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    process.kill(-held.group,'SIGKILL');
    const deadline=Date.now()+1000;while(Date.now()<deadline){try{process.kill(-held.group,0);}catch(error){if(error.code==='ESRCH')break;throw error;}await new Promise(r=>setTimeout(r,10));}
    assert.throws(()=>process.kill(-held.group,0),{code:'ESRCH'});f.pass();
});

test('actual terminal checks selected engine/image and keeps saved runtime and original draft',{timeout:20000},async t=>{
    const f=await fixture(t);const output=await launch(f,'metadata-check',[
        ...open,{wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
        {wait:'Docker executable',send:'\r'},
        {wait:'Docker context',send:'\r'},
        {wait:'Runtime image',send:'\x15latest\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Runtime setup · staged',send:'Check runtime connection and image\r'},
        {wait:'Open recovery actions',queries:f.empty,send:'\r'},
        {wait:'Choose a recovery action',send:'Edit runtime fields\r'},
        {wait:'Docker executable',send:'\r'},
        {wait:'Docker context',send:'\x15default\r'},
        {wait:'Runtime image',send:'\x15'+oldImage+'\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Runtime setup · staged',send:'Check runtime connection and image\r'},
        {wait:'The default Docker context inherits',queries:f.empty,send:'\r'},
        {wait:'Choose a recovery action',send:'Edit runtime fields\r'},
        {wait:'Docker executable',send:'\r'},
        {wait:'Docker context',send:'\x15owned\r'},
        {wait:'Runtime image',send:'\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Runtime setup · staged',send:'Check runtime connection and image\r'},
        {wait:'Continue to confirmation',queries:f.empty,send:'\x1b'},
        {wait:'Runtime setup · staged',send:'Check runtime connection and image\r'},
        {wait:'Continue to confirmation',queries:f.empty,send:'\r'},
        {wait:'Check selected runtime?',send:'Check connection and image\r'},
        {wait:'Runtime setup · staged',queries:f.empty,assertDraft:'/setup runtime',send:'Cancel\r'},
        {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
    ]);
    assert.match(output,/No check started/);assert.match(output,/Select an immutable image ID or digest/);
    assert.doesNotMatch(output,/POISONED_AMBIENT/);
    assert.match(output,/Checking selected runtime/);assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase),['inspect','version','inspect','image','inspect']);
    assert.deepEqual([calls[1],calls[3]].map(c=>c.args.slice(4,6)),[['version','--format'],['image','inspect']]);await assert.rejects(fs.access(f.held));f.pass();
});

for(const action of ['Prepare an execution image','Check runtime connection and image'])test('actual terminal '+action+' failure opens selected repair immediately',{timeout:20000},async t=>{
 const f=await fixture(t,{failNative:true}),check=action.startsWith('Check');const output=await launch(f,'repair-'+(check?'check':'build'),[
  ...open,{wait:'Runtime setup · staged',send:action+'\r'},
  {wait:'Continue to confirmation',send:'\r'},
  {wait:check?'Check selected runtime?':'Build execution image?',send:(check?'Check connection and image':'Build execution image')+'\r'},
  {wait:'Open recovery actions',queries:f.empty,send:'\r'},
  {wait:'Choose a recovery action',send:'Edit runtime fields\r'},
  {wait:'Docker executable · canonical absolute path',send:'\r'},
  {wait:'Docker context · explicit name',send:'\r'},
  {wait:'Runtime image · immutable',send:'\r'},
  {wait:'Docker configuration directory · canonical path',send:'\r'},
  {wait:'Runtime setup · staged',queries:f.empty,assertDraft:'/setup runtime',send:'Cancel\r'},
  {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
 ]);
 assert.match(output,/OWNED_CONTEXTUAL_FAILURE/);assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
 const calls = (await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(calls.map(dockerPhase),['inspect','version','inspect']);
 await assert.rejects(fs.access(f.held));f.pass();
});

for (const locale of ['en','ko']) test('terminal distinguishes image observation failure and retries the same reviewed route in '+locale,{timeout:20000},async t=>{
    const f=await fixture(t,{locale,waitForImage:true}), label=(key,values)=>uiText(locale,key,values);
    const preserve={queries:f.empty,assertDraft:'/setup runtime'};
    const choose=(wait,action)=>({wait:label(wait),...preserve,send:label(action)+'\r'});
    const review=[{wait:label('review.confirm'),...preserve,send:'\r'},choose('runtime.checkTitle','runtime.checkConfirm')];
    const recover={wait:label('runtime.openRecovery'),...preserve,send:'\r'};
    const title=locale==='ko'?'Docker 응답 확인 · 이미지 확인 불가':'Docker responded · image could not be verified';
    const retained=locale==='ko'?'마지막 확인 · Docker 응답 확인 · 이미지 확인 불가':'Last check · Docker responded · image unverified';
    const output=await launch(f,'retry-image-check',[
        {wait:label('footer.setup'),send:'/setup runtime\x1b\r'},
        choose('runtime.title','runtime.check'),...review,
        {...recover,send:'\x1b'},
        {wait:retained,...preserve,send:label('runtime.check')+'\r'},...review,
        recover,{...choose('runtime.recovery','runtime.check'),releaseFile:f.engineReady},...review,
        choose('runtime.checkFound','runtime.cancel'),
        {wait:label('interaction.commandCancelled',{submit:''}).split(' · ').slice(0,2).join(' · '),send:'\x15/quit\x1b\r'},
    ]);
    assert.ok(output.includes(title)&&output.includes('OWNED_IMAGE_NOT_VERIFIED'));
    const recoveryMenu=output.indexOf(label('runtime.recovery'));
    assert.ok(output.slice(recoveryMenu,output.indexOf(label('review.confirm'),recoveryMenu)).includes(label('runtime.image')));
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase),Array(3).fill(['inspect','version','inspect','image','inspect']).flat());
    assert.deepEqual(calls.filter(call=>dockerPhase(call)==='image').map(call=>[call.args[3],call.args.at(-1)]),Array(3).fill(['owned',oldImage]));
    await assert.rejects(fs.access(f.held)); f.pass();
});

for (const locale of ['en','ko']) test('runtime check failure stays visible through review and clears on editing in '+locale, {timeout:20000}, async t => {
    const f = await fixture(t,{failNative:true,locale});
    const tKey = key => uiText(locale,key), editor = tKey('runtime.title'), failed = tKey('runtime.checkFailed');
    const preserve = {queries:f.empty,assertDraft:'/setup runtime'};
    const output = await launch(f,'retained-check',[
        {wait:tKey('footer.setup'),send:'/setup runtime\x1b\r'},
        {wait:editor,send:tKey('runtime.check')+'\r'},
        {wait:tKey('review.confirm'),send:'\r'},
        {wait:tKey('runtime.checkTitle'),send:tKey('runtime.checkConfirm')+'\r'},
        {wait:tKey('runtime.openRecovery'),...preserve,send:'\x1b'},
        {wait:failed,...preserve,send:tKey('runtime.inspectCheck')+'\r'},
        {wait:'OWNED_CONTEXTUAL_FAILURE',...preserve,send:'\x1b'},
        {wait:failed,...preserve,send:tKey('runtime.review')+'\r'},
        {wait:tKey('common.openSettingsConfirmation'),...preserve,send:'\r'},
        {wait:tKey('runtime.saveTitle'),...preserve,send:tKey('runtime.backSave')+'\r'},
        {wait:failed,send:tKey('runtime.edit')+'\r'},
        {wait:tKey('runtime.dockerField'),send:'\r'},
        {wait:tKey('runtime.contextField'),send:'\r'},
        {wait:tKey('runtime.imageField'),send:'\x15latest\r'},
        {wait:tKey('runtime.configField'),send:'\r'},
        {wait:tKey('runtime.noCheckResult'),...preserve,send:tKey('runtime.check')+'\r'},
        {wait:tKey('runtime.openRecovery'),...preserve,send:'\x1b'},
        {wait:tKey('runtime.checkNotStartedStatus'),...preserve,send:tKey('runtime.cancel')+'\r'},
        {wait:tKey('footer.setup'),...preserve,send:'\x15/quit\x1b\r'},
    ]);
    const confirmation = output.slice(output.indexOf(tKey('runtime.saveTitle')));
    assert.ok(confirmation.includes(failed));
    assert.ok(output.includes(uiText(locale,'runtime.checkConnectionFailed',{context:'"owned"'})));
    const calls = (await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(dockerPhase),['inspect','version','inspect']);
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
    f.pass();
});

test('actual terminal missing Homebrew explains the blocker and switches directly to existing Docker',{timeout:20000},async t=>{
 const f=await fixture(t);await fs.unlink(path.join(f.root,'tools/bin/brew'));const output=await launch(f,'missing-brew-switch',[
  ...open,{wait:'Runtime setup · staged',send:'Interactive runtime installer\r'},
  {wait:'Existing Docker backend',send:'\x152\r'},
  {wait:'Install/repair Colima',send:'\x15y\r'},
  {wait:'Open recovery actions',queries:f.empty,send:'\r'},
  {wait:'Choose another runtime preparation route',send:'Use existing Docker backend\r'},
  {wait:'Docker executable',send:'\r'},{wait:'Docker configuration directory',send:'\r'},
  {wait:'Docker context',send:'\r'},{wait:'Create this Docker configuration directory',send:'\x15n\r'},
  {wait:'Build the installed execution image now?',send:'\r'},
  {wait:'Runtime setup · staged',queries:f.empty,assertDraft:'/setup runtime',send:'Cancel\r'},
  {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
 ]);
 assert.match(output,/Use existing Docker backend/);assert.match(output,/Requested Docker route/);assert.ok(output.includes('Context: "owned"'));
 assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);await assert.rejects(fs.access(f.calls));f.pass();
});

for(const locale of ['en','ko'])test(locale+' interactive installer shows the failed route and requires fresh build consent after correction',{timeout:20000},async t=>{
 const f=await fixture(t,{failContext:'broken',locale});
 const text=(id,values)=>uiText(locale,id,...values?[values]:[]);
 const wizard=(id,values)=>text('runtime.install.'+id,values);
 const correction=wizard('correctRoute');
 const no=locale==='ko'?'아니요':'n';
 const output=await launch(f,'installer-correct-route',[
  {wait:text('model.unselected'),send:'/setup runtime\x1b\r'},
  {wait:text('runtime.title'),send:text('runtime.install')+'\r'},
  {wait:wizard('chooseRoute').split('\n')[0],send:'\x151\r'},
  {wait:wizard('executable'),send:'\r'},{wait:wizard('configDirectory'),send:'\r'},
  {wait:wizard('context'),send:'\r'},{wait:wizard('createConfig'),send:'\x15'+no+'\r'},
  {wait:wizard('build'),send:'\x15y\r'},
  {wait:text('runtime.openRecovery'),send:'\r'},
  {wait:correction,send:correction+'\r'},
  {wait:wizard('executable'),send:'\r'},{wait:wizard('configDirectory'),send:'\r'},
  {wait:wizard('context'),send:'\x15owned\r'},{wait:wizard('createConfig'),send:'\x15'+no+'\r'},
  {wait:wizard('buildCorrected'),send:'\r'},
  {wait:text('runtime.title'),queries:f.empty,assertDraft:'/setup runtime',send:text('runtime.cancel')+'\r'},
  {wait:text('interaction.commandCancelled',{submit:'Enter'}),send:'\x15/quit\x1b\r'},
 ]);
 const firstPrompt=output.indexOf(wizard('build'));
 const recovery=output.indexOf(wizard('buildRecovery'),firstPrompt);
 const correctedPrompt=output.indexOf(wizard('buildCorrected'),recovery);
 const unwrapped=text=>stripVTControlCharacters(text).replace(/\s/gu,'');
 for(const [section,context] of [[output.slice(firstPrompt,recovery),'broken'],[output.slice(recovery,correctedPrompt),'broken'],[output.slice(correctedPrompt),'owned']]){
  const visible=unwrapped(section);
  for(const line of wizard('route',{context:JSON.stringify(context),config:JSON.stringify(f.config),binary:JSON.stringify(f.client)}).split('\n').slice(1))
   assert.ok(visible.includes(unwrapped(line)),`Route review did not show ${line}`);
 }
 const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
 assert.ok(calls.every(({name,args})=>name==='docker'&&(args[2]==='context'?args.at(-1):args[3])==='broken'));
 assert.deepEqual(calls.map(dockerPhase),['inspect','version','inspect']);
 assert.ok(calls.every(({args})=>args[0]==='--config'&&args[1]===f.config));
 assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
 await assert.rejects(fs.access(f.held));
 f.pass();
});

for(const kind of ['check','build'])test('runtime '+kind+' refuses a canonical executable redirected after review',{timeout:20000},async t=>{
 const f=await fixture(t,{failNative:true,alternateDocker:true});
 const arm=path.join(f.root,'review-open'), changed=path.join(f.root,'path-changed');
 const check=kind==='check';
 const [output]=await Promise.all([launch(f,'reviewed-route-'+kind,[
  ...open,{wait:'Runtime setup · staged',send:(check?'Check runtime connection and image':'Prepare an execution image')+'\r'},
  {wait:'Continue to confirmation',releaseFile:arm,send:'\r'},
  {wait:check?'Check selected runtime?':'Build execution image?',waitFiles:[{path:changed,value:'changed'}],send:(check?'Check connection and image':'Build execution image')+'\r'},
  {wait:'Open recovery actions',queries:f.empty,send:'\x1b'},
  {wait:'Runtime setup · staged',assertDraft:'/setup runtime',send:'Cancel\r'},
  {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
 ]),replacePathAfterReview(f.root,arm,changed,f.client,f.alternate)]);
 assert.match(output,/Reviewed Docker route changed/);
 await assert.rejects(fs.access(f.calls));
 assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'),f.saved);
 f.pass();
});

test('runtime Save refuses an executable alias changed after review and requires a new review',{timeout:20000},async t=>{
 const f=await fixture(t);
 const alias=path.join(f.root,'reviewed-docker'), replacement=path.join(f.root,'replacement-docker');
 const arm=path.join(f.root,'review-open'), changed=path.join(f.root,'alias-changed');
 await fs.symlink(f.client,alias);
 await fs.copyFile(f.client,replacement);
 const [output]=await Promise.all([launch(f,'reviewed-docker-save',[
  ...open,{wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\x15'+alias+'\r'},
  {wait:'Docker context',send:'\r'},
  {wait:'Runtime image',send:'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged',send:'Review and save runtime\r'},
  {wait:'Review runtime setup before applying',releaseFile:arm,send:'\r'},
  {wait:'Explicit runtime setup action',waitFiles:[{path:changed,value:'changed'}],send:'Save and apply runtime\r'},
  {wait:'Open recovery actions',queries:f.empty,textFiles:[{path:path.join(f.home,'config/startup.json'),value:f.saved}],send:'\r'},
  {wait:'Choose a recovery action',send:'Review and save runtime\r'},
  {wait:'Review runtime setup before applying',send:'\r'},
  {wait:'Explicit runtime setup action',send:'Save and apply runtime\r'},
  {wait:'Runtime saved and applied',queries:f.empty,send:'/quit\x1b\r'},
 ]),replacePathAfterReview(f.root,arm,changed,alias,replacement)]);
 assert.match(output,/Runtime setup save unavailable/);
 const saved=JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'));
 assert.equal(saved.runtime.dockerBinary,replacement);
 await assert.rejects(fs.access(f.calls));
 f.pass();
});

test('failed saved runtime can be corrected, checked and applied in the same original terminal without relaunch',{timeout:20000},async t=>{
 const f=await fixture(t,{failContext:'broken',observeStartup:true});
 const check=[{wait:'Runtime setup · staged',send:'Check runtime connection and image\r'},
  {wait:'Continue to confirmation',send:'\r'},
  {wait:'Check selected runtime?',send:'Check connection and image\r'}];
 const output=await launch(f,'repair-apply',[
  ...open,...check,
  {wait:'Open recovery actions',queries:f.empty,send:'\r'},
  {wait:'Choose a recovery action',send:'Choose Docker context\r'},
  {wait:'Explicit Docker discovery',send:'\r'},
  {wait:'Use this Docker route for discovery?',send:'Discover with this route\r'},
  {wait:'Observed contexts · select to stage',send:'owned\r'},
  {wait:'Staged Docker context · "owned"',send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\r'},
  {wait:'Docker context',send:'\r'},
  {wait:'Runtime image',send:'\x15'+image+'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Runtime setup · staged',send:'\r'},
  ...check.slice(1),
  {wait:'Last check · Docker connection and image found',queries:f.empty,send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\r'},
  {wait:'Docker context',send:'\x15broken\r'},
  {wait:'Runtime image',send:'\x1b'},
  {wait:'Last check · Docker connection and image found',queries:f.empty,send:'Edit runtime fields\r'},
  {wait:'Docker executable',send:'\r'},
  {wait:'Docker context',send:'\r'},
  {wait:'Runtime image',send:'\x15'+oldImage+'\r'},
  {wait:'Docker configuration directory',send:'\r'},
  {wait:'Last check · no successful check for this draft',queries:f.empty,send:'Review and save runtime\r'},
  {wait:'Last check · no successful check for this draft',queries:f.empty,send:'\r'},
  {wait:'Check connection and image first',queries:f.empty,send:'Check connection and image first\r'},
  ...check.slice(1),
  {wait:'Last check · Docker connection and image found',queries:f.empty,send:'\r'},
  {wait:'Last check · Docker connection and image found',queries:f.empty,send:'\r'},
  ...save.slice(2,-1),
  {wait:'Runtime saved and applied',queries:f.empty,send:'/setup inspect\x1b\r'},
  {wait:'Runtime · current process kept',queries:f.empty,send:'\x1b'},
  {wait:'Ctrl+G commands',queries:f.empty,send:'/quit\x1b\r'},
 ]);
 assert.match(output,/OWNED_CONTEXTUAL_FAILURE/);
 assert.match(output,/Docker connection unavailable · "broken"/);
 assert.match(output,/Staged Docker context · "owned"/);
 assert.match(output,new RegExp('Staged image · "'+oldImage+'"'));
 assert.match(output,/Runtime saved and applied for subsequent operations · current process/);
 const expected=JSON.parse(f.saved);expected.runtime={...expected.runtime,dockerContext:'owned',image:oldImage};
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8')),expected);
 const views=(await fs.readFile(f.inspections,'utf8')).trim().split('\n').map(JSON.parse),last=views.at(-1);
 assert.deepEqual(last.saved,expected);assert.deepEqual(last.effective,expected);assert.equal(last.restartRequired,false);assert.equal(last.sources.runtime,'saved');
 const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
 assert.ok(calls.every(call=>call.name==='docker'&&call.ambient===undefined&&call.config===undefined));
 const successfulCheck=[['inspect','owned'],['version','owned'],['inspect','owned'],['image','owned'],['inspect','owned']];
 assert.deepEqual(calls.map(call=>[dockerPhase(call),call.args[2]==='context'?call.args.at(-1):call.args[3]]),
    [['inspect','broken'],['version','broken'],['inspect','broken'],['ls','--quiet'],...successfulCheck,...successfulCheck]);
 assert.deepEqual(calls.filter(call=>call.args[4]==='image').map(call=>call.args.at(-1)),[image,oldImage]);
 assert.equal(await fs.readFile(path.join(f.config,'config.json'),'utf8'),'{"currentContext":"keep","auths":{}}');
 await assert.rejects(fs.access(f.held));f.pass();
});

for (const action of ['Review and save runtime', 'Check runtime connection and image']) test(`${action} discards the old check after an unchanged alias retargets`, {timeout:20000}, async t => {
    const f = await fixture(t, {alternateDocker:true});
    const alias = path.join(f.root, 'staged-docker');
    const arm = path.join(f.root, 'metadata-observed');
    const changed = path.join(f.root, 'alias-retargeted');
    const reviewCheck = 'Review runtime metadata check';
    const unchecked = 'Last check · no successful check for this draft';
    await fs.symlink(f.client, alias);
    const [output] = await Promise.all([launch(f, 'staged-alias', [
        ...open,
        {wait:'Runtime setup · staged',send:'Edit runtime fields\r'},
        {wait:'Docker executable',send:'\x15'+alias+'\r'},
        {wait:'Docker context',send:'\r'},
        {wait:'Runtime image',send:'\r'},
        {wait:'Docker configuration directory',send:'\r'},
        {wait:'Runtime setup · staged',send:'\r'},
        {wait:'Continue to confirmation',send:'\r'},
        {wait:'Check selected runtime?',send:'Check connection and image\r'},
        {wait:'Last check · Docker connection and image found',releaseFile:arm,send:''},
        {wait:'',waitFiles:[{path:changed,value:'changed'}],send:action+'\r'},
        ...(action === 'Review and save runtime' ? [
            {wait:unchecked,send:'\r'},
            {wait:'Check connection and image first',queries:f.empty,send:'Back without saving\r'},
        ] : [{wait:reviewCheck,send:'\x1b'}]),
        {wait:unchecked,queries:f.empty,send:'\r'},
        {wait:reviewCheck,send:'\x1b'},
        {wait:unchecked,queries:f.empty,send:'Cancel\r'},
        {wait:'Command cancelled · draft kept',send:'\x15/quit\x1b\r'},
    ]), replacePathAfterReview(f.root, arm, changed, alias, f.alternate)]);
    assert.ok(output.includes(f.alternate), 'Default recheck reviews the replacement client');
    assert.equal(await fs.readFile(path.join(f.home, 'config/startup.json'), 'utf8'), f.saved);
    const calls = (await fs.readFile(f.calls, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(call => call.args[4] === 'version').length, 1);
    assert.equal(calls.filter(call => call.args[4] === 'image').length, 1);
    f.pass();
});

test('terminal refuses preparation against an inherited default endpoint before contacting Docker', {timeout:20000}, async t=>{
    const f = await fixture(t, {failContext:'default'});
    const editor = {wait:'Runtime setup · staged'};
    const preserve = {assertDraft:'/setup runtime', queries:f.empty};
    const actions = ['Prepare an execution image', 'Check runtime connection and image', 'Choose existing runtime image'];
    const output = await launch(f, 'default-context-editor', [
        ...open,
        ...actions.flatMap(action => [
            {...editor, ...preserve, send:action+'\r'},
            {wait:'Open recovery actions', ...preserve, send:'\x1b'},
        ]),
        {...editor, ...preserve, send:'Cancel\r'},
        {wait:'Command cancelled · draft kept', ...preserve, send:'\x15/quit\x1b\r'},
    ]);
    assert.match(output, /inherits endpoint or TLS settings/);
    assert.doesNotMatch(output, /POISONED_AMBIENT|Build execution image\?|Check selected runtime\?|Discover with this route/);

    const standalone = await launch(f, 'default-context-standalone', [
        {wait:'Existing Docker backend', send:'1\r'},
        {wait:'Docker executable', send:'\r'},
        {wait:'Docker configuration directory', send:'\r'},
        {wait:'Docker context', send:'\r'},
        {wait:'Create this Docker configuration directory', send:'n\r'},
        {wait:'Choose image build recovery', queries:f.empty, send:'1\r'},
    ], {standalone:true});
    assert.match(standalone, /inherits endpoint or TLS settings/);
    assert.doesNotMatch(standalone, /POISONED_AMBIENT|Build the installed execution image now\?/);
    await assert.rejects(fs.access(f.calls), {code:'ENOENT'});
    assert.equal(await fs.readFile(path.join(f.home,'config/startup.json'),'utf8'), f.saved);
    f.pass();
});
