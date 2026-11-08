import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import {createOwnedAcceptanceSetup, createdAcceptanceSession} from '../../dist/platform/hosted-context.js';
import {NativeGitCleanupError} from '../../dist/effects/native-git.js';
import {gitFixture,git} from './acceptance-git-fixture.mjs';
import {heldInitializer,assertGone} from '../ui/integration-initialization-fixture.mjs';
import {waitFile} from '../ui/integration-send-fixture.mjs';
test('created captured session preserves typed initialization cleanup uncertainty and original counters',{timeout:12000},async t=>{
 const f=await gitFixture(),setup=await createOwnedAcceptanceSetup({...f.setupOptions,ownedHttps:f.ownedHttps}),context=await setup.create(),session=createdAcceptanceSession(context),held=await heldInitializer({root:f.gitRoot,git},'init'),root=path.join(f.gitRoot,'held-created-cleanup'),abort=new AbortController(),before=setup.inspect().counters.nativeOperations;
 const task=session.openNativeGit({gitBinary:held.binary,ownedClientRoot:root,commandTimeoutMs:20000},abort.signal);void task.catch(()=>{});await waitFile(held.marker);
 const open=fsSync.openSync;fsSync.openSync=(file,...args)=>{if(String(file).startsWith(root+'/runs/')&&String(file).endsWith('/terminal.json')){const error=Error('Owned fixture denies created terminal evidence');error.code='EPERM';throw error;}return open(file,...args);};
 try{abort.abort(Error('Cancel created initialization'));await assert.rejects(task,error=>error instanceof NativeGitCleanupError&&error.recovery.includes(root));}finally{fsSync.openSync=open;}
 try{await assertGone(held.pids);assert.equal(setup.inspect().counters.nativeOperations,before+1);assert.equal(setup.inspect().counters.nativePushes,0);await assert.rejects(setup.close(),error=>error.message.includes(root));}finally{await f.close({preserve:true});}t.diagnostic('Preserved owned uncertainty evidence '+root);
});
