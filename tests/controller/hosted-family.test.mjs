import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openController} from '../../dist/controller/index.js';
test('actual Store integration readers and action entry reject mixed publication/configuration families; local legacyNULL remains explicit',{timeout:10000},async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-hosted-family-'))),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'x'),'x');const c=await openController({installationHome:path.join(root,'home')});let passed=false;
 try{await c.registerProject({id:'P',sourceRoot:source});const w=await c.beginChange({projectId:'P',request:'Family negative fixture'});
 // Deliberately constructed family-mismatch records exercise pre-interpretation
 // rejection only. They are not native evidence, an eligible candidate or authority.
 for(const kind of ['publication','github-configuration','github-existing-ref','local-git',null]){const id='target-'+String(kind),op='op-'+String(kind),data={...(kind===null?{}:{kind}),target:{canonicalPath:'/fixture/not-opened.git',ref:'refs/heads/main'},basisCommit:'a'.repeat(40)};c.store.run('INSERT INTO effect_targets VALUES(?,?,?)',id,'P',JSON.stringify(data));c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','grant-'+id,w.workId,id,1,JSON.stringify({...(kind===null?{}:{kind}),mode:'ordinary',scope:'work',rootEpoch:1,operationLimit:2,projectId:'P'}));c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',op,w.workId,id,'grant-'+id,'PREPARED',JSON.stringify({...(kind===null?{}:{kind}),grantEpoch:1}));
 if(kind==='publication'||kind==='github-configuration'){assert.throws(()=>c.inspectEffect(op),/family/);await assert.rejects(c.dispatchIntegration({operationId:op}),/family/);await assert.rejects(c.reconcileEffect({operationId:op}),/family/);}
 else{assert.equal(c.inspectEffect(op).operationId,op);assert.throws(()=>c.inspectPublication(op),/publication|family/i);assert.throws(()=>c.inspectRepositoryConfiguration(op),/configuration|family/i);}
 }
 // UNKNOWN ordinary work or an isolated-observation flag alone cannot acquire
 // a native/project slot without the actual original quarantine provenance.
 c.store.run('UPDATE works SET state=? WHERE id=?','UNKNOWN',w.workId);
 for(const flagged of [false,true]){const runId='untrusted-observation-'+flagged,work=c.store.one('SELECT * FROM works WHERE id=?',w.workId);c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',runId,w.workId,work.epoch,work.generation,'CREATED',path.join(root,runId),'released',JSON.stringify({kind:'native-effect',operationId:'op-github-existing-ref',readOnlyObservation:flagged,originalRunId:'missing',generation:work.generation,clientRoot:path.join(root,runId)}));assert.throws(()=>c.capacity.acquire({workId:w.workId,runId,epoch:work.epoch,kind:'check'}),/stale work\/run provenance/);assert.equal(c.store.one('SELECT COUNT(*) AS n FROM capacity_leases WHERE run=?',runId).n,0);}
 assert.equal(c.store.all('SELECT * FROM effect_receipts').length,0);assert.equal(c.store.all('SELECT * FROM runs WHERE phase=?','RUNNING').length,0);passed=true;
 }finally{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else console.error('Retained family fixture '+root);}
});
