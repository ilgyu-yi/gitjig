import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const exec=promisify(execFile);
import {freeze} from '../../dist/controller/change-files.js';
import {resolveCapturedGitBasis} from '../../dist/controller/source-save-basis.js';
const A='a'.repeat(40),B='b'.repeat(40);
async function fixture(t,files){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-basis-codec-'))),live=path.join(root,'live'),artifact=path.join(root,'captured');await fs.mkdir(live,{mode:0o700});for(const [name,value]of Object.entries(files)){const file=path.join(live,name);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,value,{mode:0o600});}const capture=await freeze(live,artifact,{});t.after(()=>fs.rm(root,{recursive:true,force:true}));return{root,live,base:{kind:'base',versionId:'selected-base',root:artifact,...capture}};}

test('captured detached SHA1/SHA256 identity comes from recorded BASE bytes',async t=>{
 for(const [format,commit]of[['sha1',A],['sha256','c'.repeat(64)]]){const f=await fixture(t,{'.git/HEAD':commit+'\n'}),result=await resolveCapturedGitBasis(f.base,format);assert.equal(result.commit,commit);assert.equal(result.reference,null);assert.equal(result.baseVersionId,'selected-base');assert.deepEqual(result.metadata.map(x=>x.path),['.git/HEAD']);await assert.rejects(resolveCapturedGitBasis(f.base,format==='sha1'?'sha256':'sha1'),/format/);}
});

test('Unicode loose branch metadata wins over stale packed ref without consulting later live HEAD',async t=>{
 const reference='refs/heads/기능/검토',f=await fixture(t,{'.git/HEAD':`ref: ${reference}\n`,['.git/'+reference]:A+'\n','.git/packed-refs':`${B} ${reference}\n`});await fs.writeFile(path.join(f.live,'.git',reference),B+'\n');const result=await resolveCapturedGitBasis(f.base,'sha1');assert.equal(result.commit,A);assert.equal(result.reference,reference);assert.deepEqual(result.metadata.map(x=>x.path),['.git/HEAD','.git/'+reference]);
});

test('recorded packed branch accepts comments and peeled tags, rejecting duplicate authoritative records',async t=>{
 const f=await fixture(t,{'.git/HEAD':'ref: refs/heads/main\n','.git/packed-refs':`# pack-refs with: peeled fully-peeled sorted\n${B} refs/tags/v1\n^${A}\n${A} refs/heads/main\n`});assert.equal((await resolveCapturedGitBasis(f.base,'sha1')).commit,A);
 const bad=await fixture(t,{'.git/HEAD':'ref: refs/heads/main\n','.git/packed-refs':`${A} refs/heads/main\n${B} refs/heads/main\n`});await assert.rejects(resolveCapturedGitBasis(bad.base,'sha1'),/ambiguous/);
});

test('unsafe refs, symbolic chains, unborn references and non-BASE input never select a fallback',async t=>{
 for(const head of ['ref: refs/heads/../../outside\n','ref: /outside\n','ref: refs/heads/main\nref: refs/heads/other\n','0'.repeat(40)+'\n']){const f=await fixture(t,{'.git/HEAD':head});await assert.rejects(resolveCapturedGitBasis(f.base,'sha1'));}
 const f=await fixture(t,{'.git/HEAD':'ref: refs/heads/main\n','.git/refs/heads/main':'ref: refs/heads/other\n','.git/refs/heads/other':A+'\n'});await assert.rejects(resolveCapturedGitBasis(f.base,'sha1'),/format/);await assert.rejects(resolveCapturedGitBasis({...f.base,kind:'candidate'},'sha1'),/selected base/);
 const absent=await fixture(t,{'.git/HEAD':'ref: refs/heads/unborn\n'});await assert.rejects(resolveCapturedGitBasis(absent.base,'sha1'),/missing/);
});

test('linked/commondir/shallow/alternate layouts remain explicitly unsupported',async t=>{
 for(const extra of [{'.git':'gitdir: /unrelated\n'},{'.git/HEAD':A+'\n','.git/commondir':'/outside\n'},{'.git/HEAD':A+'\n','.git/shallow':B+'\n'},{'.git/HEAD':A+'\n','.git/objects/info/alternates':'/outside\n'}]){const f=await fixture(t,extra);await assert.rejects(resolveCapturedGitBasis(f.base,'sha1'),/layout/);}
});

test('captured metadata byte hash, size, namespace and original manifest remain bound',async t=>{
 const f=await fixture(t,{'.git/HEAD':A+'\n'}),head=path.join(f.base.root,'.git/HEAD');await fs.writeFile(head,B+'\n');await assert.rejects(resolveCapturedGitBasis(f.base,'sha1'),/hash/);await fs.writeFile(head,A+'\nextra');await assert.rejects(resolveCapturedGitBasis(f.base,'sha1'),/regular file|changed/);await fs.writeFile(head,A+'\n');const corrupted=structuredClone(f.base);corrupted.manifest.digest='0'.repeat(64);await assert.rejects(resolveCapturedGitBasis(corrupted,'sha1'),/manifest/);await assert.rejects(resolveCapturedGitBasis({...f.base,digest:'0'.repeat(64)},'sha1'),/effective digest/);
 const original=path.join(f.base.root,'.git-original');await fs.rename(path.join(f.base.root,'.git'),original);await fs.symlink(original,path.join(f.base.root,'.git'));await assert.rejects(resolveCapturedGitBasis(f.base,'sha1'),/ancestor/);
});

test('HEAD/ref/packed original metadata byte limits are explicit and bounded',async t=>{
 const head=await fixture(t,{'.git/HEAD':'x'.repeat(4097)});await assert.rejects(resolveCapturedGitBasis(head.base,'sha1'),/byte limit/);
 const loose=await fixture(t,{'.git/HEAD':'ref: refs/heads/main\n','.git/refs/heads/main':'x'.repeat(4097)});await assert.rejects(resolveCapturedGitBasis(loose.base,'sha1'),/byte limit/);
 const packed=await fixture(t,{'.git/HEAD':'ref: refs/heads/main\n','.git/packed-refs':'#'.repeat(1048577)});await assert.rejects(resolveCapturedGitBasis(packed.base,'sha1'),/byte limit/);
});

test('codec reads only manifest-selected metadata and never loads captured Git config/index/helper',async t=>{
 const f=await fixture(t,{'.git/HEAD':A+'\n','.git/config':'[alias]\n  inspect = !touch SHOULD_NEVER_EXECUTE\n','.git/index':'private index bytes','.git/hooks/pre-push':'#!/bin/sh\ntouch SHOULD_NEVER_EXECUTE\n'}),original=fs.open,reads=[];t.mock.method(fs,'open',async(...args)=>{reads.push(String(args[0]));return original(...args);});assert.equal((await resolveCapturedGitBasis(f.base,'sha1')).commit,A);assert.deepEqual(reads,[path.join(f.base.root,'.git/HEAD')]);assert.equal(await fs.stat(path.join(f.root,'SHOULD_NEVER_EXECUTE')).then(()=>true,()=>false),false);
});


test('post-capture HEAD FIFO refuses without a peer or a blocking open',{timeout:5000},async t=>{
 const f=await fixture(t,{'.git/HEAD':A+'\n'}),head=path.join(f.base.root,'.git/HEAD'),original=head+'.original';await fs.rename(head,original);await exec('/usr/bin/mkfifo',[head],{timeout:1000});await fs.chmod(head,0o600);
 try{const module=pathToFileURL(path.resolve('dist/controller/source-save-basis.js')).href,script=`import {resolveCapturedGitBasis} from ${JSON.stringify(module)};try{await resolveCapturedGitBasis(JSON.parse(process.argv[1]),'sha1');console.log(JSON.stringify({refused:false}));}catch(error){console.log(JSON.stringify({refused:true,message:error.message}));}`;const result=await exec(process.execPath,['--input-type=module','-e',script,JSON.stringify(f.base)],{timeout:2500,maxBuffer:65536});const value=JSON.parse(result.stdout);assert.equal(value.refused,true);assert.match(value.message,/regular file/);}finally{await fs.unlink(head);await fs.rename(original,head);}
});

for(const [format,commit]of [['sha1',A],['sha256','c'.repeat(64)]])test('automatic '+format+' comes only from selected detached/loose/packed captured OID',async t=>{
 const other=(format==='sha1'?'d'.repeat(40):'d'.repeat(64)),ref='refs/heads/기능/원본';
 for(const files of [
  {'.git/HEAD':commit+'\n'},
  {'.git/HEAD':`ref: ${ref}\n`,['.git/'+ref]:commit+'\n','.git/packed-refs':'malformed unrelated packed bytes'},
  {'.git/HEAD':`ref: ${ref}\n`,'.git/packed-refs':`# pack-refs with: peeled\n${other} refs/tags/unrelated\n^${other}\n${commit} ${ref}\n`}
 ]){
  const f=await fixture(t,files),automatic=await resolveCapturedGitBasis(f.base),explicit=await resolveCapturedGitBasis(f.base,format);
  assert.deepEqual(automatic,explicit);assert.equal(automatic.objectFormat,format);assert.equal(automatic.commit,commit);
  await fs.writeFile(path.join(f.live,'.git/HEAD'),other+'\n');assert.deepEqual(await resolveCapturedGitBasis(f.base),automatic);
 }
});
test('automatic selected packed format still refuses inconsistent unrelated refs or peeled OIDs',async t=>{
 for(const selected of [A,'c'.repeat(64)])for(const otherKind of ['ref','peeled']){
  const other=selected.length===40?'d'.repeat(64):B;
  const rows=otherKind==='ref'?`${other} refs/tags/unrelated\n`:`${selected} refs/tags/unrelated\n^${other}\n`;
  const f=await fixture(t,{'.git/HEAD':'ref: refs/heads/main\n','.git/packed-refs':rows+`${selected} refs/heads/main\n`});
  await assert.rejects(resolveCapturedGitBasis(f.base),/format/);
 }
});
test('automatic selection has no unrelated fallback and only undefined requests inference',async t=>{
 for(const selected of ['0'.repeat(40),'0'.repeat(64),'A'.repeat(40),'a'.repeat(41),'ref: refs/heads/other']){
  const f=await fixture(t,{'.git/HEAD':'ref: refs/heads/main\n','.git/refs/heads/main':selected+'\n','.git/packed-refs':`${A} refs/heads/main\n`});
  await assert.rejects(resolveCapturedGitBasis(f.base),/format/);
 }
 for(const packed of [`${A} refs/tags/main\n^${B}\n`,`${A} refs/heads/main\n${A} refs/heads/main\n`,`${A}  refs/heads/main\n`]){
  const f=await fixture(t,{'.git/HEAD':'ref: refs/heads/main\n','.git/packed-refs':packed});await assert.rejects(resolveCapturedGitBasis(f.base),/missing|ambiguous|malformed/);
 }
 const f=await fixture(t,{'.git/HEAD':A+'\n'});for(const format of [null,'','sha512'])await assert.rejects(resolveCapturedGitBasis(f.base,format),/selected base/);
 const abort=new AbortController();abort.abort(Error('Owned codec cancelled'));await assert.rejects(resolveCapturedGitBasis(f.base,undefined,abort.signal),/Owned codec cancelled/);
});
test('automatic inference keeps exact metadata-only reads and original hash refusal',async t=>{
 const f=await fixture(t,{'.git/HEAD':A+'\n','.git/config':'DO NOT LOAD','.git/index':'DO NOT READ'}),original=fs.open,reads=[];
 t.mock.method(fs,'open',async(...args)=>{reads.push(String(args[0]));return original(...args);});
 assert.equal((await resolveCapturedGitBasis(f.base)).objectFormat,'sha1');assert.deepEqual(reads,[path.join(f.base.root,'.git/HEAD')]);
 await fs.writeFile(path.join(f.base.root,'.git/HEAD'),B+'\n');await assert.rejects(resolveCapturedGitBasis(f.base),/hash/);
});
