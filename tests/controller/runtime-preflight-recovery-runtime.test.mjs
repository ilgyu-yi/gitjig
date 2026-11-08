import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {scripted,withValueCases} from './effect-fixture.mjs';

test('explicit same-work recovery after setup refusal preserves original charge and completes with a valid engine', {timeout:60000}, async t => {
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parent && path.isAbsolute(parent));assert.equal(await fs.realpath(parent),parent);
    const checkout = await fs.realpath('.');assert.ok(parent!==checkout&&!parent.startsWith(checkout+path.sep));
    const runtimeProfile = {dockerBinary:process.env.GITJIG_DOCKER_BINARY,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
    assert.ok(Object.values(runtimeProfile).every(Boolean),'Explicit existing pinned engine required');
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent,'runtime-preflight-recovery-'))), home = path.join(root,'home'), source = path.join(root,'source');
    await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');
    const checker = withValueCases("const value=require('./consumer.cjs');console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:value===3}]}));\n");
    await fs.writeFile(path.join(source,'check.cjs'),checker);
    const oldTmp = process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
    let c;
    try {
        c = await openController({installationHome:home,runtimeProfile:{...runtimeProfile,image:undefined}});
        await c.registerProject({id:'P',sourceRoot:source});
        const {workId} = await c.beginChange({projectId:'P',request:'Consumer must export3; preserve the checker.'});
        const model = scripted();
        let view = await c.planChange({workId,model});
        assert.equal(view.phase,'BLOCKED');assert.notEqual(c.inspectWork(workId).state,'UNKNOWN');
        const refused = c.store.one("SELECT * FROM runs WHERE work=? AND json_extract(data,'$.kind')='governed-role'",workId);
        assert.equal(refused.phase,'SETTLED');assert.equal(refused.reservation,'consumed');assert.equal(JSON.parse(refused.data).cleanup,'not-allocated');
        assert.deepEqual(await fs.readdir(path.join(home,'state/runtime')),[]);
        const consumed = view.execution.consumed;
        await c.close();
        c = await openController({installationHome:home,runtimeProfile});
        view = await c.driveChange({workId,model});
        assert.equal(view.reviewReady,true,JSON.stringify(view.blocked));
        assert.ok(view.execution.consumed>consumed);assert.equal(view.execution.reserved,0);
        assert.deepEqual(c.store.one('SELECT * FROM runs WHERE id=?',refused.id),refused);
        assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');
        assert.equal(await fs.readFile(path.join(source,'check.cjs'),'utf8'),checker);
        await fs.writeFile(path.join(root,'result.json'),JSON.stringify({workId,originalRefusalRun:refused,originalConsumed:consumed,final:view},null,2));
    } finally {
        await c?.close();if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;
        t.diagnostic('Retained owned runtime evidence '+root);
    }
});
