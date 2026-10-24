import test from 'node:test';import assert from 'node:assert/strict';
import {ChangeCore} from '../../dist/controller/change-core.js';
import {hash} from '../../dist/controller/change-files.js';
import {parseRoleOutput,assertFindingCore} from '../../dist/workflow/protocol.js';
import {roleOutputSchema} from '../../dist/workflow/role-output-shape.js';
const claim={requirementId:'owner-request',severity:'blocking',repair:'substantive',description:'Actual baseline behavior violates owner intent',evidence:['Bound baseline source'],mechanicalPatch:null};
const cases=['healthy','adverse'].map((kind,i)=>({id:kind,kind,guaranteeIds:['R1'],derivation:'Required actual boundary',consumerPaths:['consumer.cjs'],input:{literalUtf8:String(i),fixturePaths:[]},expected:{kind:'return',value:String(i)}}));
const plan={intent:'Fix owner behavior',requirements:[{id:'R1',text:'Same raw owner intent',source:'owner'}],approach:'Fix consumer',simplerAlternative:'Existing behavior',factualSources:['base:consumer.cjs'],ambiguities:[],verification:{checks:[{id:'Ck',guaranteeIds:['R1'],command:'node check.cjs',assertions:['A'],timeoutMs:1000,fixturePaths:[],cases}],requiredPaths:['consumer.cjs'],reviewRoles:[{key:'review',kind:'reviewer',purpose:'Actual consumer',requiredPaths:['consumer.cjs']}]}};
const proposal=id=>({occurrenceId:id,baselineVersion:'B',requirementIds:['R1'],reason:'Historical owner-request maps to current R1 with the same owner source; implementation repairs the actual BASE defect'});
const common={version:1,summary:'Independent source assessment',findings:[],assessedScope:[]};
function fixture(){
 const state={base:'B',candidate:'C',plan:'P',verification:'V',data:{contractsVersion:'K',requirementVersion:'R',selection:{review:'review'}}};
 const origin={id:'origin',work:'W',role:'planner',status:'UNUSABLE',data:JSON.stringify({stage:'planning',inputVersions:{candidate:null,base:'B',contracts:'oldK'}})};
 const judge={id:'judge',work:'W',role:'adjudicator',status:'COMPLETE',data:JSON.stringify({stage:'planning-adjudication',inputVersions:{base:'B',contracts:'K'},planProposal:plan})};
 const review={id:'review',work:'W',role:'reviewer',status:'COMPLETE',data:JSON.stringify({inputVersions:{candidate:'C'}})};
 const occurrence={id:'F',work:'W',output:'O',ordinal:0,data:JSON.stringify({finding:claim,launchId:'origin',role:'planner'})};
 const output={id:'O',launch:'origin',status:'unusable',raw:JSON.stringify({...common,findings:[claim]}),data:'{}'};
 const protocol={...common,planAccepted:true,acceptedPlan:plan,decisions:[{occurrenceId:'F',disposition:'upheld',reason:'Actual BASE defect',witnesses:['base:consumer.cjs']}],implementationCarries:[proposal('F')]};
 const judgeOutput={id:'JO',launch:'judge',status:'usable',data:JSON.stringify({protocol})};
 const rows=new Map([['origin',origin],['judge',judge],['review',review]]),occurrences=new Map([['F',occurrence]]),outputs=new Map([['O',output]]);
 const versions=new Map([['B',{id:'B',kind:'base',work:'W',hash:'base-hash',data:{}}],['C',{id:'C',kind:'candidate',work:'W',hash:'changed-hash',data:{}}],['P',{id:'P',kind:'plan',work:'W',hash:hash(plan),data:{plan,decisionLaunch:'judge',implementationCarries:[]}}],['R',{id:'R',kind:'requirements',work:'W',data:{requirements:plan.requirements,decisionLaunch:'judge'}}]]);
 let inputs=[],checks=true;const pending=[{id:'F',kind:'finding',state:'pending'}];
 const store={one(sql,...args){if(sql.includes('finding_occurrences')){const row=occurrences.get(args[0]);return row&&(!sql.includes('AND work=')||row.work===args[1])?row:undefined;}if(sql.includes('role_outputs'))return outputs.get(args[0]);if(sql.includes('role_launches')){const row=rows.get(args[0]);return row&&(!sql.includes('AND work=')||row.work===args[1])?row:undefined;}throw Error('Unexpected pure read: '+sql);},all(sql){if(sql.includes('role_outputs'))return[judgeOutput];if(sql.includes('check_runs'))return[{id:'pass'}];throw Error('Unexpected pure read: '+sql);}};
 const core=new ChangeCore({store,sourceImpacts:()=>inputs});core.row=()=>state;core.version=id=>{if(!versions.has(id))throw Error('Required immutable version absent');return versions.get(id);};core.pending=()=>pending;core.checksCurrent=()=>checks;
 return{core,state,origin,judge,review,occurrence,output,protocol,judgeOutput,rows,occurrences,outputs,versions,pending,setInputs:v=>inputs=v,setChecks:v=>checks=v,bind(){judgeOutput.data=JSON.stringify({protocol});const carries=core.acceptedImplementationCarries('W',plan,'judge',protocol);versions.get('P').data.implementationCarries=carries;return carries;}};
}
test('core-only assessment preserves unusable optional-null raw output and strict original parser',()=>{
 assert.doesNotThrow(()=>assertFindingCore(claim));assert.equal(parseRoleOutput(JSON.stringify({...common,findings:[claim]}),'reviewer').value,null);
 for(const patch of [{requirementId:null},{severity:'maybe'},{repair:null},{description:' '},{evidence:null},{evidence:['']}])assert.throws(()=>assertFindingCore({...claim,...patch}));
 assert.doesNotThrow(()=>assertFindingCore({...claim,reproduction:{unsupported:true},unrecognizedRawExtra:true}));
});
test('one J-only strict carry field supports current requirement mapping and preserves role ownership',()=>{
 const f=fixture(),raw=JSON.stringify(f.protocol);assert.ok(parseRoleOutput(raw,'adjudicator').value);assert.ok(roleOutputSchema('adjudicator').properties.implementationCarries);assert.equal(roleOutputSchema('planner').properties.implementationCarries,undefined);
 for(const value of [null,[{...proposal('F'),requirementIds:[]}],[{...proposal('F'),baselineVersion:null}],[proposal('F'),proposal('F')],[{...proposal('F'),repaired:true}]])assert.equal(parseRoleOutput(JSON.stringify({...f.protocol,implementationCarries:value}),'adjudicator').value,null);
 assert.equal(parseRoleOutput(JSON.stringify({...common,implementationCarries:[proposal('F')]}),'reviewer').value,null);
});
test('same-W initial P/C/old-J origin and exact current plan/base/requirements are required',()=>{
 for(const [role,stage]of[['planner','planning'],['challenger','planning-challenge'],['adjudicator','planning-adjudication']]){const f=fixture();f.origin.role=role;f.origin.data=JSON.stringify({stage,inputVersions:{candidate:null,base:'B'}});const rows=f.bind();assert.equal(rows[0].historicalRequirementId,'owner-request');assert.deepEqual(rows[0].requirementIds,['R1']);assert.equal(f.output.status,'unusable');assert.equal(f.core.carriedBaseline('W',f.occurrence),'B');}
 const mutations=[f=>f.origin.work='OTHER',f=>f.occurrence.work='OTHER',f=>f.origin.data=JSON.stringify({stage:'planning',inputVersions:{candidate:'oldC',base:'B'}}),f=>f.origin.data=JSON.stringify({stage:'planning',inputVersions:{candidate:null}}),f=>f.origin.role='implementer',f=>f.protocol.implementationCarries[0].baselineVersion='C',f=>f.versions.get('B').work='OTHER',f=>f.versions.get('B').kind='candidate',f=>f.judge.status='UNUSABLE',f=>f.judge.data=JSON.stringify({stage:'review-adjudication',inputVersions:{base:'B',contracts:'K'}}),f=>f.protocol.implementationCarries[0].requirementIds=['unknown'],f=>f.protocol.planAccepted=false,f=>f.protocol.ownerDecisionRequired=['Missing owner scope'],f=>f.pending.length=0,f=>f.protocol.decisions[0].disposition='deferred'];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>f.bind());}
 const self=fixture();self.occurrence.data=JSON.stringify({finding:claim,launchId:'judge',role:'adjudicator'});self.output.launch='judge';assert.throws(()=>self.bind());
});
test('every pending duplicate needs its own valid explicit current-J chain and mapping',()=>{
 const setup=()=>{const f=fixture(),duplicate={...f.occurrence,id:'D',ordinal:1};f.occurrences.set('D',duplicate);f.pending.push({id:'D',kind:'finding',state:'pending'});f.protocol.implementationCarries.push(proposal('D'));f.protocol.decisions.push({occurrenceId:'D',disposition:'equivalent',equivalentTo:'F',reason:'Same observed consumer defect',witnesses:['base:consumer.cjs']});return f;};
 const f=setup();assert.equal(f.bind().length,2);assert.doesNotThrow(()=>f.core.acceptedAmendments('W',plan,'judge',new Set(['F','D'])));
 for(const mutation of[g=>g.protocol.implementationCarries.pop(),g=>g.protocol.decisions[1].equivalentTo='foreign',g=>{g.protocol.decisions[0]={...g.protocol.decisions[0],disposition:'equivalent',equivalentTo:'D'};},g=>g.protocol.decisions[0].resolution='repaired',g=>g.protocol.decisions[1].disposition='unresolved',g=>g.protocol.implementationCarries[1].requirementIds=[]]){const g=setup();mutation(g);assert.throws(()=>{g.bind();g.core.acceptedAmendments('W',plan,'judge',new Set(g.protocol.implementationCarries.map(c=>c.occurrenceId)));});}
});
test('carry never exempts unknown planning holds or failed checks and is not implicit for ordinary upheld findings',()=>{
 const f=fixture();assert.throws(()=>f.core.acceptedAmendments('W',plan,'judge'),/unaccounted/);
 for(const kind of ['diagnostic','raw-findings-incomplete','interrupted-producer','check']){const g=fixture();g.pending.push({id:'other',kind,state:'pending'});g.bind();assert.throws(()=>g.core.acceptedAmendments('W',plan,'judge',new Set(['F'])),/unaccounted/);}
});
test('BASE closure needs retained current carry, changed candidate, checks and fresh review; explanation provenance is retained',()=>{
 const f=fixture();const record=f.bind()[0],before=JSON.stringify(f.output);assert.equal(f.core.repairedProof('W',f.occurrence,['pass']),true);f.setInputs([{input_id:'later',revision:1,source:'explained-source',data:{effectHold:false}}]);assert.equal(f.core.repairedProof('W',f.occurrence,['pass']),true);assert.equal(record.sourceInputFingerprint,hash([]));assert.equal(JSON.stringify(f.output),before);
 for(const mutate of[g=>g.versions.get('P').data.implementationCarries=[],g=>g.versions.get('P').data.implementationCarries[0].baselineHash='wrong',g=>g.state.data.contractsVersion='newK',g=>g.versions.get('R').data.requirements=[{id:'changed'}],g=>g.versions.get('R').data.decisionLaunch='another-planning-J',g=>g.versions.get('C').hash='base-hash',g=>g.state.candidate=null,g=>g.setChecks(false),g=>g.state.data.selection={},g=>g.review.status='UNUSABLE',g=>g.review.data=JSON.stringify({inputVersions:{candidate:'oldC'}})]){const g=fixture();g.bind();mutate(g);assert.throws(()=>g.core.repairedProof('W',g.occurrence,['pass']));}
 const g=fixture();g.bind();assert.throws(()=>g.core.repairedProof('W',g.occurrence,['invented-check']));
});

test('repair closure needs bare current-check identity while allowing supplementary case observations',()=>{
 for(const refs of [['pass'],['pass','pass:case']]){const f=fixture();f.bind();assert.equal(f.core.repairedProof('W',f.occurrence,refs),true);}
 for(const refs of [['pass:case'],['logical-check'],['case'],['check:pass'],['invented-check']]){const f=fixture();f.bind();assert.throws(()=>f.core.repairedProof('W',f.occurrence,refs),/actual current-check witness/);}
});
