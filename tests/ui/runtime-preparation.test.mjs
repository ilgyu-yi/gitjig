import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {buildImage, prepareColima, runCommand, interactiveSetup} from '../../runtime/setup.mjs';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {editRuntimeFields} from '../../dist/ui/runtime-fields.js';
import {PreparationProgress} from '../../dist/ui/preparation-progress.js';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
import {createNativeEditorFactory} from '../../dist/ui/native-editor.js';

const image='sha256:'+'a'.repeat(64);
async function world(t) {
    const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/runtime-build-'))),config=path.join(root,'docker'),receipt=path.join(root,'receipt');
    await fs.mkdir(config,{mode:0o700});
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    return {root,config,receipt};
}
async function script(file,body) { await fs.writeFile(file,'#!'+process.execPath+'\n'+body,{mode:0o700});return file; }
async function docker(f,body='') {
    return script(path.join(f.root,'docker-client'),`import fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2),context=args.at(-1);fs.writeFileSync(${JSON.stringify(f.receipt)},JSON.stringify({args,files:fs.readdirSync(context)}));${body}fs.writeFileSync(args[args.indexOf('--iidfile')+1],${JSON.stringify(image)});`);
}
test('actual build copies only installed assets, streams output, stages a fresh immutable ID and cleans context',async t=>{
    const f=await world(t),binary=await docker(f,"console.log('Owned build output');");let output='';
    const result=await buildImage({dockerBinary:binary,dockerConfigDirectory:f.config,dockerContext:'owned'},{onOutput:s=>output+=s});
    assert.equal(result.image,image);assert.match(output,/Owned build output/);assert.match(output,/Finished.*\d\.\ds/);
    const receipt=JSON.parse(await fs.readFile(f.receipt));assert.deepEqual(receipt.files.sort(),['Dockerfile','Dockerfile.dockerignore','io-helper.mjs']);
    assert.deepEqual(receipt.args.slice(0,5),['--config',f.config,'--context','owned','build']);
    await assert.rejects(fs.access(path.dirname(receipt.args.at(-1))));
});
test('failed, malformed, cancelled and changed-context builds cannot select an image or leak temporary files',async t=>{
    const f=await world(t),input={dockerConfigDirectory:f.config,dockerContext:'owned'};
    const meta=path.join(f.config,'contexts/meta/owned');await fs.mkdir(meta,{recursive:true});await fs.writeFile(path.join(meta,'meta.json'),'original');
    for(const [body,expected] of [
        ["process.exit(2);",/failed/],
        ["fs.writeFileSync(args[args.indexOf('--iidfile')+1],'latest');process.exit(0);",/immutable/],
        [`fs.writeFileSync(${JSON.stringify(path.join(meta,'meta.json'))},'changed');`,/route changed/],
    ]) {
        const binary=await docker(f,body);await assert.rejects(buildImage({...input,dockerBinary:binary}),expected);
        const receipt=JSON.parse(await fs.readFile(f.receipt));await assert.rejects(fs.access(path.dirname(receipt.args.at(-1))));
    }
    const entered=path.join(f.root,'entered'),childPid=path.join(f.root,'child');
    const binary=await script(path.join(f.root,'held'),`import fs from 'node:fs';import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(childPid)},String(child.pid));fs.writeFileSync(${JSON.stringify(entered)},'yes');setInterval(()=>{},1000);`);
    const abort=new AbortController(),pending=runCommand(binary,[],{signal:abort.signal});
    while(!await fs.access(entered).then(()=>true,()=>false))await new Promise(r=>setTimeout(r,5));
    const observedChild=Number.parseInt(await fs.readFile(childPid,'utf8'),10);
    abort.abort();await assert.rejects(pending,/cancelled/);
    assert.throws(()=>process.kill(observedChild,0),{code:'ESRCH'});
});

test('successful native roots wait for bounded descendant and pipe settlement',async t=>{
    for(const stdio of ['inherit','ignore']) {
        const f=await world(t),pidFile=path.join(f.root,'child-pid');
        const binary=await script(path.join(f.root,'settling'),`import {spawn} from 'node:child_process';import fs from 'node:fs';const child=spawn(process.execPath,['-e','setTimeout(()=>{},300)'],{stdio:${JSON.stringify(stdio)}});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();process.exit(0);`);
        const result=await runCommand(binary,[],{timeoutMs:6000});
        assert.ok(result.durationMs>=250);
        const pid=Number(await fs.readFile(pidFile,'utf8'));
        assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
    }
});
test('persistent descendants fail after grace and cancellation during grace joins before rejecting',async t=>{
    for(const cancel of [false,true]) {
        const f=await world(t),pidFile=path.join(f.root,'child-pid');
        const binary=await script(path.join(f.root,'lingering'),`import {spawn} from 'node:child_process';import fs from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();process.exit(0);`);
        const abort=new AbortController(),began=performance.now();
        const pending=runCommand(binary,[],{signal:abort.signal,timeoutMs:6000});
        if(cancel) {
            const deadline=Date.now()+2000;
            while(!await fs.access(pidFile).then(()=>true,()=>false)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
            assert.ok(await fs.access(pidFile).then(()=>true,()=>false));
            await new Promise(r=>setTimeout(r,100));abort.abort();
        }
        await assert.rejects(pending,cancel?/cancelled/:/unsettled/);
        if(!cancel)assert.ok(performance.now()-began>=2000);
        const pid=Number(await fs.readFile(pidFile,'utf8'));
        assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
    }
});

test('Colima preparation supports Linux/macOS, installs Buildx, preserves client config and never activates ambient context',async t=>{
    const f=await world(t),prefix=path.join(f.root,'prefix'),owner=path.join(f.root,'owner'),calls=path.join(f.root,'calls');
    await fs.mkdir(path.join(prefix,'bin'),{recursive:true});await fs.mkdir(path.join(prefix,'opt/docker-buildx/bin'),{recursive:true});await fs.mkdir(owner);
    const log=`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args:process.argv.slice(2),config:process.env.DOCKER_CONFIG})+'\\n');`;
    const colima=await script(path.join(prefix,'bin/colima'),log),client=await script(path.join(prefix,'bin/docker'),log);
    await script(path.join(prefix,'opt/docker-buildx/bin/docker-buildx'),'');
    const brew=await script(path.join(f.root,'brew'),log+`if(process.argv[2]==='--prefix')console.log(${JSON.stringify(prefix)});`);
    const raw='{"currentContext":"keep","auths":{"private":"unchanged"}}';await fs.writeFile(path.join(f.config,'config.json'),raw);
    const input={brewBinary:brew,installPackages:true,profile:'gitjig-test',dockerConfigDirectory:f.config};
    for(const platform of ['linux','darwin']) {
        const result=await prepareColima(input,{platform,ownerHome:owner});assert.equal(result.dockerContext,'colima-gitjig-test');assert.equal(result.dockerBinary,client);
    }
    assert.equal(await fs.readFile(path.join(f.config,'config.json'),'utf8'),raw);
    assert.equal(await fs.realpath(path.join(f.config,'cli-plugins/docker-buildx')),path.join(prefix,'opt/docker-buildx/bin/docker-buildx'));
    const rows=(await fs.readFile(calls,'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(r=>JSON.stringify(r.args)===JSON.stringify(['install','colima','docker','docker-buildx'])));
    assert.ok(rows.filter(r=>r.args[0]==='start').every(r=>r.args.includes('--activate=false')&&r.config===f.config));
    await fs.mkdir(path.join(owner,'.colima/gitjig-test'),{recursive:true});
    await assert.rejects(prepareColima({...input,installPackages:false,dockerBinary:client,colimaBinary:colima},{platform:'linux',ownerHome:owner}),/already exists/);
    await prepareColima({...input,installPackages:false,reuse:true,dockerBinary:client,colimaBinary:colima},{platform:'linux',ownerHome:owner});
    const last=JSON.parse((await fs.readFile(calls,'utf8')).trim().split('\n').at(-1));assert.ok(!last.args.includes('--runtime'));
    const defaultRoute=await prepareColima({...input,profile:'default',installPackages:false,dockerBinary:client,colimaBinary:colima},{platform:'linux',ownerHome:owner});
    assert.equal(defaultRoute.dockerContext,'colima');
});

test('original runtime form confirms Build, streams it, then requires explicit Save; stale edits refuse late results',async t=>{
    const f=await world(t),binary=await docker(f),c=await openController({installationHome:path.join(f.root,'home')});
    t.after(()=>c.close());const startup=ApplicationStartup.open(c),edit=await startup.prepareRuntimeEdit();let prepared=0;
    const choices=['Edit runtime fields','Prepare an execution image','Build execution image','Review and save runtime','Save and apply runtime'];
    const inputs=[binary,'owned','',f.config];
    const result=await editRuntimeFields({guard(){},notice(){},show:async()=>{},input:async()=>inputs.shift(),choose:async(_title,rows)=>{const next=choices.shift();assert.ok(rows.includes(next),String(next));return next;},
        runPreparation:async(_title,task)=>{prepared++;return task(new AbortController().signal,()=>{});}},edit);
    assert.equal(result,'completed');assert.equal(prepared,1);assert.equal((await startup.inspect()).saved.runtime.image,image);
    const before=await fs.readFile(path.join(f.root,'home/config/startup.json'));
    const stale=await startup.prepareRuntimeEdit();await fs.appendFile(path.join(f.root,'home/config/startup.json'),'\n');
    await assert.rejects(stale.buildImage({dockerBinary:binary,dockerConfigDirectory:f.config,dockerContext:'owned'},()=>{},new AbortController().signal,()=>{}),/changed while editing/);
    assert.equal((await fs.readFile(path.join(f.root,'home/config/startup.json'))).toString(),before.toString()+'\n');
});

test('interactive wizard can cancel or stage a built image without another startup writer',async t=>{
    const f=await world(t),binary=await docker(f);let writes=0;
    assert.equal(await interactiveSetup({ask:async()=> '3',output(){},saveRuntime:async()=>writes++}),undefined);
    const answers=['1',binary,f.config,'owned','NO','maybe','YES'];let explanation='';
    const result=await interactiveSetup({ask:async()=>answers.shift(),output(text){explanation+=text;},stageOnly:true,saveRuntime:async()=>writes++});
    assert.equal(result.image,image);assert.equal(writes,0);assert.match(explanation,/Please answer yes or no/);
});

test('captured path guards refuse project aliases, application state and Colima/plugin aliases before native launch or protected writes',async t=>{
    const f=await world(t),project=path.join(f.root,'project'),owner=path.join(f.root,'owner');await fs.mkdir(project);await fs.mkdir(owner);
    const c=await openController({installationHome:path.join(f.root,'home')});t.after(()=>c.close());
    await c.registerProject({id:'project',sourceRoot:project});
    const edit=await ApplicationStartup.open(c).prepareRuntimeEdit(),options={checkPath:edit.checkPath,guard:edit.assertCurrent};
    const binary=await docker(f);await fs.mkdir(path.join(project,'config'));await fs.symlink(path.join(project,'config'),path.join(f.root,'config-alias'));
    await assert.rejects(buildImage({dockerBinary:binary,dockerConfigDirectory:path.join(f.root,'config-alias'),dockerContext:'owned'},options),/project|overlap|disjoint/);
    await assert.rejects(fs.access(f.receipt));
    const projectBinary=await script(path.join(project,'client'),"throw Error('must not execute');");
    await assert.rejects(buildImage({dockerBinary:projectBinary,dockerConfigDirectory:f.config,dockerContext:'owned'},options),/project|overlap|disjoint/);
    const answers=['1',binary,path.join(f.root,'config-alias','new-config'),'owned','y'];
    await assert.rejects(interactiveSetup({ask:async()=>answers.shift(),output(){},stageOnly:true,...options}),/project|overlap|disjoint/);
    await assert.rejects(fs.access(path.join(project,'config/new-config')));
    const colimaInput={dockerBinary:binary,colimaBinary:binary,dockerConfigDirectory:f.config};
    await fs.symlink(project,path.join(owner,'.colima'));
    await assert.rejects(prepareColima(colimaInput,{...options,ownerHome:owner}),/project|overlap|disjoint/);
    await fs.unlink(path.join(owner,'.colima'));await fs.mkdir(path.join(owner,'.colima'));await fs.symlink(project,path.join(owner,'.colima/_lima'));
    await assert.rejects(prepareColima(colimaInput,{...options,ownerHome:owner}),/project|overlap|disjoint/);
    await fs.unlink(path.join(owner,'.colima/_lima'));await fs.symlink(project,path.join(owner,'.colima/gitjig'));
    await assert.rejects(prepareColima({...colimaInput,reuse:true},{...options,ownerHome:owner}),/project|overlap|disjoint/);
    await fs.unlink(path.join(owner,'.colima/gitjig'));
    const prefix=path.join(f.root,'prefix');await fs.mkdir(path.join(prefix,'opt/docker-buildx/bin'),{recursive:true});
    await fs.symlink(projectBinary,path.join(prefix,'opt/docker-buildx/bin/docker-buildx'));
    const brew=await script(path.join(f.root,'brew-client'),`if(process.argv[2]==='--prefix')console.log(${JSON.stringify(prefix)});`);
    await assert.rejects(prepareColima({...colimaInput,installPackages:true,brewBinary:brew},{...options,ownerHome:owner}),/project|overlap|disjoint/);
    await assert.rejects(fs.access(path.join(f.config,'cli-plugins/docker-buildx')));await assert.rejects(fs.access(f.receipt));
    const stateAlias=path.join(f.root,'state-alias');await fs.symlink(path.join(f.root,'home/state'),stateAlias);
    const stateAnswers=['1',binary,path.join(stateAlias,'new-config'),'owned','y'];
    await assert.rejects(interactiveSetup({ask:async()=>stateAnswers.shift(),output(){},stageOnly:true,...options}),/state|overlap|disjoint/);
    await assert.rejects(fs.access(path.join(f.root,'home/state/new-config')));
});

test('source drift during prospective path validation refuses configuration creation and startup close joins a held build',async t=>{
    const f=await world(t),c=await openController({installationHome:path.join(f.root,'home')});
    await fs.mkdir(path.join(f.root,'home/config'),{recursive:true,mode:0o700});
    t.after(()=>c.close());const startup=ApplicationStartup.open(c),edit=await startup.prepareRuntimeEdit(),binary=await docker(f),newConfig=path.join(f.root,'new-config');
    const answers=['1',binary,newConfig,'owned','y'];
    await assert.rejects(interactiveSetup({ask:async()=>answers.shift(),output(){},stageOnly:true,guard:edit.assertCurrent,
        checkPath(file){edit.checkPath(file);if(file===newConfig)writeFileSync(path.join(f.root,'home/config/startup.json'),'{"version":1}',{mode:0o600});}}),/changed while editing/);
    await assert.rejects(fs.access(newConfig));
    const fresh=await startup.prepareRuntimeEdit(),entered=path.join(f.root,'held');
    const held=await script(path.join(f.root,'held-build'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(entered)},String(process.pid));setInterval(()=>{},1000);`);
    const pending=fresh.buildImage({dockerBinary:held,dockerConfigDirectory:f.config,dockerContext:'owned'},()=>{},new AbortController().signal,()=>{});
    const settled=pending.then(()=>assert.fail('Closed setup selected an image'),error=>error);
    const deadline=Date.now()+2000;while(!await fs.access(entered).then(()=>true,()=>false)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
    assert.ok(await fs.access(entered).then(()=>true,()=>false));const pid=Number(await fs.readFile(entered,'utf8'));
    await startup.close();assert.match(String(await settled),/cancelled/);assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
    assert.deepEqual((await fs.readdir(path.join(f.root,'home/config'))).filter(p=>p==='startup.json'),['startup.json']);
    assert.equal(await fs.readFile(path.join(f.root,'home/config/startup.json'),'utf8'),'{"version":1}');
});

test('native preparation progress bounds untrusted output, shows elapsed time and signals cancellation once before disposal',t=>{
    let now=1000,redraws=0,cancelled=0;
    t.mock.method(performance,'now',()=>now);t.mock.timers.enable({apis:['setInterval']});
    createNativeEditorFactory();
    const progress=new PreparationProgress('Build',()=>cancelled++,()=>redraws++);
    try {
        progress.append('\x1b[2Junsafe\n'+('long output '.repeat(5000)));
        now+=2000;t.mock.timers.tick(1000);
        const frame=progress.render(60).map(stripTerminalSequences).join('\n');
        assert.match(frame,/Running.*2s/);assert.ok(frame.length<20000);assert.doesNotMatch(frame,/\x1b/);
        progress.handleInput('\x1b');
        assert.equal(cancelled,1);progress.requestCancel();assert.equal(cancelled,1);
        assert.match(progress.render(60).map(stripTerminalSequences).join('\n'),/Cancelling/);
    } finally {progress.dispose();}
    const stopped=redraws;t.mock.timers.tick(2000);assert.equal(redraws,stopped);
});

test('original prepared runtime metadata check uses its exact route/image without allocating or saving',async t=>{
    const f=await world(t),binary=await script(path.join(f.root,'metadata-client'),`import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(f.receipt)},JSON.stringify(args)+'\\n');if(args[4]==='version')console.log(JSON.stringify('owned-engine'));else if(args[4]==='image'&&args[5]==='inspect')console.log(JSON.stringify(args.at(-1)));else throw Error('Only metadata check allowed');`);
    const c=await openController({installationHome:path.join(f.root,'home')});t.after(()=>c.close());const startup=ApplicationStartup.open(c),edit=await startup.prepareRuntimeEdit();let output='';
    const checked=await edit.checkRuntime({dockerBinary:binary,dockerConfigDirectory:f.config,dockerContext:'owned',image},()=>{},new AbortController().signal,text=>output+=text);
    assert.equal(checked.image,image);assert.match(output,/isolation, shared paths and project tools are not verified/);assert.equal((await startup.inspect()).saved,null);
    const calls=(await fs.readFile(f.receipt,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls,[['--config',f.config,'--context','owned','version','--format','{{json .Server.Version}}'],['--config',f.config,'--context','owned','image','inspect','--format','{{json .Id}}',image]]);
    for(const table of ['works','runs','conversation_inputs'])assert.equal(c.store.one('SELECT COUNT(*) AS n FROM '+table).n,0);
    await assert.rejects(edit.checkRuntime({dockerBinary:binary,dockerConfigDirectory:f.config,dockerContext:'owned',image:'latest'},()=>{},new AbortController().signal,()=>{}),/immutable/);
    assert.equal((await fs.readFile(f.receipt,'utf8')).trim().split('\n').length,2);
});

test('runtime metadata check refuses wrong image identity and route drift',async t=>{
    const {checkRuntime}=await import('../../runtime/setup.mjs');const f=await world(t);let calls=0;
    const binary=await script(path.join(f.root,'client'),'');const input={dockerBinary:binary,dockerConfigDirectory:f.config,dockerContext:'owned',image};
    await assert.rejects(checkRuntime(input,{execute:async()=>({stdout:JSON.stringify(++calls===1?'engine':'sha256:'+'b'.repeat(64))})}),/immutable identity/);
    calls=0;await assert.rejects(checkRuntime(input,{execute:async()=>{calls++;if(calls===2)await fs.writeFile(path.join(f.config,'config.json'),'{}');return {stdout:JSON.stringify(calls===1?'engine':image)};}}),/route changed/);
});

test('interactive image retry retains prepared route and retries only the failed build',async t=>{
    const f=await world(t),attempts=path.join(f.root,'attempts');const binary=await script(path.join(f.root,'retry-client'),`import fs from 'node:fs';const args=process.argv.slice(2);if(args[4]!=='build')throw Error('Only build allowed');const count=fs.existsSync(${JSON.stringify(attempts)})?2:1;fs.writeFileSync(${JSON.stringify(attempts)},String(count));if(count===1){console.error('OWNED_TRANSIENT_FAILURE');process.exit(1);}fs.writeFileSync(args[args.indexOf('--iidfile')+1],${JSON.stringify(image)});`);
    const answers=['1',binary,f.config,'owned','y','y','3'];let output='';
    const result=await interactiveSetup({stageOnly:true,ask:async()=>answers.shift(),output:s=>output+=s});
    assert.equal(result.image,image);assert.equal(await fs.readFile(attempts,'utf8'),'2');assert.equal(answers.length,0);assert.match(output,/package\/VM steps will not repeat/);
});
for(const finish of [false,true])test('interactive build failure offers retained route correction with separate build consent; cancel='+finish,async t=>{
    const f=await world(t),binary=await docker(f),invalid=path.join(f.root,'mistyped-docker');let saves=0;
    const answers=['1',invalid,f.config,'owned','n','y',binary,f.config,'corrected','n',finish?'n':'y'];let correcting=false;
    const result=await interactiveSetup({stageOnly:true,ask:async(question,value)=>{
        if(correcting&&question==='Docker executable')assert.equal(value,invalid);
        if(correcting&&question==='Docker configuration directory')assert.equal(value,f.config);
        if(correcting&&question==='Docker context')assert.equal(value,'owned');
        assert.ok(answers.length,'Unexpected prompt '+question);return answers.shift();
    },choose:async(title,rows)=>{assert.equal(title,'Choose image build recovery');assert.equal(rows[0],'Finish without saving');assert.ok(rows.includes('Retry only the image build'));correcting=true;return 'Correct Docker route';},output(){},saveRuntime:async()=>saves++});
    assert.equal(answers.length,0);assert.equal(saves,0);
    if(finish){assert.equal(result,undefined);await assert.rejects(fs.access(f.receipt));}
    else{assert.equal(result.image,image);assert.equal(result.dockerContext,'corrected');const receipt=JSON.parse(await fs.readFile(f.receipt));assert.deepEqual(receipt.args.slice(0,5),['--config',f.config,'--context','corrected','build']);}
});

test('optional literal image packages reach the actual build and recipe shell without additional context files',async t=>{
    const f=await world(t),binary=await docker(f);await buildImage({dockerBinary:binary,dockerConfigDirectory:f.config,dockerContext:'owned'},{extraPackages:'python3 build-essential python3',temporaryRoot:f.root});
    const call=JSON.parse(await fs.readFile(f.receipt));assert.equal(call.args[call.args.indexOf('--build-arg')+1],'GITJIG_EXTRA_PACKAGES=python3 build-essential');assert.deepEqual(call.files.sort(),['Dockerfile','Dockerfile.dockerignore','io-helper.mjs']);
    await fs.rm(f.receipt);
    for(const extraPackages of ['-y','python3;echo','$(echo bad)','python3\n--allow-unauthenticated'])await assert.rejects(buildImage({dockerBinary:binary,dockerConfigDirectory:f.config,dockerContext:'owned'},{extraPackages,temporaryRoot:f.root}),/literal Debian/);
    await assert.rejects(fs.access(f.receipt));assert.equal((await fs.readdir(f.root)).some(n=>n.startsWith('gitjig-image-')),false);
    const tools=path.join(f.root,'tools'),receipt=path.join(f.root,'recipe-calls');await fs.mkdir(tools);
    for(const name of ['apt-get','rm'])await script(path.join(tools,name),`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(receipt)},JSON.stringify({name:${JSON.stringify(name)},args:process.argv.slice(2)})+'\\n');`);
    const recipe=await fs.readFile('runtime/Dockerfile','utf8'),run=recipe.split('\n').find(line=>line.startsWith('RUN ')).slice(4);
    const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
    await promisify(execFile)('/bin/sh',['-c',run],{env:{PATH:tools,GITJIG_EXTRA_PACKAGES:'python3 build-essential'},timeout:5000});
    const invoked=(await fs.readFile(receipt,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(invoked.map(c=>c.name),['apt-get','apt-get','rm']);assert.deepEqual(invoked[1].args,['install','-y','--no-install-recommends','git','curl','util-linux','ca-certificates','python3','build-essential']);
});
