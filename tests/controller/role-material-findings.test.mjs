import test from 'node:test';import assert from 'node:assert/strict';
import {roleMaterialFindings as read} from '../../dist/controller/role-material-findings.js';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {mixedPlan} from '../workflow/mixed-verification-fixture.mjs';
const claim=description=>({requirementId:'R1',severity:'blocking',repair:'unknown',description,evidence:['original source']});
const role=description=>({version:1,summary:'Original untrusted producer',findings:[claim(description)],assessedScope:[]});
test('transparent envelope names grant no acceptance; original paths and literal ordinals survive',()=>{
 const raw='{"a/b~":{"reply":'+JSON.stringify(role('one'))+'},"a/b~":{"reply":'+JSON.stringify(role('two'))+'}}',result=read(raw);
 assert.equal(result.complete,true);assert.deepEqual(result.claims.map(c=>c.finding.description),['one','two']);assert.deepEqual(result.claims.map(c=>c.findingPath),['/a~1b~0/reply/findings','/a~1b~0/reply/findings']);assert.deepEqual(result.claims.map(c=>c.memberPath[0].ordinal),[0,1]);assert.equal(parseRoleOutput(raw,'reviewer').value,null);
 const duplicate='{"version":1,"summary":"two literal members","findings":['+JSON.stringify(claim('A'))+'],"findings":['+JSON.stringify(claim('B'))+'],"assessedScope":[]}';
 const actual=read('{"wrapper":'+duplicate+'}');assert.equal(actual.complete,true);assert.deepEqual(actual.claims.map(c=>c.memberPath.at(-1).ordinal),[0,1]);assert.deepEqual(actual.claims.map(c=>c.finding.description),['A','B']);
});
test('role boundary stops before actual valid case literal and opaque examples',()=>{
 const value={...role('actual'),plan:mixedPlan()};value.plan.verification.checks[0].cases[0].expected.value=JSON.stringify({findings:[claim('EXAMPLE')]});
 assert.ok(parseRoleOutput(JSON.stringify(value),'planner').value);assert.deepEqual(read(JSON.stringify({value})).claims.map(c=>c.finding.description),['actual']);
 const synthetic={...value,plan:{examples:{version:1,summary:'example',findings:[claim('NOT_A_NEW_CLAIM')],assessedScope:[]}}};assert.deepEqual(read(JSON.stringify(synthetic)).claims.map(c=>c.finding.description),['actual']);
 const quoted=read(JSON.stringify({value:JSON.stringify(role('QUOTED'))}));assert.equal(quoted.claims.length,0);assert.equal(quoted.complete,false);
});
test('unsupported siblings retain recognizable claims with an explicit completeness hold',()=>{
 const result=read(JSON.stringify({left:role('left'),right:role('right')}));assert.equal(result.complete,false);assert.deepEqual(result.claims.map(c=>c.finding.description),['left','right']);
 const mixed=read(JSON.stringify({findings:[],value:role('NESTED_ACTUAL_CLAIM')}));assert.equal(mixed.complete,false);assert.deepEqual(mixed.claims.map(c=>c.finding.description),['NESTED_ACTUAL_CLAIM']);
 const unknown=read(JSON.stringify({payload:{findings:[claim('DATA_WITHOUT_ROLE_ROOT')]}}));assert.equal(unknown.complete,false);assert.equal(unknown.claims.length,0);
});
test('partial literals keep the completed claim without asserting completeness',()=>{
 const prefix='{"outer":{"version":1,"summary":"partial","findings":['+JSON.stringify(claim('received'));
 for(const tail of [',{"description":"unterminated\\',']',' ],"assessedScope":[]']){const result=read(prefix+tail);assert.equal(result.complete,false);assert.deepEqual(result.claims.map(c=>c.finding.description),['received']);}
 const duplicate='{"description":"first","description":"second"}',result=read('{"findings":['+duplicate+']}');assert.equal(result.complete,false);assert.equal(result.claims.length,1);
});
test('depth, nodes and bytes remain finite and never imply complete-empty',()=>{
 for(const raw of ['{"v":'.repeat(70)+JSON.stringify(role('deep'))+'}'.repeat(70),JSON.stringify({value:{...role('late'),summary:'x'.repeat(140000)}})])assert.equal(read(raw).complete,false);
});

test('known received outer-root prefix has separate accounting without producer completion',()=>{
 for(const findings of [[],[claim('received')]]){
  const raw=JSON.stringify({version:1,summary:'Interrupted judgment',findings,assessedScope:[],decisions:[],implementationCarries:[]}).slice(0,-1);
  const result=read(raw,'adjudicator');assert.equal(result.complete,false);assert.equal(result.receivedClaimsComplete,true);
  assert.deepEqual(result.claims.map(c=>c.finding),findings);assert.equal(parseRoleOutput(raw,'adjudicator').value,null);
  assert.equal(read(raw).receivedClaimsComplete,false);assert.equal(read(raw,'reviewer').receivedClaimsComplete,false);
 }
});
test('ambiguous or unfinished received values never acquire prefix completeness',()=>{
 const start='{"version":1,"summary":"Interrupted","findings":[],"assessedScope":[]';
 for(const tail of [',',',"decisions"',',"decisions":',',"decisions":[',',"summary":"open',',"summary":"duplicate"',',"unsupported":[]',',"decisions":{"findings":[]}',',"decisions":[{"findings":[]}]','x']){
  const result=read(start+tail,'adjudicator');assert.equal(result.complete,false);assert.equal(result.receivedClaimsComplete,false,tail);
 }
 for(const raw of ['{"outer":'+start, start+',"summary":"\ud800"', '{"version":1,"summary":"x","findings":['+JSON.stringify(claim('retained'))+',{"description":"open'])assert.equal(read(raw,'adjudicator').receivedClaimsComplete,false);
 const partial=read('{"version":1,"summary":"x","findings":['+JSON.stringify(claim('retained'))+',{"description":"open','adjudicator');
 assert.equal(partial.claims[0].finding.description,'retained');
});
test('prefix proof preserves finite byte, structure and duplicate-key bounds',()=>{
 const root=extra=>JSON.stringify({version:1,summary:'x',findings:[],assessedScope:[],decisions:extra}).slice(0,-1);
 for(const raw of [root(Array.from({length:8192},()=>0)),root(['x'.repeat(140000)]),root(JSON.parse('['.repeat(65)+'0'+']'.repeat(65))),root([]).replace('"decisions":[]','"decisions":[{"reason":"one","reason":"two"}]')])assert.equal(read(raw,'adjudicator').receivedClaimsComplete,false);
});
