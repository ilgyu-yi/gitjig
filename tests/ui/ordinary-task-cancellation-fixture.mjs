import {structuredAssignmentWorld} from '../controller/structured-assignment-fixture.mjs';

/** Controlled admitted ordinary-child profile (no engine or native child run).
 * Native parent assignment/capture is original; this fixture changes its retained
 * task profile to cover the UI's ordinary recovery branch. Cancellation, guards,
 * parent scope transition and actual terminal/SDK components remain original.
 */
export async function ordinaryTaskWorld(t) {
    const f=await structuredAssignmentWorld(t);await f.assign();const s=f.c.store,id=f.child.assignmentId;
    const a=s.one('SELECT data FROM conversation_assignments WHERE id=?',id),data=JSON.parse(a.data),work=s.one('SELECT data FROM works WHERE id=?',f.child.workId);
    s.run('DELETE FROM change_state WHERE work=?',f.child.workId);
    s.run('UPDATE works SET source=?,data=? WHERE id=?',data.instructionsSource,JSON.stringify({...JSON.parse(work.data),kind:'ordinary-conversation',assignmentId:id}),f.child.workId);
    const {resultId:_oldResultId,...retained}=data;
    s.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?','UNAVAILABLE',JSON.stringify({...retained,operation:'investigate',result:{status:'unavailable',workId:f.child.workId,cleanup:'not-allocated'}}),id);
    s.run("UPDATE conversation_dependencies SET state='PENDING' WHERE assignment=?",id);
    s.run("UPDATE conversation_inputs SET state='CONSUMED',work=? WHERE id=?",f.child.workId,data.inputId);
    return f;
}
