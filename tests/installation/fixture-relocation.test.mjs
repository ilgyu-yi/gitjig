// Module relocation and installed-SDK binding only; no installed product/engine qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { temporaryDirectory } from '../helpers/temporary-directory.mjs';
import { installedQualification } from './qualification-sidecar.mjs';
import { copyEffectFixture, installedFixtureIO } from './normal-installed-fixtures.mjs';

test('qualification sidecars stay outside the checkout and retain their module type', async t => {
    const harness = await temporaryDirectory('qualification-relocation');
    t.after(() => fs.rm(harness, { recursive: true, force: true }));
    const payload = path.join(harness, 'installed payload');
    await fs.mkdir(payload);
    const sidecar = installedQualification(payload);
    t.after(() => fs.rm(sidecar.record.root, { recursive: true, force: true }));
    const checkout = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));
    const root = await fs.realpath(sidecar.record.root);
    assert.equal(root, sidecar.record.root);
    assert.ok(path.relative(checkout, root).startsWith('..' + path.sep));
    assert.equal((await fs.stat(root)).mode & 0o777, 0o700);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).type, 'module');
    assert.equal(typeof (await import(sidecar.url('acceptance-synthetic.js'))).assertAcceptanceSynthetic, 'function');
    assert.equal(installedQualification(payload), sidecar);

    const alias = path.join(harness, 'checkout alias');
    await fs.symlink(checkout, alias);
    assert.throws(() => installedQualification(payload, alias), /outside the checkout/);
});

test('installed drivers share a reviewed relocation of the report producer and its verification fixture', async () => {
    const root = await temporaryDirectory('relocated-fixture');
    try {
        for (const lane of ['publication', 'integration', 'agent-integration']) {
            const originals = {}, generated = {}, substitutions = [];
            const io = installedFixtureIO({ lane, root, originals, generated, substitutions });
            await copyEffectFixture(io, 'effect-fixture.mjs', import.meta.resolve('@earendil-works/pi-ai/compat'));
            assert.deepEqual(Object.keys(originals).sort(),
                ['tests/controller/effect-fixture.mjs', 'tests/workflow/current-verification-fixture.mjs']);
            assert.deepEqual(Object.keys(generated).sort(), ['current-verification-fixture.mjs', 'effect-fixture.mjs']);
            assert.deepEqual(substitutions.map(substitution => substitution.count), [1, 1]);
            await assert.rejects(io.read('tests/installation/normal-installed-fixtures.mjs'), /not in the reviewed/);
        }
        await fs.writeFile(path.join(root, 'consumer.mjs'), `import assert from 'node:assert/strict';import {scripted} from './effect-fixture.mjs';let calls=0;const producer=scripted(()=>{calls++;return{text:'Original English result'};});const model={api:'fixture-api',provider:'fixture',id:'fixture'},messages=[{role:'system',content:'Assigned fixture',timestamp:0,toolsAdded:[{name:'conversation_report',description:'Report',parameters:{type:'object',properties:{text:{type:'string'}},required:['text']}}]},{role:'user',content:[{type:'text',text:'Original assignment'}],timestamp:1}];const first=await producer.definition.streamSimple(model,{messages}).result();assert.equal(first.content[0].name,'conversation_report');assert.equal(first.content[0].arguments.text,'Original English result');const final=await producer.definition.streamSimple(model,{messages}).result();assert.equal(final.content[0].text,'Original English result');assert.equal(calls,1);console.log('relocated-report-producer-passed');`);
        const actual = await promisify(execFile)(process.execPath, [path.join(root, 'consumer.mjs')], { cwd: root, env: { PATH: path.dirname(process.execPath), HOME: root, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 10000, maxBuffer: 65536 });
        assert.equal(actual.stdout.trim(), 'relocated-report-producer-passed');
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
