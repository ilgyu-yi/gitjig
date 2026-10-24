import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {configurationCommands} from '../../dist/ui/configuration-commands.js';
import {discoveryFixture,heldIds,image} from './runtime-discovery-fixture.mjs';
const calls=async f=>(await fs.readFile(f.calls,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const ledger=f=>Object.fromEntries(['works','runs','budgets','conversation_inputs'].map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
function command(f,choices,inputs=[],extra={}){const shown=[],defaults=[];const commands=new HostCommands(configurationCommands({controller:f.c,accounts:f.accounts,models:f.models,settings:f.settings,isCurrent:()=>true,
    choose:async(title,rows)=>{const next=choices.shift();if(typeof next==='function')return next(title,rows);if(next!==undefined)assert.ok(rows.includes(next),'Missing choice: '+next);return next;},input:async(title,value)=>{defaults.push({title,value});return inputs.shift();},show:async(title,text)=>shown.push({title,text}),notice(){},apply(){},assertPresentationChange(){},commandKey:'ctrl+g',...extra}));return {shown,defaults,run:()=>commands.execute('/setup runtime',f.source.conversationId)};}

test('explicit native discovery binds exact routing, ignores ambient overrides, deduplicates full IDs and leaves authority/setup untouched',async t=>{
    const f=await discoveryFixture(t),before=await fs.readFile(f.file),prior=ledger(f),edit=await f.startup.prepareRuntimeEdit(),old=process.env.DOCKER_HOST;process.env.DOCKER_HOST='MUST_NOT_USE';
    try{
        const contexts=await edit.discover('contexts',f.input,()=>{});assert.deepEqual(contexts.candidates,['default','owned']);
        const images=await edit.discover('images',f.input,()=>{});assert.deepEqual(images.candidates,[image]);assert.match(images.labels[0],/gitjig-runtime:checked.*\+1 references/);
        const actual=await calls(f);assert.equal(actual.length,2);for(const row of actual){assert.equal(row.cwd,f.c.applicationHome());assert.equal(row.env.HOME,f.c.applicationHome());assert.equal(row.env.DOCKER_HOST,undefined);assert.equal(row.env.DOCKER_CONFIG,undefined);assert.equal(row.env.DOCKER_CONTEXT,undefined);assert.equal(row.env.PATH,'/usr/bin:/bin');}
        assert.deepEqual(actual[0].args,['--config',f.config,'context','ls','--quiet']);assert.deepEqual(actual[1].args,['--config',f.config,'--context','owned','image','ls','--no-trunc','--format','{{json .}}']);
    }finally{if(old===undefined)delete process.env.DOCKER_HOST;else process.env.DOCKER_HOST=old;}
    assert.deepEqual(await fs.readFile(f.file),before);assert.deepEqual(ledger(f),prior);assert.equal(f.c.options.runtimeProfile,undefined);f.pass();
});

test('empty inventories are explicit; malformed, duplicate JSON keys, truncated and oversized output yield no partial list',async t=>{
    const f=await discoveryFixture(t),edit=await f.startup.prepareRuntimeEdit(),before=await fs.readFile(f.file);
    await fs.writeFile(f.mode,'empty');assert.deepEqual((await edit.discover('contexts',f.input,()=>{})).candidates,[]);
    for(const [mode,kind,pattern] of [['bad','contexts',/unsupported/],['bad','images',/unsupported/],['ambiguous','images',/unsupported/],['utf8','contexts',/UTF-8/],['overflow','contexts',/256 rows/],['incomplete','contexts',/incomplete/],['bytes','contexts',/1 MiB/],['failed','contexts',/observation failed/]]){
        await fs.writeFile(f.mode,mode);await assert.rejects(edit.discover(kind,f.input,()=>{}),error=>pattern.test(error.message)&&!error.message.includes('PRIVATE_NATIVE_FAILURE'));
    }
    assert.deepEqual(await fs.readFile(f.file),before);f.pass();
});

test('missing/unsafe/project-controlled selections refuse before any native command',async t=>{
    const f=await discoveryFixture(t),edit=await f.startup.prepareRuntimeEdit();
    await assert.rejects(edit.discover('contexts',{...f.input,dockerConfigDirectory:''},()=>{}),/explicit Docker configuration/);
    await assert.rejects(edit.discover('images',{...f.input,dockerContext:''},()=>{}),/explicit Docker context/);
    await fs.chmod(f.binary,0o722);await assert.rejects(edit.discover('contexts',f.input,()=>{}),/trusted owner/);await fs.chmod(f.binary,0o700);
    await fs.chmod(f.config,0o777);await assert.rejects(edit.discover('contexts',f.input,()=>{}),/trusted/);await fs.chmod(f.config,0o700);
    const root=path.join(f.root,'project');await fs.mkdir(root,{mode:0o700});await f.c.registerProject({id:'project',sourceRoot:root});const fresh=await f.startup.prepareRuntimeEdit();
    const binary=path.join(root,'client');await fs.copyFile(f.binary,binary);await fs.chmod(binary,0o700);await assert.rejects(fresh.discover('contexts',{...f.input,dockerBinary:binary},()=>{}),/disjoint/);
    assert.deepEqual(await calls(f),[]);f.pass();
});

test('navigation during validation prevents native launch; later navigation or raw setup drift refuses the observed result',async t=>{
    const f=await discoveryFixture(t),edit=await f.startup.prepareRuntimeEdit();let current=true;
    await assert.rejects(edit.discover('contexts',f.input,()=>{if(!current)throw Error('SOURCE_CHANGED');queueMicrotask(()=>current=false);}),/SOURCE_CHANGED/);assert.deepEqual(await calls(f),[]);
    for(const drift of ['source','setup','binary']){
        current=true;const before=await fs.readFile(f.file),fresh=await f.startup.prepareRuntimeEdit();await fs.writeFile(f.mode,'delayed');
        const pending=fresh.discover('contexts',f.input,()=>{if(!current)throw Error('SOURCE_CHANGED');});void pending.catch(()=>{});await heldIds(f);
        if(drift==='source')current=false;else if(drift==='setup')await fs.appendFile(f.file,'\n');else await fs.appendFile(f.binary,'// changed native client\n');
        await fs.writeFile(path.join(f.root,'release'),'release');
        await assert.rejects(pending,drift==='source'?/SOURCE_CHANGED/:drift==='setup'?/changed while editing/:/executable or configuration directory changed/);
        assert.equal(await fs.readFile(f.file,'utf8'),before.toString()+(drift==='setup'?'\n':''));await fs.unlink(f.held);await fs.unlink(path.join(f.root,'release'));
    }
    f.pass();
});

test('discovery refuses in-place configuration, context and TLS drift after native completion',async t=>{
    const f=await discoveryFixture(t);
    const metadata=[path.join(f.config,'config.json'),path.join(f.config,'contexts/meta/owned/meta.json'),path.join(f.config,'contexts/tls/owned/docker/ca.pem')];
    for(const file of metadata){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,'original',{mode:0o600});}
    for(const [index,file] of metadata.entries()){
        const edit=await f.startup.prepareRuntimeEdit();await fs.writeFile(f.mode,'delayed');
        const before=await fs.stat(f.config,{bigint:true});
        const pending=edit.discover(index===0?'contexts':'images',f.input,()=>{});void pending.catch(()=>{});await heldIds(f);
        await fs.writeFile(file,'changed!');assert.equal((await fs.stat(f.config,{bigint:true})).mtimeNs,before.mtimeNs);
        await fs.writeFile(path.join(f.root,'release'),'release');
        await assert.rejects(pending,/executable or configuration directory changed/);
        await fs.unlink(f.held);await fs.unlink(path.join(f.root,'release'));
    }
    f.pass();
});

test('discovery ignores unrelated build cache changes but refuses unsafe or oversized route metadata before dispatch',async t=>{
    const f=await discoveryFixture(t),cache=path.join(f.config,'buildx/cache');await fs.mkdir(cache,{recursive:true,mode:0o700});
    const edit=await f.startup.prepareRuntimeEdit();await fs.writeFile(f.mode,'delayed');
    const pending=edit.discover('contexts',f.input,()=>{});await heldIds(f);
    await fs.writeFile(path.join(cache,'state'),'new cache',{mode:0o600});await fs.writeFile(path.join(f.root,'release'),'release');
    assert.deepEqual((await pending).candidates,['owned']);
    const initialCalls=(await calls(f)).length,file=path.join(f.config,'config.json');
    await fs.writeFile(file,'{}',{mode:0o600});await fs.chmod(file,0o622);
    await assert.rejects(edit.discover('contexts',f.input,()=>{}),/trusted regular/);
    await fs.chmod(file,0o600);await fs.writeFile(file,'x'.repeat(1024*1024+1));
    await assert.rejects(edit.discover('contexts',f.input,()=>{}),/byte bound/);
    await fs.unlink(file);await fs.symlink(path.join(cache,'state'),file);
    await assert.rejects(edit.discover('contexts',f.input,()=>{}),/trusted regular/);
    assert.equal((await calls(f)).length,initialCalls);f.pass();
});

test('UI preserves unknown native cleanup diagnostics and original process group through close',async t=>{
    const f=await discoveryFixture(t),before=await fs.readFile(f.file);await fs.writeFile(f.mode,'hold');
    const h=command(f,['Choose Docker context'],[f.binary,f.config]),pending=h.run();void pending.catch(()=>{});const ids=await heldIds(f),kill=process.kill.bind(process);
    process.kill=(pid,signal)=>{if(pid===-ids.group){const error=Error('Controlled unavailable group cleanup');error.code='EPERM';throw error;}return kill(pid,signal);};
    try{
        f.expectCleanupUnknown();const closed=f.startup.close();void closed.catch(()=>{});await assert.rejects(pending,error=>error.code==='RUNTIME_DISCOVERY_CLEANUP_UNKNOWN'&&error.recovery.includes(String(ids.group)));await assert.rejects(closed,error=>error.code==='RUNTIME_DISCOVERY_CLEANUP_UNKNOWN'&&error.recovery.includes(String(ids.group)));
    }finally{
        process.kill=kill;kill(-ids.group,'SIGKILL');const until=Date.now()+2000;
        while(Date.now()<until){try{kill(-ids.group,0);}catch(error){if(error.code==='ESRCH')break;throw error;}await new Promise(resolve=>setTimeout(resolve,10));}
        assert.throws(()=>kill(-ids.group,0),error=>error.code==='ESRCH');
    }
    assert.deepEqual(await fs.readFile(f.file),before);assert.ok(!h.shown.some(row=>row.title.includes('discovery unavailable')));f.pass();
});

test('close during validation forbids late launch and close during native observation aborts and joins descendants',async t=>{
    const f=await discoveryFixture(t),edit=await f.startup.prepareRuntimeEdit(),before=await fs.readFile(f.file);await fs.writeFile(f.mode,'hold');
    const pending=edit.discover('contexts',f.input,()=>{});void pending.catch(()=>{});const ids=await heldIds(f);const closed=f.startup.close();await assert.rejects(pending,/cancelled/);await closed;
    for(const pid of [ids.group,ids.descendant])assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');assert.deepEqual(await fs.readFile(f.file),before);f.pass();
    const second=await discoveryFixture(t),prepared=await second.startup.prepareRuntimeEdit();let closing;
    await assert.rejects(prepared.discover('contexts',second.input,()=>{queueMicrotask(()=>{closing=second.startup.close();});}),/closing|changed while editing|cancelled/);await closing;assert.deepEqual(await calls(second),[]);second.pass();
});

test('UI discovers and stages human-readable selections, requires original reviewed save and preserves runtime limits',async t=>{
    const f=await discoveryFixture(t),before=await fs.readFile(f.file);
    const cancelled=command(f,['Choose Docker context','owned','Choose existing runtime image',undefined,'Cancel'],[f.binary,f.config,f.binary,'owned',f.config]);
    assert.equal(await cancelled.run(),'cancelled');assert.deepEqual(await fs.readFile(f.file),before);
    const h=command(f,['Choose Docker context','owned','Choose existing runtime image',(_title,rows)=>rows.find(row=>row.includes(image)),'Review and save runtime','Save and apply runtime'],[f.binary,f.config,f.binary,'owned',f.config]);
    assert.equal(await h.run(),'completed');assert.ok(h.shown.some(row=>row.title==='Explicit Docker discovery'&&row.text.includes('authenticate')));assert.ok(h.shown.some(row=>row.title==='Review runtime setup before applying'));
    assert.deepEqual(JSON.parse(await fs.readFile(f.file)).runtime,{dockerBinary:f.binary,dockerContext:'owned',image,dockerConfigDirectory:f.config,memoryMiB:2048});assert.deepEqual(f.c.options.runtimeProfile,{...JSON.parse(await fs.readFile(f.file)).runtime,uid:process.getuid(),gid:process.getgid()});f.pass();
});

test('UI empty/error and cancelled partial discovery retain all previous staged inputs',async t=>{
    const f=await discoveryFixture(t),before=await fs.readFile(f.file);
    for(const mode of ['empty','bad']){
        await fs.writeFile(f.mode,mode);const h=command(f,['Choose Docker context','Edit runtime fields','Cancel'],[f.binary,f.config,undefined]);assert.equal(await h.run(),'cancelled');assert.equal(h.defaults[2].value,f.binary);assert.ok(h.shown.some(row=>row.title.includes(mode==='empty'?'empty inventory':'unavailable')));assert.deepEqual(await fs.readFile(f.file),before);
    }
    const h=command(f,['Choose Docker context','Edit runtime fields','Cancel'],['/UNSAVED',undefined,undefined]);await h.run();assert.equal(h.defaults[2].value,f.binary);assert.deepEqual(await fs.readFile(f.file),before);f.pass();
});
