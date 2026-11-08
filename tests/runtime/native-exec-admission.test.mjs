import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {installationProcessRunner} from '../installation/offline-source-fixture.mjs';
import {reconcileScope} from '../../dist/execution/container-scope.js';

for (const mode of ['missing-interpreter','removed-before-create','permission-before-create','persistence-failure','directory-sync-failure','synchronous-lookalike','launched-127','exec-not-started','governed-reopen','governed-removed-before-create','governed-permission-before-create']) {
    test('original native executable admission: ' + mode, async t => {
        const root=await temporaryDirectory('native-exec-admission'),invocations=[],groups=new Set();
        const run=installationProcessRunner({root,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root},invocations,groups});
        let passed=false;
        t.after(async()=>{if(passed&&groups.size===0)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original native exec admission fixture: '+root);});
        await run(process.execPath,[fileURLToPath(new URL('./native-exec-admission-worker.mjs',import.meta.url)),root,mode],'original-worker',{timeout:15000});
        const result=JSON.parse(await fs.readFile(path.join(root,'result.json')));
        const create=result.events.filter(event=>event.command==='create');
        if(['missing-interpreter','removed-before-create','permission-before-create','persistence-failure','directory-sync-failure'].includes(mode)) {
            assert.deepEqual(create.map(row=>row.event),['returned','error','close']);
            assert.ok(create.every(row=>row.pid===null));
            assert.match(create[1].code,/^(ENOENT|EACCES)$/);
        } else if(mode==='launched-127') assert.ok(create.some(row=>row.event==='spawn'&&row.pid>0));
        else if(mode==='synchronous-lookalike') assert.deepEqual(create,[]);
        assert.equal(groups.size,0);passed=true;
    });
}

test('terminal journal reads require original identity and still respect native cleanup uncertainty', async t => {
    const root=await temporaryDirectory('terminal-scope-receipt'),file=path.join(root,'scope.json'),missing=path.join(root,'missing-client');
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    // Explicit controlled receipt premises; native success is not inferred here.
    const original={version:1,context:'owned',nonce:'12345678-1234-1234-1234-123456789abc',workId:'original-work',runId:'original-run',state:'removed',id:''};
    await fs.writeFile(file,JSON.stringify(original));
    assert.equal((await reconcileScope(file,missing,path.join(root,'missing-config'))).state,'removed');
    assert.deepEqual(JSON.parse(await fs.readFile(file)),original);
    const uncertain={...original,nativeCleanupUnknown:{version:1,processGroup:123,reason:'Original unconfirmed native group'}};
    await fs.writeFile(file,JSON.stringify(uncertain));
    assert.equal((await reconcileScope(file,missing)).state,'quarantined');
    assert.deepEqual(JSON.parse(await fs.readFile(file)),uncertain);
    for(const saved of [{...original,runId:null},{...original,nonce:'invalid'},{...original,state:'creating'}]) {
        await fs.writeFile(file,JSON.stringify(saved));
        await assert.rejects(reconcileScope(file,missing));
        assert.deepEqual(JSON.parse(await fs.readFile(file)),saved);
    }
});
