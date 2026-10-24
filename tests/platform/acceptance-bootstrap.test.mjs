import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createOwnedFixedAcceptanceSetup, createOwnedAcceptanceSetup} from '../../dist/platform/hosted-context.js';
import { captureAcceptanceCredential, openCreatedAcceptanceGit } from '../../dist/effects/native-git.js';
import { acceptanceSyntheticFiles } from '../../.qualification/acceptance-synthetic.js';
import { gitFixture, command } from './acceptance-git-fixture.mjs';
async function empty(f) {
    const refs=(await command(f.gitRoot,f.receiver,['for-each-ref','--format=%(refname)'])).toString().trim().split('\n');
    for (const ref of refs) if(ref) await command(f.gitRoot,f.receiver,['update-ref','-d',ref]);
    f.state.native={command:args=>command(f.gitRoot,f.receiver,args)};
}
test('fixed empty-main bootstrap, five exact refs and controlled peer use actual supervised TLS and fixed assets',async t=>{
    const f=await gitFixture(); let setup;
    try {
        await empty(f); setup=await createOwnedFixedAcceptanceSetup({...f.setupOptions,ownedHttps:f.ownedHttps});
        const c=await setup.create(); assert.equal(setup.inspect().nativeOperationLimit,96);
        assert.equal(Object.hasOwn(setup,'nativeCapture'),false);assert.equal(setup.nativeCapture,undefined);
        assert.throws(()=>openCreatedAcceptanceGit(c,captureAcceptanceCredential(f.setupOptions.token),f.profile('foreign-capture'),f.ownedHttps.execPath),/Different native credential capture/);
        const h=await setup.prepareBootstrapMain(c,{clientProfile:f.profile('bootstrap')});
        assert.equal((await setup.invokePreparedSetup(h)).transport,'native-success');
        assert.throws(()=>setup.invokePreparedSetup(h),/consumed/);
        assert.equal((await setup.reconcileSetupStep(c,'bootstrap-main')).kind,'contains-integration');
        for(const [name,bytes] of Object.entries(acceptanceSyntheticFiles)) assert.equal((await command(f.gitRoot,f.receiver,['show',h.integrationCommit+':'+name])).toString(),bytes);
        assert.equal((await setup.createFixtureBranches(c)).length,5);
        assert.equal((await setup.createFixtureBranches(c)).length,5);
        assert.equal(f.state.calls.filter(r=>r.method==='POST'&&r.path.endsWith('/git/refs')).length,5);
        const peer=await setup.prepareRacePeer(c,{clientProfile:f.profile('peer'),expectedBase:h.integrationCommit});
        assert.equal((await setup.invokePreparedSetup(peer)).transport,'native-success');
        assert.equal((await setup.reconcileSetupStep(c,'race-peer')).kind,'contains-integration');
        assert.equal((await command(f.gitRoot,f.receiver,['rev-parse','refs/heads/fixture/race'])).toString().trim(),peer.integrationCommit);
        assert.equal(setup.inspect().counters.nativePushes,2);
        t.diagnostic(JSON.stringify({reads:setup.inspect().counters.reads,writes:setup.inspect().counters.writes,nativeOperations:setup.inspect().counters.nativeOperations,pushes:2,fixtureRoot:f.gitRoot}));
    } finally {await setup?.close();await f.close();}
});
test('ref response drop is readonly recovered without second POST; old64 profile remains64 through new fixed factory',async()=>{
    const f=await gitFixture();let setup;
    try {
        await empty(f);setup=await createOwnedFixedAcceptanceSetup({...f.setupOptions,ownedHttps:f.ownedHttps});const c=await setup.create();
        const h=await setup.prepareBootstrapMain(c,{clientProfile:f.profile('bootstrap')});await setup.invokePreparedSetup(h);await setup.reconcileSetupStep(c,'bootstrap-main');
        f.state.native.dropRef='fixture/ordinary';await assert.rejects(setup.createFixtureBranches(c));
        const before=f.state.calls.filter(r=>r.method==='POST'&&r.body?.ref==='refs/heads/fixture/ordinary').length;
        f.state.native.dropRef=null;await setup.createFixtureBranches(c);
        assert.equal(before,1);assert.equal(f.state.calls.filter(r=>r.method==='POST'&&r.body?.ref==='refs/heads/fixture/ordinary').length,1);
        assert.equal(setup.inspect().setupSteps['ref:fixture/ordinary'].transport,'uncertain');
        await setup.close();setup=null;
        const oldRoot=path.join(f.directory,'legacy');const old=await createOwnedAcceptanceSetup({...f.setupOptions,journalRoot:oldRoot});await old.close();
        const fixed=await createOwnedFixedAcceptanceSetup({...f.setupOptions,journalRoot:oldRoot,ownedHttps:f.ownedHttps});assert.equal(fixed.inspect().nativeOperationLimit,64);await fixed.close();
    }finally{await setup?.close();await f.close();}
});
test('preexisting unexpected ref refuses empty-main bootstrap before any push and copied context is rejected',async()=>{
    const f=await gitFixture();let setup;
    try{
        await empty(f);await command(f.gitRoot,f.receiver,['update-ref','refs/heads/unexpected',f.B]);
        setup=await createOwnedFixedAcceptanceSetup({...f.setupOptions,ownedHttps:f.ownedHttps});const c=await setup.create();
        await assert.rejects(setup.prepareBootstrapMain(c,{clientProfile:f.profile('refuse')}),/Unexpected|precondition/);
        assert.equal(setup.inspect().counters.nativePushes,0);assert.equal(f.requests.filter(r=>r.path.includes('git-receive-pack')).length,0);
        assert.throws(()=>setup.prepareBootstrapMain(structuredClone(c),{clientProfile:f.profile('copy')}),/context/);
    }finally{await setup?.close();await f.close();}
});
test('fixed96 actual native admissions exhaust once and retain the ceiling/count across setup reopen',async()=>{
    const f=await gitFixture();let setup;
    try{
        const options={...f.setupOptions,ownedHttps:f.ownedHttps};setup=await createOwnedFixedAcceptanceSetup(options);const c=await setup.create();
        const client=await setup.openNativeGit(c,f.profile('cap-client'));
        const before=f.requests.length;
        while(setup.inspect().counters.nativeOperations<96) await assert.rejects(client.observeHttpsRef({...c.target,ref:'refs/heads/main'},AbortSignal.abort()));
        assert.throws(()=>client.observeHttpsRef({...c.target,ref:'refs/heads/main'}),/allowance/);assert.equal(f.requests.length,before);
        await setup.close();setup=await createOwnedFixedAcceptanceSetup(options);const current=await setup.reopen();
        assert.equal(setup.inspect().nativeOperationLimit,96);assert.equal(setup.inspect().counters.nativeOperations,96);
        assert.throws(()=>setup.openNativeGit(current,f.profile('after-cap')),/allowance/);
    }finally{await setup?.close();await f.close();}
});
