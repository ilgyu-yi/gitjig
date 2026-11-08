import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {ApplicationSettings} from '../../dist/app/settings.js';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {configurationCommands} from '../../dist/ui/configuration-commands.js';

async function fixture(t) {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-startup-repair-')));
    const c=await openController({installationHome:path.join(root,'app')}),startup=ApplicationStartup.open(c);
    const accounts=ApplicationAccounts.open(c),models=new ApplicationModels(c),settings=ApplicationSettings.open(c),source=await models.newConversation();
    let passed=false;
    t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained startup repair fixture: '+root);});
    await startup.save({version:1});
    return {root,c,startup,accounts,models,settings,source,file:path.join(c.applicationHome(),'config/startup.json'),pass(){passed=true;}};
}
function command(f,extra={}) {
    const notices=[],inputs=[],choices=[];
    const registry=new HostCommands(configurationCommands({controller:f.c,accounts:f.accounts,models:f.models,settings:f.settings,
        isCurrent:()=>true,input:async(...args)=>{inputs.push(args);return undefined;},choose:async(...args)=>{choices.push(args);return undefined;},
        notice:value=>notices.push(value),apply(){},assertPresentationChange(){},commandKey:'ctrl+g',...extra}));
    return {notices,inputs,choices,run:(text='/setup save')=>registry.execute(text,f.source.conversationId)};
}
const ledger=f=>Object.fromEntries(['conversations','conversation_state','conversation_inputs','works','runs','budgets','obligations'].map(table=>[table,f.c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));

test('explicit repair replaces invalid JSON/configuration while cancellation and ambiguous input preserve exact private bytes',async t=>{
    const f=await fixture(t),before=ledger(f);
    for(const raw of ['{"PRIVATE_BROKEN', '{"version":1,"unexpected":"PRIVATE_VALUE"}']) {
        await fs.writeFile(f.file,raw);
        const cancelled=command(f);assert.equal(await cancelled.run(),'cancelled');assert.equal(await fs.readFile(f.file,'utf8'),raw);
        for(const input of ['{"version":1,"version":1}','{"version":1,"\\u0076ersion":1}','{"PRIVATE_BROKEN']) {
            const h=command(f,{input:async()=>input});await assert.rejects(h.run(),error=>/unambiguous startup JSON/.test(error.message)&&!error.message.includes('PRIVATE'));
            assert.equal(await fs.readFile(f.file,'utf8'),raw);assert.deepEqual(h.notices,[]);
        }
        await assert.rejects(command(f).run('/setup save {"version":2}'));
        assert.equal(await fs.readFile(f.file,'utf8'),raw);
        assert.equal(await command(f).run('/setup save {"version":1}'),'completed');
        assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1});
        await fs.writeFile(f.file,raw);await command(f).run('/setup clear');assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1});
    }
    assert.deepEqual(ledger(f),before);f.pass();
});

test('repair never adopts an unsafe file or follows a symlink',async t=>{
    const f=await fixture(t),raw='PRIVATE_INVALID',external=path.join(f.root,'external');
    await fs.writeFile(f.file,raw);await fs.chmod(f.file,0o644);
    await assert.rejects(f.startup.prepareEdit());await assert.rejects(command(f).run('/setup clear'));
    assert.equal(await fs.readFile(f.file,'utf8'),raw);assert.equal((await fs.stat(f.file)).mode&0o777,0o644);
    await fs.chmod(f.file,0o600);await fs.writeFile(external,raw,{mode:0o600});await fs.unlink(f.file);await fs.symlink(external,f.file);
    await assert.rejects(f.startup.prepareEdit());await assert.rejects(command(f).run('/setup save {"version":1}'));
    assert.ok((await fs.lstat(f.file)).isSymbolicLink());assert.equal(await fs.readFile(external,'utf8'),raw);f.pass();
});

test('competing prepared save and clear have one winner in either order',async t=>{
    const f=await fixture(t),runtime={dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',image:'sha256:'+'0'.repeat(64)};
    for(const clearFirst of [false,true]) {
        await fs.writeFile(f.file,'{"PRIVATE_INVALID');
        const a=await f.startup.prepareEdit(),b=await f.startup.prepareEdit();
        const first=clearFirst?{version:1}:{version:1,runtime},second=clearFirst?{version:1,runtime}:{version:1};
        await a.save(first);const winner=await fs.readFile(f.file);
        await assert.rejects(b.save(second),/changed while editing/);assert.deepEqual(await fs.readFile(f.file),winner);
        assert.deepEqual(JSON.parse(winner),first);
    }
    f.pass();
});

test('raw-byte edits and source navigation during the JSON prompt refuse stale overwrite',async t=>{
    const f=await fixture(t),original=await fs.readFile(f.file);let current=true;
    const changed=command(f,{input:async()=>{await fs.appendFile(f.file,'\n');return '{"version":1}';}});
    await assert.rejects(changed.run(),/changed while editing/);assert.equal(await fs.readFile(f.file,'utf8'),original.toString()+'\n');assert.deepEqual(changed.notices,[]);
    const moved=command(f,{isCurrent:()=>current,input:async()=>{current=false;return '{"version":1}';}});
    await assert.rejects(moved.run(),/source changed/);assert.equal(await fs.readFile(f.file,'utf8'),original.toString()+'\n');assert.deepEqual(moved.notices,[]);f.pass();
});

test('final atomic write rechecks source after asynchronous metadata validation',async t=>{
    const f=await fixture(t),raw='{"PRIVATE_INVALID';await fs.writeFile(f.file,raw);
    const edit=await f.startup.prepareEdit();let current=true;
    await assert.rejects(edit.save({version:1,runtime:{dockerBinary:'/usr/bin/false',dockerContext:'NO_ENGINE',image:'sha256:'+'0'.repeat(64)}},()=>{
        if(!current)throw Error('SOURCE_CHANGED_DURING_VALIDATION');queueMicrotask(()=>current=false);
    }),/SOURCE_CHANGED_DURING_VALIDATION/);
    assert.equal(await fs.readFile(f.file,'utf8'),raw);f.pass();
});

test('close joins repair validation and keeps original invalid bytes',async t=>{
    const f=await fixture(t),raw='{"PRIVATE_INVALID';await fs.writeFile(f.file,raw);const edit=await f.startup.prepareEdit();let closing;
    await assert.rejects(edit.save({version:1},()=>{queueMicrotask(()=>{closing=f.startup.close();});}),/closing|changed while editing/);
    await closing;assert.equal(await fs.readFile(f.file,'utf8'),raw);f.pass();
});

test('source navigation during setup inspection opens no old-source dialog',async t=>{
    const f=await fixture(t),inspect=f.startup.inspect.bind(f.startup);let current=true;
    f.startup.inspect=async()=>{const view=await inspect();current=false;return view;};
    for(const text of ['/setup inspect','/setup save']) {
        current=true;const h=command(f,{isCurrent:()=>current});await assert.rejects(h.run(text),/source changed/);
        assert.deepEqual(h.inputs,[]);assert.deepEqual(h.choices,[]);assert.deepEqual(h.notices,[]);
    }
    f.pass();
});

test('a completed save stays completed after navigation without notifying another view',async t=>{
    const f=await fixture(t),prepare=f.startup.prepareEdit.bind(f.startup);let current=true;
    f.startup.prepareEdit=async()=>{const edit=await prepare();return {...edit,save:async(...args)=>{const result=await edit.save(...args);current=false;return result;}};};
    const h=command(f,{isCurrent:()=>current});assert.equal(await h.run('/setup save {"version":1}'),'completed');
    assert.deepEqual(JSON.parse(await fs.readFile(f.file)),{version:1});assert.deepEqual(h.notices,[]);f.pass();
});
