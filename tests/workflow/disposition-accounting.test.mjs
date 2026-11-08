import test from 'node:test';
import assert from 'node:assert/strict';
import {dispositionAccountingState,parseRoleOutput} from '../../dist/workflow/protocol.js';
import {equivalenceAccounting,assertResolvedEquivalenceEvidence} from '../../dist/workflow/adjudication-accounting.js';
const finding={severity:'blocking'};
const decision={occurrenceId:'O',disposition:'upheld',reason:'Original assessment',witnesses:['Original evidence']};
test('local accounting distinguishes current obligations from terminal judgments',()=>{
 assert.equal(dispositionAccountingState(decision,finding,{}),'pending');
 assert.equal(dispositionAccountingState(decision,{severity:'optional'},{}),'resolved');
 assert.equal(dispositionAccountingState({...decision,disposition:'rejected'},finding,{}),'resolved');
 assert.equal(dispositionAccountingState({...decision,disposition:'deferred'},finding,{}),'pending');
 assert.equal(dispositionAccountingState({...decision,disposition:'deferred'},{severity:'optional'},{}),'resolved');
 assert.equal(dispositionAccountingState({...decision,disposition:'unresolved'},{severity:'optional'},{}),'pending');
});
test('repair and diagnosis closure require explicit effective evidence',()=>{
 for(const [resolution,key] of [['repaired','repair'],['diagnosed','diagnosis']]){
  const result={...decision,resolution};
  assert.equal(dispositionAccountingState(result,finding,{}),'unknown');
  assert.equal(dispositionAccountingState(result,finding,{[key]:false}),'pending');
  assert.equal(dispositionAccountingState(result,finding,{[key]:true}),'resolved');
 }
});
test('a requested plan remedy cannot close even an optional claim before adoption',()=>{
 const remedy={...decision,resolution:'repaired',repair:{kind:'plan',proposalHash:'a'.repeat(64)}};
 assert.equal(dispositionAccountingState(remedy,{severity:'optional'},{}),'unknown');
 assert.equal(dispositionAccountingState(remedy,{severity:'optional'},{repair:false}),'pending');
 assert.equal(dispositionAccountingState(remedy,{severity:'optional'},{repair:true}),'resolved');
});
test('local state supplies no equivalence graph closure or unrelated proof authority',()=>{
 assert.equal(dispositionAccountingState({...decision,disposition:'equivalent',equivalentTo:'T'},finding,{repair:true,diagnosis:true}),'pending');
 assert.equal(dispositionAccountingState({...decision,disposition:'unresolved'},finding,{repair:true,diagnosis:true}),'pending');
});
const edge=(id,target,witnesses=[])=>({occurrenceId:id,disposition:'equivalent',equivalentTo:target,reason:'Same retained condition',witnesses});
test('current graph evidence does not reinterpret original declined-output syntax',()=>{
 const output={version:1,summary:'Original declined plan',findings:[],assessedScope:[],planAccepted:false,
  decisions:[edge('A','T'),{...decision,occurrenceId:'T',disposition:'rejected'}]};
 const decoded=parseRoleOutput(JSON.stringify(output),'adjudicator',[],{decisionReferences:{version:3,occurrenceIds:['A','T'],diagnosisOccurrenceIds:[],pendingOrdinaryIndexes:[0,1],blockingOrdinaryIndexes:[0,1],retentionChoices:[]}});
 assert.deepEqual(decoded.issues,[]);assert.deepEqual(decoded.value,output);
 const states=equivalenceAccounting(new Map(output.decisions.map(d=>[d.occurrenceId,d])),()=> 'resolved');
 assert.throws(()=>assertResolvedEquivalenceEvidence(output.decisions,states),/retained witness: A/);
});
test('fresh transitive resolved edges each need evidence, independent of declaration order',()=>{
 const decisions=[edge('A','B'),edge('B','T',['Original target correspondence']),{...decision,occurrenceId:'T',disposition:'rejected'}];
 for(const rows of [decisions,[...decisions].reverse()]){
  const states=equivalenceAccounting(new Map(rows.map(d=>[d.occurrenceId,d])),()=> 'resolved');
  assert.equal(states.get('A'),'resolved');assert.throws(()=>assertResolvedEquivalenceEvidence(rows,states),/retained witness: A/);
  assert.doesNotThrow(()=>assertResolvedEquivalenceEvidence(rows.map(d=>({...d,witnesses:['Retained independent correspondence']})),states));
 }
});
test('pending or unknown endpoints do not manufacture witness or closure obligations',()=>{
 for(const state of ['pending','unknown']){
  const rows=[edge('A','T'),{...decision,occurrenceId:'T'}];
  const states=equivalenceAccounting(new Map(rows.map(d=>[d.occurrenceId,d])),()=>state);
  assert.equal(states.get('A'),state);assert.doesNotThrow(()=>assertResolvedEquivalenceEvidence(rows,states));
 }
 const states=equivalenceAccounting(new Map([['A',edge('A','missing')]]),()=> 'unknown');assert.equal(states.get('A'),'unknown');
});
test('retained edges inherit current targets while only fresh resolving edges need witnesses',()=>{
 const retained=edge('old','T'),fresh=edge('new','old');
 const heads=new Map([['old',retained],['new',fresh],['T',{...decision,occurrenceId:'T',disposition:'rejected'}]]);
 const closed=equivalenceAccounting(heads,()=> 'resolved');
 assert.doesNotThrow(()=>assertResolvedEquivalenceEvidence([heads.get('T')],closed),'Old pending edge can inherit closure');
 assert.throws(()=>assertResolvedEquivalenceEvidence([fresh],closed),/retained witness: new/);
 heads.set('T',{...decision,occurrenceId:'T'});
 const reopened=equivalenceAccounting(heads,()=> 'pending');assert.equal(reopened.get('new'),'pending');assert.equal(reopened.get('old'),'pending');
});
test('cycles refuse without recursion and long retained chains use the same accounting rule',()=>{
 assert.throws(()=>equivalenceAccounting(new Map([['A',edge('A','B')],['B',edge('B','A')]]),()=> 'unknown'),/equivalence cycle/);
 const heads=new Map(Array.from({length:20000},(_,i)=>[String(i),edge(String(i),String(i+1))]));
 const states=equivalenceAccounting(heads,()=> 'resolved');assert.equal(states.get('0'),'resolved');assert.equal(states.get('19999'),'resolved');
});
