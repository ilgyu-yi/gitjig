import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {integrationWorld,snapshot} from './integration-registry-fixture.mjs';
test('bounded integration target registry retains unavailable records and separates foreign families without opening native clients',async t=>{const f=await integrationWorld(t),data=JSON.parse(f.c.store.one('SELECT data FROM effect_targets WHERE id=?',f.target).data);for(const [id,value] of [['second',{...data,target:{...data.target,targetId:'second'}}],['malformed','{broken'],['oversized','x'.repeat(131073)],['unknown',{kind:'unknown'}]])f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',id,'P',typeof value==='string'?value:JSON.stringify(value));f.c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','configuration',null,'{"kind":"github-configuration"}');const before=snapshot(f.c);f.c.effects.client=()=>{throw Error('Pure target view must not open client');};const page=f.c.listIntegrationTargets({limit:2});assert.deepEqual(page.targets.map(row=>row.targetId),['unknown','oversized']);assert.ok(page.targets.every(row=>row.state==='UNAVAILABLE'));const next=f.c.listIntegrationTargets({limit:2,before:page.nextCursor});assert.deepEqual(next.targets.map(row=>row.targetId),['malformed','second']);assert.equal(next.targets[1].state,'RETAINED');assert.equal(f.c.inspectIntegrationTarget(f.target).state,'RETAINED');assert.throws(()=>f.c.listIntegrationTargets({before:'configuration'}),/cursor/);assert.equal(snapshot(f.c),before);f.pass();});

test('project-scoped receiver pages retain unavailable rows and reject foreign cursors',async t=>{
    const f=await integrationWorld(t),c=f.c;
    const other=path.join(f.root,'other-project');
    await fs.mkdir(other);
    await c.registerProject({id:'Q',sourceRoot:other});
    c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','unavailable-P','P','{broken');
    for(let index=0;index<26;index++)
        c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','foreign-'+index,'Q','{broken');
    const before=snapshot(c);
    c.effects.client=()=>assert.fail('Receiver catalogue opens no Native client');
    assert.deepEqual(c.listIntegrationTargets({limit:25}).targets.map(row=>row.projectId),Array(25).fill('Q'));
    const page=c.listIntegrationTargets({projectId:'P',limit:1});
    assert.deepEqual(page.targets.map(row=>[row.targetId,row.state]),[['unavailable-P','UNAVAILABLE']]);
    assert.equal(page.nextCursor,'unavailable-P');
    const older=c.listIntegrationTargets({projectId:'P',limit:1,before:page.nextCursor});
    assert.deepEqual(older.targets.map(row=>[row.targetId,row.state]),[[f.target,'RETAINED']]);
    assert.equal(older.nextCursor,null);
    assert.throws(()=>c.listIntegrationTargets({projectId:'P',before:'foreign-25'}),/cursor/);
    assert.equal(snapshot(c),before);
    f.pass();
});
