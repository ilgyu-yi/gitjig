import test from 'node:test';import assert from 'node:assert/strict';
import {roleMaterialFindings as read,nativeTextFindingProjection as project,settledFormatterPrefixWithoutFindings as emptySettledPrefix} from '../../dist/controller/role-material-findings.js';
import {createHash} from 'node:crypto';
import {parseRoleOutput} from '../../dist/workflow/protocol.js';
import {mixedPlan} from '../workflow/mixed-verification-fixture.mjs';
const claim=description=>({requirementId:'R1',severity:'blocking',repair:'unknown',description,evidence:['original source']});
const role=description=>({version:1,summary:'Original untrusted producer',findings:[claim(description)],assessedScope:[]});
test('received submission can prove an explicit empty roster with a missing version', () => {
 const body = {summary:'Retained submission',findings:[],assessedScope:[],decisions:[],acceptedPlan:{}};
 const raw = JSON.stringify(body);
 const received = value => read(value,'adjudicator',true,'received-submission/v1');
 assert.deepEqual(received(raw), {claims:[],complete:false,receivedClaimsComplete:true,roleAttempt:true});
 assert.equal(read(raw,'adjudicator',true,2).receivedClaimsComplete,false);
 assert.equal(parseRoleOutput(raw,'adjudicator').value,null);
 for (const unsupported of [
  {...body,findings:[claim('Preserve this claim')]}, {...body,findings:undefined}, {...body,findings:'unknown'},
  {...body,acceptedPlan:{findings:[]}}, {...body,summary:{}}, {...body,decisions:undefined},
  {...body,unknown:{}}, {...body,version:'malformed',findings:'unknown'}, {different:body,metadata:{}},
 ]) assert.equal(received(JSON.stringify(unsupported)).receivedClaimsComplete,false);
 for (const unsupported of [raw.slice(0,-1), raw+'{}', raw.slice(0,-1)+',"findings":[]}',raw.replace('{}','{"a":1,"a":2}')])
  assert.equal(received(unsupported).receivedClaimsComplete,false);
 assert.deepEqual(received(JSON.stringify({...body,findings:[claim('Retained')]})).claims.map(c=>c.finding.description),['Retained']);
});
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

test('terminal fence has exact byte locations but never whole-reply completeness or acceptance',()=>{
 for(const newline of ['\n','\r\n']){
  const inner=JSON.stringify(role('Exact literal 한글 🐙')),raw='Unassessed narration 한글 🐙'+newline+'```json'+newline+inner+newline+'```'+newline;
  const result=project(raw,'reviewer');assert.ok(result.region);assert.equal(result.read.complete,false);assert.equal(result.read.receivedClaimsComplete,false);
  assert.equal(result.read.claims[0].finding.description,'Exact literal 한글 🐙');assert.equal(result.region.innerLiteralComplete,true);
  assert.ok(result.region.bodyStartByte>raw.indexOf(inner),'UTF8 byte offsets must differ from UTF16 positions');
  const bytes=Buffer.from(raw),body=bytes.subarray(result.region.bodyStartByte,result.region.bodyEndByte);
  assert.equal(body.toString(),inner+newline);assert.equal(result.region.bodyUtf8Sha256,createHash('sha256').update(body).digest('hex'));
  assert.equal(result.region.sourceUtf8Sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.region.sourceUtf8Bytes,bytes.length);
  assert.equal(bytes.subarray(result.region.openingStartByte,result.region.bodyStartByte).toString(),'```json'+newline);
  assert.equal(bytes.subarray(result.region.bodyEndByte,result.region.closingEndByte).toString(),'```'+newline);
  assert.equal(parseRoleOutput(raw,'reviewer').value,null);assert.deepEqual(read(raw).claims,[],'Legacy literal reader is not reinterpreted');
 }
});
test('unsupported text envelopes remain explicit incomplete observations',()=>{
 const one='```json\n'+JSON.stringify(role('known'))+'\n```';
 assert.equal(project('Ordinary narration without a role fence','reviewer'),undefined);
 for(const raw of [one+'\nMore narration',one+'\n'+one,one.slice(0,-3),'```json\n{}\n```','x'.repeat(140000)+'\n'+one,'\ud800\n'+one]){
  const result=project(raw,'reviewer');assert.ok(result);assert.equal(result.region,undefined);assert.equal(result.read.complete,false);assert.equal(result.read.receivedClaimsComplete,false);
 }
});
test('partial and duplicate inner literals never acquire a closed observation proof',()=>{
 for(const inner of ['{"version":1,"summary":"partial","findings":['+JSON.stringify(claim('closed')),
  '{"version":1,"summary":"duplicate","findings":[{"description":"a","description":"b"}],"assessedScope":[]}']){
  const result=project('Before\n```json\n'+inner+'\n```','reviewer');assert.ok(result.region);assert.equal(result.region.innerLiteralComplete,false);assert.equal(result.read.claims.length,1);assert.equal(result.read.receivedClaimsComplete,false);
 }
});

test('complete direct formatter omission proves only zero literal claims, never valid protocol or a generic empty reply',()=>{
 const raw=JSON.stringify({version:1,summary:'A rejected complete challenge',assessedScope:[],alternatives:['Use the existing parser']});
 const actual=read(raw,'challenger',true);
 assert.deepEqual(actual,{claims:[],complete:false,receivedClaimsComplete:true,roleAttempt:true});
 assert.equal(read(raw,'challenger').receivedClaimsComplete,false);
 assert.equal(parseRoleOutput(raw,'challenger').value,null);
});
test('formatter empty-domain proof cannot conceal malformed, wrapped, unknown or nested literal material',()=>{
 const base={version:1,summary:'Rejected complete challenge',assessedScope:[],alternatives:[]};
 const invalid=[
  JSON.stringify({...base,findings:null}),JSON.stringify({...base,findings:{}}),JSON.stringify({payload:base}),
  JSON.stringify({...base,unknown:1}),JSON.stringify({...base,version:2}),JSON.stringify({...base,summary:null}),
  JSON.stringify({...base,alternatives:null}),JSON.stringify({...base,alternatives:[{findings:[claim('nested')]}]}),
  JSON.stringify({...base,plan:{version:1,summary:'nested',findings:[claim('wrapped')],assessedScope:[]}}),
  JSON.stringify(base).slice(0,-1),JSON.stringify(base)+' trailing',
  '{"version":1,"summary":"first","summary":"second","assessedScope":[],"alternatives":[]}',
  '{"version":1,"summary":"complete","assessedScope":[],"alternatives":[{"x":1,"x":2}]}',
  JSON.stringify({...base,summary:'x'.repeat(140000)}),JSON.stringify(base).replace('Rejected complete challenge','\ud800')
 ];
 for(const raw of invalid)assert.equal(read(raw,'challenger',true).receivedClaimsComplete,false,raw.slice(0,100));
 const literal=JSON.stringify({...base,findings:[claim('must survive')]});
 assert.deepEqual(read(literal,'challenger',true).claims.map(c=>c.finding.description),['must survive']);
 assert.equal(read(JSON.stringify(base),'planner',true).receivedClaimsComplete,false,'Assigned-role domains are exact');
});

test('settled formatter prefix grammar accounts received domains without unreceived role headers',()=>{
 const value={assessedScope:[],checkResolutions:[],criteriaDecision:{kind:'adopt',reason:'Current definitions apply'}};
 const raw=JSON.stringify(value).slice(0,-1);
 assert.equal(emptySettledPrefix(raw,'adjudicator'),true);
 assert.equal(read(raw,'adjudicator',true).receivedClaimsComplete,false,'Historical formatter interpretation remains unchanged');
 assert.equal(parseRoleOutput(raw,'adjudicator').value,null);
 assert.equal(emptySettledPrefix(JSON.stringify(value),'adjudicator'),false,'This is only the interrupted-prefix recipe');
 assert.equal(emptySettledPrefix(raw,'planner'),false,'Only the assigned role domains apply');
 assert.equal(emptySettledPrefix('{"summary":"Quoted findings:[] are opaque 한글🙂"','reviewer'),true);
});
test('settled prefix grammar rejects ambiguity, actual findings and unfinished received tokens',()=>{
 const raw='{"assessedScope":[]';
 for(const tail of [',',',"summary"',',"summary":',',"summary":"open',',"decisions":[',',"criteriaDecision":{"kind":"adopt"',',"summary":true',',"criteriaDecision":null',',"version":2',',"unknown":[]',',"assessedScope":[]',',"findings":[]',',"findings":null',',"decisions":[{"findings":[]}]',',"decisions":[{"x":1,"x":2}]',' trailing'])assert.equal(emptySettledPrefix(raw+tail,'adjudicator'),false,tail);
 for(const text of ['{','{}','{"wrapper":'+raw,raw+'}',raw+',"summary":"\ud800"',raw+',"summary":"'+'x'.repeat(140000)+'"',raw+',"decisions":'+JSON.stringify(Array.from({length:8192},()=>0)),raw+',"decisions":'+'['.repeat(65)+'0'+']'.repeat(65)])assert.equal(emptySettledPrefix(text,'adjudicator'),false,text.slice(0,80));
});

test('authenticated complete formatter subsets account zero literal findings without requiring unreceived headers',()=>{
 const opaque='Rejected formatter syntax: <invoke name="StructuredOutput"><parameter>{"findings":[]}</parameter></invoke>';
 for(const value of [{version:1,summary:opaque},{summary:opaque},{assessedScope:[]},{version:1}]){
  const raw=JSON.stringify(value),legacy=read(raw,'planner',true);
  assert.equal(legacy.receivedClaimsComplete,false,'Legacy header recipe remains unchanged');
  assert.deepEqual(read(raw,'planner',true,2),{claims:[],complete:false,receivedClaimsComplete:true,roleAttempt:true});
  assert.equal(read(raw,'planner').receivedClaimsComplete,false,'Generic material has no formatter provenance');
  assert.equal(parseRoleOutput(raw,'planner').value,null,'No repaired or accepted role output');
 }
 assert.deepEqual(read('{}','planner',true,2),read('{}','planner',true),'Preserve existing empty-object interpretation');
});

test('complete formatter subset accounting retains original source and assigned-domain refusals',()=>{
 const invalid=[
  '{"version":2}', '{"summary":null}', '{"plan":null}', '{"unknown":"text"}', '{"alternatives":[]}',
  '{"wrapper":{"version":1,"summary":"text"}}', '{"version":1,"version":1}',
  '{"summary":"first","summary":"second"}', '{"summary":"open', '{"summary":"closed"',
  '{"summary":"closed"} trailing', '{"findings":null}', '{"findings":{}}',
  JSON.stringify({plan:{findings:[claim('nested must survive')]}}),
  JSON.stringify({summary:'x'.repeat(140000)}), '{"summary":"\ud800"}'
 ];
 for(const raw of invalid)assert.equal(read(raw,'planner',true,2).receivedClaimsComplete,false,raw.slice(0,100));
 const withClaim=JSON.stringify({version:1,summary:'Partial role with a real claim',findings:[claim('retain this finding')]});
 assert.deepEqual(read(withClaim,'planner',true,2).claims.map(c=>c.finding.description),['retain this finding']);
 assert.equal(read('{"alternatives":[]}','challenger',true,2).receivedClaimsComplete,true,'Use the authenticated assigned role');
 assert.equal(read('{"alternatives":[]}','planner',true,2).receivedClaimsComplete,false);
});

test('authenticated rejected formatter scalar material accounts no literal findings without accepting protocol',()=>{
 for(const value of [{input:'placeholder'},{payload:42},{flag:false},{unknown:null},{summary:'Known field',unexpected:'opaque'},
  {payload:JSON.stringify(role('quoted data'))},{payload:'<findings>quoted data</findings>'}]){
  const raw=JSON.stringify(value);
  assert.equal(read(raw,'adjudicator',true,2).receivedClaimsComplete,false,'Known-field recipe stays unchanged');
  assert.deepEqual(read(raw,'adjudicator',true,3),{claims:[],complete:false,receivedClaimsComplete:true,roleAttempt:true});
  assert.equal(read(raw,'adjudicator').receivedClaimsComplete,false,'No generic material exemption');
  assert.equal(parseRoleOutput(raw,'adjudicator').value,null,'Literal accounting cannot create a role result');
 }
});

test('rejected formatter scalar recipe keeps unknown containers, real findings and invalid known domains held',()=>{
 const invalid=[{input:{summary:'nested'}},{input:[]},{input:{findings:[claim('nested')]}},{summary:42},{version:2},
  {findings:null},{findings:42},{findings:'opaque'},{acceptedPlan:'not a plan'},{assessedScope:'not an array'},
  {input:'opaque',version:2},{input:'opaque',summary:null}].map(v=>JSON.stringify(v));
 invalid.push('{"input":1,"input":2}','{"input":1,"\\u0069nput":2}','{"input":"unfinished',
  '{"input":"done"} trailing','{"input":"\ud800"}',JSON.stringify({input:'x'.repeat(140000)}));
 for(const raw of invalid)assert.equal(read(raw,'adjudicator',true,3).receivedClaimsComplete,false,raw.slice(0,100));
 const actual=read(JSON.stringify({findings:[claim('must survive')],input:'ignored scalar'}),'adjudicator',true,3);
 assert.deepEqual(actual.claims.map(c=>c.finding.description),['must survive']);
 assert.deepEqual(read('{}','adjudicator',true,3),read('{}','adjudicator',true,2));
 assert.equal(read('{"summary":"opaque"}','adjudicator',false,3).receivedClaimsComplete,false);
});

test('named rejected-submission grammar keeps a distinct recipe while retaining literal claims',()=>{
 const raw='{"version":1,"findings":['+JSON.stringify(claim('Original submission allegation'))+'],"findings":"Malformed public statement"}';
 const actual=read(raw,'challenger',true,'rejected-submission/v1');assert.equal(actual.complete,false);assert.equal(actual.receivedClaimsComplete,false);assert.equal(actual.claims.length,1);assert.equal(actual.claims[0].finding.description,'Original submission allegation');assert.equal(actual.claims[0].memberPath[0].ordinal,0);
 const scalar='{"unknown":"opaque text"}';assert.equal(read(scalar,'challenger',true,2).receivedClaimsComplete,false);assert.equal(read(scalar,'challenger',true,3).receivedClaimsComplete,true);assert.equal(read(scalar,'challenger',true,'rejected-submission/v1').receivedClaimsComplete,true);
 const wrapped=read('{"unknown":{"findings":"Unassessed nested statement"}}','challenger',true,'rejected-submission/v1');assert.equal(wrapped.receivedClaimsComplete,false,'Unknown containers never acquire an empty-claim waiver');
});
