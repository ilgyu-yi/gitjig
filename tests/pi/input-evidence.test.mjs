import test,{after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';import {initializePiHost,PiArtifacts} from '../../dist/pi/host.js';import {renderedReadRange} from '../../dist/pi/read-range.js';
const root=await temporaryDirectory('input-evidence'),stateRoot=path.join(root,'state'),artifactRoot=path.join(root,'artifacts');await fs.mkdir(stateRoot,{mode:0o700});await fs.mkdir(artifactRoot,{mode:0o700});const oldTemp=process.env.TMPDIR;process.env.TMPDIR=artifactRoot;const host=await initializePiHost({stateRoot,artifactRoot});after(async()=>{if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;await fs.rm(root,{recursive:true,force:true});});
const binding=text=>({sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)});
test('original evidence content is bound before admission and on every read, including same-size mutations and later output admission',async()=>{
 const file=path.join(artifactRoot,randomUUID()),store=new PiArtifacts(host,1024),text='original exact evidence';await fs.writeFile(file,text,{mode:0o600});const expected=binding(text);await store.admit(file,expected);expected.sha256='0'.repeat(64);assert.equal((await store.read(file)).toString(),text);
 await fs.writeFile(file,'changed! exact evidence');await store.admit(file);await assert.rejects(store.read(file),/content changed/);await assert.rejects(store.admit(file,binding('changed! exact evidence')),/binding changed/);
 const foreign=new PiArtifacts(host,1024);assert.equal(foreign.has(file),false);await assert.rejects(foreign.read(file),/Unregistered/);
});
test('incorrect content, links and oversized evidence never enter the role whitelist',async()=>{
 const store=new PiArtifacts(host,64),file=path.join(artifactRoot,randomUUID());await fs.writeFile(file,'exact',{mode:0o600});await assert.rejects(store.admit(file,binding('other')),/content changed/);assert.equal(store.has(file),false);
 const link=path.join(artifactRoot,randomUUID());await fs.link(file,link);await assert.rejects(store.admit(link,binding('exact')),/identity changed/);assert.equal(store.has(link),false);await assert.rejects(store.admit(file,{sha256:'a'.repeat(64),bytes:65}),/read limit/);
 const symbolic=path.join(artifactRoot,randomUUID());await fs.symlink(file,symbolic);await assert.rejects(store.admit(symbolic,binding('exact')));assert.equal(store.has(symbolic),false);
});
test('delivery range is exact rendered output, never the complete internally read buffer or a truncated/failed slice',()=>{
 const source='header\nfirst chunk\nsecond chunk\nlast chunk',slice={content:[{type:'text',text:'first chunk\n\n[2 more lines in file. Use offset=3 to continue.]'}]};
 assert.deepEqual(renderedReadRange(source,{offset:2,limit:1},slice),{startLine:2,endLine:2,rangeSha256:binding('first chunk').sha256});
 assert.equal(renderedReadRange(source,{offset:2,limit:1},{...slice,details:{truncation:{truncated:true}}}),null);assert.equal(renderedReadRange(source,{offset:2,limit:1},{...slice,isError:true}),null);
 assert.equal(renderedReadRange(source,{offset:2,limit:1},{content:{0:slice.content[0],length:1}}),null);
 assert.equal(renderedReadRange(source,{offset:2,limit:2},slice),null);assert.equal(renderedReadRange(source,{offset:0},slice),null);
});

test('all admitted parent aliases share one canonical evidence constraint with no ordinary-admission downgrade',async()=>{
 const alias=path.join(root,'artifact-alias'),other=path.join(root,'another-alias');await fs.symlink(artifactRoot,alias);await fs.symlink(artifactRoot,other);
 const name=randomUUID(),canonical=path.join(artifactRoot,name),first=path.join(alias,name),second=path.join(other,name),store=new PiArtifacts(host,1024),text='original';await fs.writeFile(canonical,text,{mode:0o600});await store.admit(first);await store.admit(second,binding(text));
 for(const file of [canonical,first,second])assert.equal(store.binding(file).sha256,binding(text).sha256);
 await fs.writeFile(canonical,'tampered');await store.admit(first);await store.admit(canonical);
 for(const file of [canonical,first,second])await assert.rejects(store.read(file),/content changed/);
 await assert.rejects(store.admit(first,binding('tampered')),/binding changed/);
});

test('case-folded spellings on the same filesystem cannot bypass a canonical evidence binding',async t=>{
 const name='Evidence-'+randomUUID()+'.txt',original=path.join(artifactRoot,name),folded=path.join(artifactRoot,name.toLowerCase()),store=new PiArtifacts(host,1024);await fs.writeFile(original,'original',{mode:0o600});
 try{await fs.access(folded);}catch(error){if(error.code!=='ENOENT')throw error;t.diagnostic('Filesystem is case-sensitive; distinct names are not aliases');return;}
 assert.equal(await fs.realpath(original),await fs.realpath(folded));await store.admit(original,binding('original'));await fs.writeFile(original,'tampered');await store.admit(folded);
 assert.equal(store.binding(folded).sha256,binding('original').sha256);await assert.rejects(store.read(folded),/content changed/);await assert.rejects(store.read(original),/content changed/);await assert.rejects(store.admit(folded,binding('tampered')),/binding changed/);
});
