import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';

/** Controlled parent standing; original child admission/capture/cancellation are actual.
 * No model, engine, completed procedure or source-code mutation is claimed here.
 */
export async function ownerAssignmentCancellationWorld(t) {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-owner-task-cancel-'))),home=path.join(root,'home');
    for(const name of ['project','other']){await fs.mkdir(path.join(root,name));await fs.writeFile(path.join(root,name,'file.txt'),'owned fixture source');}
    const c=await openController({installationHome:home});let passed=false;
    t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original assignment cancellation '+root);});
    await c.registerProject({id:'P',sourceRoot:path.join(root,'project')});await c.registerProject({id:'Q',sourceRoot:path.join(root,'other')});
    const s=c.store,parent=c.createConversation({projectId:'P'}).conversationId,parentWork=randomUUID(),parentRun=randomUUID(),parentSource=randomUUID();
    s.run('INSERT INTO sources VALUES(?,?,?,?)',parentSource,parent,JSON.stringify({kind:'owner-conversation-input',uid:process.getuid?.()}),'Original parent fixture request');
    s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',parentWork,'P',parentSource,null,parentWork,'ACTIVE',1,1,null,JSON.stringify({kind:'ordinary-conversation',conversation:parent}));
    for(const kind of ['execution','resolution'])s.run('INSERT INTO budgets VALUES(?,?,?,?,?)',parentWork,kind,32,1,0);
    s.run('INSERT INTO requirements VALUES(?,?,?,?)',parentWork,1,'Original parent fixture request','{}');
    s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',parentRun,parentWork,1,1,'SETTLED',root,'consumed',JSON.stringify({kind:'ordinary-conversation',conversation:parent,cleanup:'not-allocated'}));
    s.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?',parentWork,JSON.stringify({runId:parentRun}),parent);
    const actor={conversationId:parent,workId:parentWork,runId:parentRun,launchId:null,generation:0,directionRevision:0,initialInputId:'owned-parent-input'};
    const assign=async (state='UNAVAILABLE',sourceActor=actor,resultDependency=true)=>{
        const coordinator=sourceActor.conversationId;
        const target=c.createConversation({projectId:'P'}).conversationId,assignment=randomUUID(),instruction=randomUUID(),input=randomUUID(),dependency=randomUUID();
        c.setConversationParent({childId:target,parentId:coordinator,expectedRevision:0});
        s.run('INSERT INTO sources VALUES(?,?,?,?)',instruction,target,JSON.stringify({kind:'agent-assignment',actor:sourceActor,event:assignment}),'Original assigned fixture request');
        s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)',input,target,0,null,instruction,'QUEUED','idle','Original assigned fixture request',JSON.stringify({assignment}));
        s.run('INSERT INTO conversation_assignments VALUES(?,?,?,?,?,?)',assignment,coordinator,target,null,'QUEUED',JSON.stringify({source:sourceActor,operation:'change',projectId:'P',instructionsSource:instruction,inputId:input,resultDependency}));
        if(resultDependency)s.run('INSERT INTO conversation_dependencies VALUES(?,?,?,?,?,?)',dependency,coordinator,target,assignment,'PENDING',JSON.stringify({source:sourceActor}));
        const work=await c.changeCore.begin({projectId:'P',request:'Original assigned fixture request'},{kind:'agent-governed-assignment',actor:sourceActor,delegationRoot:sourceActor.workId,sourceEvent:instruction,conversationId:target,assignmentId:assignment});
        const run=s.one('SELECT id FROM runs WHERE work=?',work.workId);
        s.run('UPDATE conversation_state SET work=?,data=? WHERE conversation=?',work.workId,JSON.stringify({runId:run.id}),target);
        s.run("UPDATE change_state SET phase='BLOCKED' WHERE work=?",work.workId);
        const data=JSON.parse(s.one('SELECT data FROM conversation_assignments WHERE id=?',assignment).data);
        s.run('UPDATE conversation_assignments SET state=?,data=? WHERE id=?',state,JSON.stringify({...data,result:{phase:'BLOCKED',reviewReady:false}}),assignment);
        s.run('UPDATE conversation_inputs SET state=?,work=? WHERE id=?','DISPATCHED_WORKFLOW',work.workId,input);
        if(resultDependency&&state==='COMPLETE')s.run("UPDATE conversation_dependencies SET state='RESOLVED' WHERE id=?",dependency);
        return {target,assignment,work:work.workId,dependency,input,instruction};
    };
    const child=await assign(),sibling=await assign('COMPLETE');
    return {root,home,c,s,parent,parentWork,actor,child,sibling,assign,pass(){passed=true;}};
}
export const cancellationLedger=s=>Object.fromEntries(['sources','works','runs','budgets','conversation_state','conversation_inputs','conversation_assignments','conversation_dependencies'].map(table=>[table,s.all('SELECT * FROM '+table+' ORDER BY rowid')]));
