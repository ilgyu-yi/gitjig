import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
import {configureOwnedPublicationFixture} from '../../.qualification/controller-testing.js';
import {publicationServer,target,issue} from './publication-fixture.mjs';

test('interaction host leave joins an accepted HTTP publication without cancelling W or resending on reopen', {timeout:10000}, async()=>{
 const server=await publicationServer();
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-publication-leave-')));
 const installationHome=path.join(root,'home');
 let c=await openController({installationHome}),passed=false,barrier;
 try {
  const t=c.registerPublicationTarget({target,visibility:'public'});
  configureOwnedPublicationFixture(c,{origin:server.origin,token:'fixture-original'});
  const prepared=await c.prepareOwnerPublication({targetId:t.targetId,action:issue()});
  assert.equal(prepared.phase,'RESERVED');
  const before=c.inspectWork(prepared.workId);
  barrier=server.holdNextPost();
  const dispatch=c.dispatchPublication({operationId:prepared.operationId});
  await barrier.entered;
  assert.equal(server.rows.length,1,'Server accepted the request before the client loses its response');
  await c.settleInteractionHost({identities:[]});
  const stopped=await dispatch;
  assert.equal(stopped.phase,'UNKNOWN',JSON.stringify(stopped));
  const work=c.inspectWork(prepared.workId);
  assert.equal(work.epoch,before.epoch,'Leaving the UI does not revoke the work epoch');
  assert.notEqual(work.state,'CANCELLED');
  assert.equal(work.allowance.reserved,0);
  assert.equal(c.active.size,0);
  assert.equal(c.store.one("SELECT COUNT(*) AS n FROM runs WHERE phase NOT IN ('SETTLED','INTERRUPTED')").n,0);
  assert.equal(server.requests.filter(r=>r.method==='POST').length,1);
  barrier.release();
  await c.close();
  c=await openController({installationHome});
  configureOwnedPublicationFixture(c,{origin:server.origin,token:'fixture-weak'});
  const recovered=await c.reconcilePublication({operationId:prepared.operationId});
  assert.equal(recovered.phase,'CONFIRMED',JSON.stringify(recovered));
  assert.equal(recovered.transportOutcome,'uncertain');
  assert.equal(server.requests.filter(r=>r.method==='POST').length,1,'Recovery only reads the accepted resource');
  assert.equal(c.store.one("SELECT COUNT(*) AS n FROM effect_receipts WHERE operation=? AND kind='publication-send' AND json_extract(data,'$.outcome')='confirmed'",prepared.operationId).n,0);
  assert.equal(c.store.one('SELECT COUNT(*) AS n FROM effect_operations').n,1);
  passed=true;
 } finally {
  barrier?.release();
  await c.close();
  await server.close();
  if(passed)await fs.rm(root,{recursive:true,force:true});
  else console.error('Retained publication host-leave fixture: '+root);
 }
});
