import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {nodePreloads} from '../helpers/node-preloads.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);

test('actual terminal protects the exact draft and original diagnostic through a storage retry', {timeout:20000}, async t => {
    const root = await temporaryDirectory('ui-draft'), home = path.join(root,'home');
    const {openController} = await import('../../dist/controller/index.js');
    const setup = await openController({installationHome:home});
    await setup.close();
    const cfg = {
        home, control:path.join(root,'control.json'), recover:path.join(root,'recover'),
        receipt:path.join(root,'receipt.json'), draft:'  UNSAVED 한국어 exact draft  ',
    };
    const child = path.join(root,'child.json'), driver = path.join(root,'driver.json');
    await fs.writeFile(child,JSON.stringify(cfg));
    await fs.writeFile(driver,JSON.stringify({
        ...cfg, artifacts:path.join(home,'artifacts'), output:path.join(root,'terminal.bin'),
        command:[process.execPath,...nodePreloads(),path.resolve('tests/ui/draft-failure-child.mjs'),child],
    }));
    try {
        const actual = JSON.parse((await exec('python3',[path.resolve('tests/ui/draft-failure.py'),driver],
            {timeout:17000,maxBuffer:1024*1024})).stdout);
        assert.equal(actual.exitCode,0);
        assert.equal(actual.terminalRestored,true);
        const receipt = JSON.parse(await fs.readFile(cfg.receipt,'utf8'));
        assert.equal(receipt.draft.text,cfg.draft);
        assert.equal(receipt.ackText,cfg.draft);
        assert.equal(receipt.conversations,2);
        assert.equal(receipt.runs,0);
        assert.equal(receipt.inputs,0);
        for (const action of ['draft-only-retry-while-full','draft-only-retry-after-recovery','original-diagnostic-preserved'])
            assert.ok(actual.actions.includes(action),action);
        assert.ok(receipt.failed>0 && receipt.createFailed>0 && receipt.splitFailed>0);
        await fs.rm(root,{recursive:true});
    } catch (error) {
        t.diagnostic('retained '+root);
        throw error;
    }
});
