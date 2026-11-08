import {installedQualificationModule} from './qualification-sidecar.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function validateInstalledNormalTrace(rows,{payload,node}) {
    const installedRoot=pathToFileURL(payload+path.sep).href;
    const cliEntry=path.join(payload,'dist/cli/main.js');
    const helperEntry=path.join(payload,'dist/controller/capture-worker.js');
    const cli=[],helpers=[];
    for(const row of rows) {
        assert.equal(await fs.realpath(row.node),await fs.realpath(node),'Every runtime uses copied installed Node');
        assert.equal(row.controllerModule,pathToFileURL(path.join(payload,'dist/controller/controller.js')).href);
        assert.equal(row.testingModule,installedQualificationModule(payload,'controller-testing.js'));
        assert.ok(Array.isArray(row.productModules)&&row.productModules.every(value=>value.startsWith(installedRoot)),'Every resolved product module stays installed');
        assert.ok(Array.isArray(row.sdkModules)&&row.sdkModules.every(value=>value.startsWith(installedRoot)),'Every resolved SDK module stays installed');
        if(row.cliEntry===cliEntry) cli.push(row);
        else {
            assert.equal(row.cliEntry,helperEntry,'Unknown runtime entry is not silently discarded');
            assert.deepEqual(row.command,[]);
            assert.deepEqual(row.sdkModules,[],'Capture worker remains SDK-free');
            assert.ok(row.productModules.includes(pathToFileURL(helperEntry).href));
            helpers.push(row);
        }
    }
    assert.deepEqual(cli.map(row=>row.command.join(' ')),['effect register-target','change start','effect prepare-integration','effect delegate-integration','effect prepare-integration','effect dispatch','effect inspect']);
    for(const row of cli) if(row.command.join(' ')==='change start'||row.command.join(' ')==='effect prepare-integration'&&row.sdkModules.length) assert.ok(row.sdkModules.some(value=>value.includes('/pi-coding-agent/')));
    assert.equal(cli.at(-1).sdkModules.length,0,'Offline final inspection stays SDK-free');
    return {cli,helpers,rawRows:rows.length};
}
