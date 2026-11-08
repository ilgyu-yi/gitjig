import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {discoverRuntimeCandidates} from '../../dist/execution/runtime-discovery.js';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {dockerContextInspection} from '../helpers/docker-context-inspection.mjs';
import {checkRuntime,buildImage,routeIdentity,prepareColima,interactiveSetup,runCommand} from '../../runtime/setup.mjs';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {uiText} from '../../dist/ui/i18n.js';
const A='sha256:'+'a'.repeat(64),B='sha256:'+'b'.repeat(64);
async function world(t){
    const root=await temporaryDirectory('runtime-selection'),config=path.join(root,'docker-A'),other=path.join(root,'docker-B'),calls=path.join(root,'calls.jsonl'),binary=path.join(root,'docker-client'),colima=path.join(root,'colima-client');
    await fs.mkdir(config,{mode:0o700});await fs.mkdir(other,{mode:0o700});
    const contexts=await dockerContextInspection(config,'A')+'\n'+await dockerContextInspection(other,'B');
    const source='#!'+process.execPath+'\n'+`import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');${contexts}
if(args.includes('version'))console.log(JSON.stringify('owned-engine'));
else if(args.includes('image')&&args.includes('inspect')){if(fs.existsSync(${JSON.stringify(path.join(root,'fail-next'))})){fs.rmSync(${JSON.stringify(path.join(root,'fail-next'))});process.exit(2);}console.log(JSON.stringify(args.at(-1)));}
else if(args.includes('image')&&args.includes('ls')){
    if(args.includes('--quiet'))console.log(${JSON.stringify(A)});
    else console.log(JSON.stringify({ID:${JSON.stringify(A)},Repository:'owned-fixture',Tag:'checked'}));
}
else if(args.includes('build'))fs.writeFileSync(args[args.indexOf('--iidfile')+1],${JSON.stringify(A)});
else throw Error('Unapproved fixture command');`;
    await fs.writeFile(binary,source,{mode:0o700});await fs.writeFile(colima,'#!'+process.execPath+'\n',{mode:0o700});
    let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained runtime selection '+root);});
    return {root,config,other,binary,colima,input:{dockerBinary:binary,dockerConfigDirectory:config,dockerContext:'A',image:A},
        async observe(data){await fs.writeFile(path.join(root,'observation.json'),JSON.stringify(data,null,2));},
        async pass(){if(process.env.GITJIG_RUNTIME_SELECTION_EVIDENCE_ROOT){const destination=path.join(process.env.GITJIG_RUNTIME_SELECTION_EVIDENCE_ROOT,t.name.replace(/[^a-zA-Z0-9-]/g,'_'));await fs.mkdir(destination,{recursive:true,mode:0o700});await fs.cp(root,path.join(destination,'closed-fixture'),{recursive:true,errorOnExist:true,force:false});}passed=true;}};
}
for(const boundary of ['version','final-context'])test(`runtime image check keeps original selection during ${boundary}`,async t=>{
    const f=await world(t),input={...f.input},inspected=[];let contexts=0;
    const execute=async(file,args,options)=>{
        const result=await runCommand(file,args,options);
        if(args.includes('image'))inspected.push(args.at(-1));
        if(args.includes('context'))contexts++;
        if(boundary==='version'&&args.includes('version')||boundary==='final-context'&&contexts===2)input.image=B;
        return result;
    };
    const result=await checkRuntime(input,{execute});await f.observe({result,inspected,mutated:input.image});
    assert.deepEqual(inspected,[A]);assert.equal(result.image,A);assert.equal(input.image,B);await f.pass();
});
for(const operation of ['check','build'])test(`runtime ${operation} cannot mix caller routes across validation awaits`,async t=>{
    const f=await world(t),input={...f.input};
    const pending=operation==='check'?checkRuntime(input):buildImage(input,{temporaryRoot:f.root});
    input.dockerConfigDirectory=f.other;input.dockerContext='B';input.image=B;
    const result=await pending;await f.observe({result,mutated:input});
    assert.equal(result.dockerConfigDirectory,f.config);assert.equal(result.dockerContext,'A');assert.equal(result.image,A);await f.pass();
});
test('runtime route identity observes the original finite route',async t=>{
    const f=await world(t),expected=await routeIdentity(f.input),input={...f.input},pending=routeIdentity(input);
    input.dockerConfigDirectory=f.other;input.dockerContext='B';
    const actual=await pending;await f.observe({expected,actual,mutated:input});assert.equal(actual,expected);await f.pass();
});
test('application runtime check captures image before serialized route validation',async t=>{
    const f=await world(t),home=path.join(f.root,'home'),c=await openController({installationHome:home});
    try{
        const startup=ApplicationStartup.open(c),edit=await startup.prepareRuntimeEdit(),input={...f.input};
        const pending=edit.checkRuntime(input,()=>{},new AbortController().signal,()=>{});input.image=B;
        const result=await pending;await f.observe({result,mutated:input.image});assert.equal(result.image,A);
        assert.equal((await startup.inspect()).saved,null);assert.equal(c.options.runtimeProfile,undefined);assert.deepEqual(c.store.all('SELECT * FROM runs'),[]);
    }finally{await c.close();}await f.pass();
});
for(const entry of ['helper','application'])test(`interactive ${entry} captures original initial route and locale before preparation`,async t=>{
    const f=await world(t),initial={...f.input},defaults=[];let c;
    const wizard=id=>uiText('ko','runtime.install.'+id);
    const host={locale:'ko',ask:async(question,value)=>{
        if(question===wizard('chooseRoute'))return '1';
        if(question===wizard('context'))defaults.push(value);
        if(question===wizard('createConfig')||question===wizard('build'))return 'n';
        assert.ok(['executable','configDirectory','context'].some(id=>wizard(id)===question),question);
        return value;
    },output(){},execute(){throw Error('No native execution admitted');}};
    try{
        let pending;
        if(entry==='helper')pending=interactiveSetup({...host,initialRuntime:initial,ownerHome:f.root,env:{PATH:path.dirname(process.execPath)},stageOnly:true});
        else{c=await openController({installationHome:path.join(f.root,'home')});const edit=await ApplicationStartup.open(c).prepareRuntimeEdit();pending=edit.prepareInteractive(initial,()=>{},host);}
        initial.dockerContext='B';initial.dockerConfigDirectory=f.other;
        host.locale='en';
        assert.equal(await pending,undefined);await f.observe({defaults,mutated:initial});assert.deepEqual(defaults,['A']);
        if(c)assert.equal((await ApplicationStartup.open(c).inspect()).saved,null);
    }finally{await c?.close();}await f.pass();
});
test('Colima preparation captures the original profile before path validation',async t=>{
    const f=await world(t),input={dockerBinary:f.binary,colimaBinary:f.colima,dockerConfigDirectory:f.config,profile:'original',reuse:false,installPackages:false},calls=[];
    const pending=prepareColima(input,{ownerHome:f.root,platform:'linux',execute:async(file,args)=>{calls.push(args);return {stdout:'',stderr:''};}});input.profile='other';
    const result=await pending;await f.observe({result,calls});assert.equal(result.dockerContext,'colima-original');assert.ok(calls[0].includes('original'));await f.pass();
});
test('Colima reuse cannot acquire runtime-changing flags from caller mutation',async t=>{
    const f=await world(t);await fs.mkdir(path.join(f.root,'.colima/original'),{recursive:true,mode:0o700});
    await fs.writeFile(path.join(f.root,'.colima/original/colima.yaml'),'runtime: docker\n',{mode:0o600});
    const input={dockerBinary:f.binary,colimaBinary:f.colima,dockerConfigDirectory:f.config,profile:'original',reuse:true,installPackages:false},calls=[];
    await prepareColima(input,{ownerHome:f.root,platform:'linux',checkPath:file=>{if(file===f.colima)input.reuse=false;},execute:async(file,args)=>{calls.push(args);return {stdout:'',stderr:''};}});
    await f.observe({calls,mutated:input.reuse});assert.equal(input.reuse,false);assert.equal(calls.length,1);assert.ok(!calls[0].includes('--runtime'));assert.ok(calls[0].includes('--save-config=false'));await f.pass();
});

test('a clean failed runtime check permits a fresh explicit check without saving or activation',async t=>{
    const f=await world(t),c=await openController({installationHome:path.join(f.root,'home')});
    try{
        const startup=ApplicationStartup.open(c),edit=await startup.prepareRuntimeEdit();
        await fs.writeFile(path.join(f.root,'fail-next'),'owned failure');
        await assert.rejects(edit.checkRuntime({...f.input},()=>{},new AbortController().signal,()=>{}),e=>e.code==='RUNTIME_DOCKER_IMAGE_UNAVAILABLE');
        const result=await edit.checkRuntime({...f.input,image:B},()=>{},new AbortController().signal,()=>{});
        await f.observe({result,saved:(await startup.inspect()).saved});assert.equal(result.image,B);
        assert.equal((await startup.inspect()).saved,null);assert.equal(c.options.runtimeProfile,undefined);assert.deepEqual(c.store.all('SELECT * FROM runs'),[]);
    }finally{await c.close();}await f.pass();
});

for(const boundary of ['immediate','after-context'])test(`direct image discovery keeps original route during ${boundary} mutation`,async t=>{
    const f=await world(t),input={...f.input},callsFile=path.join(f.root,'calls.jsonl');let mutated=false;
    const mutate=()=>{input.dockerContext='B';input.dockerConfigDirectory=f.other;mutated=true;};
    const pending=discoverRuntimeCandidates('images',input,{home:f.root,signal:new AbortController().signal,checkPath(){},guard(){
        if(boundary==='after-context'&&!mutated&&existsSync(callsFile)&&readFileSync(callsFile,'utf8').includes('"inspect"'))mutate();
    }});
    if(boundary==='immediate')mutate();
    const result=await pending,calls=readFileSync(callsFile,'utf8').trim().split('\n').map(JSON.parse),listing=calls.find(args=>args.includes('image')&&args.includes('ls'));
    await f.observe({result,calls,mutated:input});assert.equal(mutated,true);assert.equal(result.dockerContext,'A');assert.equal(result.dockerConfigDirectory,f.config);
    assert.deepEqual(listing.slice(0,4),['--config',f.config,'--context','A']);assert.deepEqual(result.candidates,[A]);await f.pass();
});
