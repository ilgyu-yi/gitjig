// Module relocation and installed-SDK binding only; no installed product/engine qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
test('installed drivers can relocate the shared report producer with their existing single SDK binding', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'gitjig-relocated-fixture-')));
    try {
        const source = await fs.readFile('tests/controller/effect-fixture.mjs', 'utf8'), specifier = "'@earendil-works/pi-ai/compat'";
        assert.equal(source.split(specifier).length, 2);
        const digest = createHash('sha256').update(source).digest('hex');
        for (const name of ['normal-publication', 'normal-integration', 'normal-agent-integration']) {
            const driver = await fs.readFile('tests/installation/' + name + '.test.mjs', 'utf8');
            assert.ok(driver.includes('"tests/controller/effect-fixture.mjs": "' + digest + '"'), 'Reviewed installed source pin: ' + name);
        }
        await fs.writeFile(path.join(root, 'effect-fixture.mjs'), source.replace(specifier, JSON.stringify(import.meta.resolve('@earendil-works/pi-ai/compat'))));
        await fs.writeFile(path.join(root, 'consumer.mjs'), `import assert from 'node:assert/strict';import {scripted} from './effect-fixture.mjs';let calls=0;const producer=scripted(()=>{calls++;return{text:'Original English result'};});const model={api:'fixture-api',provider:'fixture',id:'fixture'},messages=[{role:'system',content:'Assigned fixture',timestamp:0,toolsAdded:[{name:'conversation_report',description:'Report',parameters:{type:'object',properties:{text:{type:'string'}},required:['text']}}]},{role:'user',content:[{type:'text',text:'Original assignment'}],timestamp:1}];const first=await producer.definition.streamSimple(model,{messages}).result();assert.equal(first.content[0].name,'conversation_report');assert.equal(first.content[0].arguments.text,'Original English result');const final=await producer.definition.streamSimple(model,{messages}).result();assert.equal(final.content[0].text,'Original English result');assert.equal(calls,1);console.log('relocated-report-producer-passed');`);
        const actual = await promisify(execFile)(process.execPath, [path.join(root, 'consumer.mjs')], { cwd: root, env: { PATH: path.dirname(process.execPath), HOME: root, NODE_OPTIONS: '', NODE_PATH: '' }, timeout: 10000, maxBuffer: 65536 });
        assert.equal(actual.stdout.trim(), 'relocated-report-producer-passed');
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
