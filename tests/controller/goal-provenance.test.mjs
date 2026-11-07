import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../dist/controller/store.js';
import {Goals} from '../../dist/controller/goals.js';

// Exercise the actual provenance consumer with a controlled local ledger, not
// model judgment or completion acceptance. Every foreign key remains enabled.
function fixture(t){
 const s=new Store(':memory:'),goals=new Goals({store:s,interactions:{inspect:()=>({directionRevision:1,projectId:null,generation:1,workId:'root'})}});t.after(()=>s.close());
 s.run('INSERT INTO conversations VALUES(?,?,?,?,?)','conversation',null,null,1,'IDLE');
 s.run('INSERT INTO conversations VALUES(?,?,?,?,?)','unrelated-conversation',null,null,1,'IDLE');
 s.run('INSERT INTO sources VALUES(?,?,?,?)','source','conversation','{}','Fixture');
 for(const work of ['root','child'])s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',work,null,'source',null,work,'ACTIVE',1,1,null,'{}');
 s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)','input','conversation',1,'root','source','CONSUMED','message','Fixture','{}');
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','author','root',1,1,'SETTLED','unused','consumed','{}');
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)','child-run','child',1,1,'SETTLED','unused','consumed',JSON.stringify({initialInputId:'child-input'}));
 s.run('INSERT INTO goals VALUES(?,?,?,?,?)','goal','conversation',1,'COMPLETED',JSON.stringify({expectedDirection:1,projectId:null}));
 s.run('INSERT INTO goal_attempts VALUES(?,?,?,?,?,?,?,?,?,?)','attempt','goal',1,'author','conversation','input','author','COMPLETE',1,JSON.stringify({identity:{generation:1,workId:'root'}}));
 const assignment=(id,run,work=null,extra={})=>s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',id,'conversation','conversation',work,'COMPLETE',JSON.stringify({source:{runId:run},...extra}));
 return {s,goals,assignment};
}
test('goal provenance isolates unrelated history and retains transitive links in stable order',t=>{
 const {s,goals,assignment}=fixture(t);
 for(let i=0;i<500;i++)assignment('unrelated-'+i,'other-run');
 s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)','corrupt','unrelated-conversation','conversation',null,'COMPLETE','{');
 // Insert the descendant before its parent to require another closure pass.
 assignment('descendant','child-run');assignment('parent','author','child',{inputId:'child-input'});
 const original=s.one.bind(s),assignmentReads=[];
 s.one=(sql,...args)=>{const row=original(sql,...args);if(sql.includes('AS sequence'))assignmentReads.push(row?.id);return row;};
 assert.deepEqual(goals.links('goal').map(row=>row.id),['parent','descendant']);
 assert.ok(assignmentReads.includes('parent'));assert.ok(assignmentReads.includes('descendant'));assert.ok(assignmentReads.every(id=>id===undefined||['parent','descendant'].includes(id)));
 assert.deepEqual(goals.links('no-attempts'),[]);
});
test('goal provenance refuses oversized related evidence and excessive links',t=>{
 const {s,goals,assignment}=fixture(t);
 assignment('large','author',null,{text:'x'.repeat(1024*1024)});
 assert.throws(()=>goals.links('goal'),/Bounded goal assignment evidence unavailable/);
 s.run('DELETE FROM conversation_assignments WHERE id=?','large');
 for(let i=0;i<129;i++)assignment('related-'+i,'author');
 assert.throws(()=>goals.links('goal'),/exceeds128 links/);
});

test('completion evidence refuses an original child with lost source provenance before snapshot capture',t=>{
 const {s,goals,assignment}=fixture(t);
 assignment('original-child','author','child',{inputId:'child-input'});
 assert.deepEqual(goals.links('goal').map(row=>row.id),['original-child']);
 s.run('UPDATE conversation_assignments SET data=? WHERE id=?','{','original-child');
 const attempt=s.one('SELECT * FROM goal_attempts WHERE id=?','attempt');
 assert.throws(()=>goals.evidenceSource(attempt),/Goal assignment provenance unavailable/);
 // Valid JSON with missing provenance is also unknown, not proven unrelated.
 s.run('UPDATE conversation_assignments SET data=? WHERE id=?','{}','original-child');
 assert.throws(()=>goals.evidenceSource(attempt),/Goal assignment provenance unavailable/);
});

test('goal provenance preserves interleaved parent/descendant/sibling traversal and bounds aggregate bytes',t=>{
 const {s,goals,assignment}=fixture(t);
 assignment('parent','author','child',{inputId:'child-input'});assignment('descendant','child-run');assignment('sibling','author');
 assert.deepEqual(goals.links('goal').map(row=>row.id),['parent','descendant','sibling']);
 s.run('DELETE FROM conversation_assignments');
 assignment('first','author',null,{text:'x'.repeat(600000)});assignment('second','author',null,{text:'x'.repeat(600000)});
 assert.throws(()=>goals.links('goal'),/Bounded goal assignment evidence unavailable/);
});
