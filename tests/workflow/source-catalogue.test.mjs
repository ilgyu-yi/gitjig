import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourceCatalogue, sourceCatalogueHeader } from '../../dist/workflow/source-catalogue.js';
const hash = text => createHash('sha256').update(text).digest('hex');
function bundle() {
 return {requirements:[],contracts:'',context:{baseVersion:'B1',candidateVersion:null,sourceInventory:{baseCount:2}},sources:[],requiredScope:[],
  sourceCatalogue:{format:1,version:'B1',side:'base',files:[{path:'consumer.ts',sha256:hash('actual'),size:6},{path:'other.ts',sha256:hash('other'),size:5}]}};
}
test('captured catalogue header is compact metadata tied to its exact contents',()=>{
 const b=bundle(),catalogue=sourceCatalogue(b),header=sourceCatalogueHeader(catalogue);
 assert.equal(header.count,2);assert.equal(header.idPrefix,'base:');assert.equal(header.sha256,hash(JSON.stringify(catalogue)));
 assert.equal(Object.hasOwn(header,'files'),false);assert.match(header.semantics,/not read exposure/);
 const changed=structuredClone(catalogue);changed.files[1].sha256=hash('drift');assert.notEqual(sourceCatalogueHeader(changed).sha256,header.sha256);
});
test('catalogue refuses wrong native version, side, incomplete inventory, invalid metadata and inline conflicts',()=>{
 const changes=[b=>b.sourceCatalogue.version='foreign',b=>b.context.candidateVersion='C1',b=>b.sourceCatalogue.side='candidate',
  b=>b.sourceCatalogue.files.pop(),b=>b.sourceCatalogue.extra='unsupported',b=>b.sourceCatalogue.files.push({...b.sourceCatalogue.files[0]}),
  b=>b.sourceCatalogue.files[0].path='../outside',b=>b.sourceCatalogue.files[0].path='dir/../alias',b=>b.sourceCatalogue.files[0].path='a\\b',
  b=>b.sourceCatalogue.files[0].sha256='bad',b=>b.sourceCatalogue.files[0].size=-1,
  b=>b.sources.push({id:'base:consumer.ts',side:'candidate',version:'B1',path:'other.ts',sha256:hash('other'),content:'other'}),
  b=>b.sources.push({id:'opaque',side:'base',version:'B1',path:'consumer.ts',sha256:hash('actual'),content:'actual'})];
 for(const change of changes){const b=bundle();change(b);assert.throws(()=>sourceCatalogue(b));}
});
test('catalogue accepts matching selected inline identity without rewriting other-side sources',()=>{
 const b=bundle();b.sources.push({id:'base:consumer.ts',side:'base',version:'B1',path:'consumer.ts',sha256:hash('actual'),content:'actual'},
  {id:'candidate:consumer.ts',side:'candidate',version:'C1',path:'consumer.ts',sha256:hash('changed'),content:'changed'});
 assert.equal(sourceCatalogue(b),b.sourceCatalogue);
 const noCatalogue={...b,sourceCatalogue:undefined};noCatalogue.sources[0].id='opaque legacy';assert.equal(sourceCatalogue(noCatalogue),undefined);
});
