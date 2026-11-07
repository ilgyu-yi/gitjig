import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {writeSourceProposalArtifact,readSourceProposalArtifact,sourceProposalLimit} from '../../dist/controller/source-proposal-artifact.js';
import {openController} from '../../dist/controller/index.js';

async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-proposal-io-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('owned proposal artifact is immutable exact JSON with private same-FD readback',async t=>{
 const root=await fixture(t),body={protocol:'mechanical-IO-only',text:'exact 한글 bytes',list:[1,2]},ref=await writeSourceProposalArtifact(root,body,()=>{});
 assert.deepEqual(await readSourceProposalArtifact(root,ref,()=>{}),body);assert.equal(ref.bytes,Buffer.byteLength(JSON.stringify(body)));
 assert.equal((await fs.stat(path.join(root,'artifacts/source-snapshot-proposals',ref.hash+'.json'))).mode&0o777,0o600);
 assert.deepEqual(await writeSourceProposalArtifact(root,body,()=>{}),ref);
 assert.deepEqual((await fs.readdir(path.join(root,'artifacts/source-snapshot-proposals'))),[ref.hash+'.json']);
});
test('altered content-address file refuses without overwrite or a repaired body',async t=>{
 const root=await fixture(t),body={purpose:'mechanical-IO'},ref=await writeSourceProposalArtifact(root,body,()=>{}),file=path.join(root,'artifacts/source-snapshot-proposals',ref.hash+'.json');
 await fs.writeFile(file,'x'.repeat(ref.bytes));await assert.rejects(readSourceProposalArtifact(root,ref,()=>{}),/bytes changed/);await assert.rejects(writeSourceProposalArtifact(root,body,()=>{}),/bytes changed/);
 assert.equal(await fs.readFile(file,'utf8'),'x'.repeat(ref.bytes));
});
test('artifact symlink and overbound body refuse; external target is preserved',async t=>{
 const root=await fixture(t),ref=await writeSourceProposalArtifact(root,{data:'owned'},()=>{}),file=path.join(root,'artifacts/source-snapshot-proposals',ref.hash+'.json'),external=path.join(root,'external');
 await fs.writeFile(external,'preserve');await fs.unlink(file);await fs.symlink(external,file);await assert.rejects(readSourceProposalArtifact(root,ref,()=>{}));assert.equal(await fs.readFile(external,'utf8'),'preserve');
 await assert.rejects(writeSourceProposalArtifact(root,{data:'x'.repeat(sourceProposalLimit)},()=>{}),/exceeds/);
});
test('abort/source refusal during actual artifact write joins FD cleanup and leaves no temporary file',async t=>{
 const root=await fixture(t),original=fs.open;let closed=false,refuse=false;
 fs.open=async(...args)=>{const h=await original(...args);if(String(args[0]).endsWith('.tmp')){const close=h.close.bind(h),write=h.writeFile.bind(h);h.writeFile=async(...a)=>{await write(...a);refuse=true;};h.close=async()=>{await close();closed=true;};}return h;};
 try{await assert.rejects(writeSourceProposalArtifact(root,{data:'actual owned write'},()=>{if(refuse)throw Error('ORIGINAL_SOURCE_DRIFT');}),/ORIGINAL_SOURCE_DRIFT/);}finally{fs.open=original;}
 assert.equal(closed,true);assert.deepEqual(await fs.readdir(path.join(root,'artifacts/source-snapshot-proposals')),[]);
});
test('captured private namespace replacement preserves the foreign directory and original failed temporary file',async t=>{
 const root=await fixture(t),original=fs.open;let replaced=false,retained;
 fs.open=async(...args)=>{const h=await original(...args);if(!replaced&&String(args[0]).endsWith('.tmp')){replaced=true;const dir=path.dirname(String(args[0]));retained=dir+'-retained';await fs.rename(dir,retained);await fs.mkdir(dir,{mode:0o700});await fs.writeFile(path.join(dir,'foreign'),'preserve');}return h;};
 try{await assert.rejects(writeSourceProposalArtifact(root,{data:'no foreign write'},()=>{}),/namespace|cleanup/);}finally{fs.open=original;}
 assert.equal(await fs.readFile(path.join(root,'artifacts/source-snapshot-proposals/foreign'),'utf8'),'preserve');assert.equal((await fs.readdir(retained)).length,1);
});
test('actual Controller missing standing and asynchronous/reentrant guard create no preview/version/action or spend',async t=>{
 const root=await fixture(t),c=await openController({installationHome:path.join(root,'home'),effectsProfile:{gitBinary:'/opt/homebrew/bin/git'},sourceGitRoute:{kind:'available',environment:{home:root}}});
 const ledger=()=>JSON.stringify(['works','runs','budgets','effect_targets','effect_delegations','effect_operations','change_versions','source_branch_previews'].map(table=>c.store.all('SELECT * FROM '+table)));
 try{
  const before=ledger();let result=await c.prepareSourceSnapshot({workId:'missing',destinationBranch:'reviewed'});assert.equal(result.kind,'held');assert.match(result.reason,/Missing governed work|checkpoint|scope/);assert.equal(ledger(),before);
  result=await c.prepareSourceSnapshot({workId:'missing',destinationBranch:'reviewed'},{validate:async()=>{}});assert.equal(result.kind,'held');assert.match(result.reason,/synchronous/);assert.equal(ledger(),before);
  let close;result=await c.prepareSourceSnapshot({workId:'missing',destinationBranch:'reviewed'},{validate(){close=c.close();}});assert.equal(result.kind,'held');await close;
 }finally{await c.close();}
});

for(const value of [0,undefined])test('falsey artifact guard rejection remains a failure and never publishes: '+String(value),async t=>{
 const root=await fixture(t),original=fs.open;let armed=false,thrown=false;
 fs.open=async(...args)=>{const h=await original(...args);if(String(args[0]).endsWith('.tmp')){const write=h.writeFile.bind(h);h.writeFile=async(...a)=>{await write(...a);armed=true;};}return h;};
 try{await assert.rejects(writeSourceProposalArtifact(root,{data:'actual write before falsey refusal'},()=>{if(armed&&!thrown){thrown=true;throw value;}}),error=>error===value);}finally{fs.open=original;}
 assert.equal(thrown,true);assert.deepEqual(await fs.readdir(path.join(root,'artifacts/source-snapshot-proposals')),[]);
});
test('replacement of original temporary path before publication is refused without publishing or unlinking foreign leaf',async t=>{
 const root=await fixture(t),original=fs.open;let replaced,retained;
 fs.open=async(...args)=>{const h=await original(...args);if(String(args[0]).endsWith('.tmp')){const close=h.close.bind(h);h.close=async()=>{await close();replaced=String(args[0]);retained=replaced+'-original';await fs.rename(replaced,retained);await fs.writeFile(replaced,'foreign',{mode:0o600});};}return h;};
 try{await assert.rejects(writeSourceProposalArtifact(root,{data:'original'},()=>{}),/temporary path changed|cleanup/);}finally{fs.open=original;}
 assert.equal(await fs.readFile(replaced,'utf8'),'foreign');assert.equal((await fs.readdir(path.dirname(replaced))).some(n=>n.endsWith('.json')),false);assert.equal(await fs.readFile(retained,'utf8'),JSON.stringify({data:'original'}));
});

test('controlled malformed retained scalar rows are refused by bounded SQL before artifact IO',async t=>{
 const root=await fixture(t),c=await openController({installationHome:path.join(root,'home')}),id='cb96bb27-ce80-4408-85ab-ac6bb559ef8c';
 try{
  // Explicit mechanical catalogue premise only: no procedure standing or publication proof.
  c.store.run('INSERT INTO sources VALUES(?,?,?,?)','mechanical-source',null,'{}','Controlled malformed-row test');
  c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)','mechanical-work',null,'mechanical-source',null,'mechanical-work','DELIVERED',1,1,null,'{}');
  c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',id,'mechanical-work','source-snapshot-proposal','candidate','x'.repeat(65536),'0'.repeat(64),'{}');
  const original=fs.open;let opened=false;fs.open=async(...args)=>{opened=true;return original(...args);};
  try{await assert.rejects(c.inspectSourceSnapshotProposal({workId:'mechanical-work',proposalId:id}),/scoped proposal unavailable/);}finally{fs.open=original;}
  assert.equal(opened,false);
  c.store.run('UPDATE change_versions SET artifact=?,hash=? WHERE id=?','/unused','x'.repeat(65536),id);
  await assert.rejects(c.inspectSourceSnapshotProposal({workId:'mechanical-work',proposalId:id}),/scoped proposal unavailable/);
  c.store.run('UPDATE change_versions SET id=? WHERE id=?','x'.repeat(65536),id);
  assert.throws(()=>c.listSourceSnapshotProposals({workId:'mechanical-work'}),/rowid [0-9]+.*bounded identity/);
 }finally{await c.close();}
});

test('actual new artifact reader refuses an owned FIFO without a peer in an isolated bounded Node caller',async t=>{
 const root=await fixture(t),ref=await writeSourceProposalArtifact(root,{data:'original'},()=>{}),file=path.join(root,'artifacts/source-snapshot-proposals',ref.hash+'.json'),saved=path.join(root,'original-artifact.json');
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{pathToFileURL}=await import('node:url'),execute=promisify(execFile);
 await fs.rename(file,saved);await execute('/usr/bin/mkfifo',['-m','600',file]);
 const module=pathToFileURL(path.resolve('dist/controller/source-proposal-artifact.js')).href;
 const program=`import {readSourceProposalArtifact} from ${JSON.stringify(module)};try{await readSourceProposalArtifact(${JSON.stringify(root)},${JSON.stringify(ref)},()=>{});process.exitCode=2;}catch(e){console.log(JSON.stringify({refused:true,message:e.message}));}`;
 try{
  const child=await execute(process.execPath,['--input-type=module','-e',program],{timeout:2500,maxBuffer:8192});
  const result=JSON.parse(child.stdout);assert.equal(result.refused,true);assert.match(result.message,/artifact file unavailable/);
 }finally{await fs.unlink(file);await fs.rename(saved,file);}
 assert.deepEqual(await readSourceProposalArtifact(root,ref,()=>{}),{data:'original'});
});

test('verified artifact metadata proof refuses a later same-path byte change after full readback',async t=>{
 const {verifySourceProposalArtifact}=await import('../../dist/controller/source-proposal-artifact.js');
 const root=await fixture(t),ref=await writeSourceProposalArtifact(root,{data:'original'},()=>{}),proof=await verifySourceProposalArtifact(root,ref,()=>{});
 proof.assertCurrentMetadata();await fs.writeFile(path.join(root,'artifacts/source-snapshot-proposals',ref.hash+'.json'),'x'.repeat(ref.bytes));assert.throws(()=>proof.assertCurrentMetadata(),/artifact changed/);
});

test('original proposal inspection observes caller cancellation before artifact/capture reads',async t=>{const root=await fixture(t),c=await openController({installationHome:path.join(root,'home')}),abort=new AbortController();abort.abort(Error('OWNER_INSPECTION_CANCEL'));try{await assert.rejects(c.inspectSourceSnapshotProposal({workId:'original-work',proposalId:'11111111-1111-4111-8111-111111111111'},{signal:abort.signal}),/OWNER_INSPECTION_CANCEL/);assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);}finally{await c.close();}});
