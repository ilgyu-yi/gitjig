/** Real pinned engine and original SDK/Controller; controlled prose, no paid model. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAssistantMessageEventStream, getCurrentTools} from '@earendil-works/pi-ai';
import {openController} from '../../dist/controller/index.js';
import {originalFailedWaitOutcome} from '../../dist/controller/original-wait-outcome.js';

const human = '조사 결과는 사용자에게 남지만 작업 보고가 제출되지 않았습니다.';
let sharedRoot;
const usage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
async function world(t, {resultDependency=false,goalTurnLimit,paused=false,inspect,late,followup=false,ownerBatch=false,ownerContext=false} = {}) {
    const parentDirectory=process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parentDirectory&&path.isAbsolute(parentDirectory),'Explicit existing backend-shared fixture parent required');
    assert.equal(await fs.realpath(parentDirectory),parentDirectory);
    const checkout=await fs.realpath('.');assert.ok(parentDirectory!==checkout&&!parentDirectory.startsWith(checkout+path.sep));
    const runtimeProfile={dockerBinary:process.env.GITJIG_DOCKER_BINARY,dockerConfigDirectory:process.env.GITJIG_DOCKER_CONFIG_DIRECTORY,dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE};
    assert.ok(Object.values(runtimeProfile).every(Boolean),'Explicit existing pinned engine profile required');
    sharedRoot??=await fs.realpath(await fs.mkdtemp(path.join(parentDirectory,'ordinary-failed-wait-')));
    const root=sharedRoot,home=path.join(root,'home'),project=path.join(root,'project');
    await fs.mkdir(project,{recursive:true});await fs.writeFile(path.join(project,'original.txt'),'Retain original source bytes.\n');
    const oldTmp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');
    let c,release;const gate=new Promise(resolve=>release=resolve),continuations=[];let childEntered=false,checked=false,reported=false,originalChild,lateInjected=false,parentCalls=0;
    t.after(async()=>{release();try{await c?.ordinary.drain();await c?.close();}finally{if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;t.diagnostic('Retained owned engine evidence '+root);}});
    c=await openController({installationHome:home,runtimeProfile,interactionDelegation:{projectIds:['P'],maxAssignments:1}});
    if(!c.listProjects().some(project=>project.id==='P'))await c.registerProject({id:'P',sourceRoot:project});const parent=c.createConversation(ownerContext?{projectId:'P'}:undefined).conversationId,s=c.store;
    const identity=randomUUID(),model={provider:'ordinary-failed-wait-'+identity,modelId:'fixture',definition:{api:'ordinary-failed-wait-api-'+identity,apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:64000,maxTokens:2000,cost:usage.cost}],streamSimple(selected,context){
        const stream=createAssistantMessageEventStream();
        void(async()=>{try{
            let tool,text;
            if(getCurrentTools(context.messages).some(tool=>tool.name==='conversation_report')){childEntered=true;await gate;text=human;}
            else {
                parentCalls++;
                const entry=context.messages.filter(message=>message.role==='user').at(-1);
                let latest=typeof entry?.content==='string'?entry.content:entry?.content.filter(part=>part.type==='text').map(part=>part.text).join('')??'';
                if(latest.startsWith('User-supplied project context follows as JSON data.')){
                    const captured=JSON.parse(latest.slice(latest.indexOf('\n')+1));
                    assert.equal(captured.files[0].path,'original.txt');assert.equal(captured.files[0].text,'Retain original source bytes.\n');latest=captured.text;
                }
                const assigned=context.messages.filter(message=>message.role==='toolResult'&&message.toolName==='conversation_assign').at(-1);
                if(latest.startsWith('Inspect the same conversation after diagnostic settlement')||latest==='Second canonical owner input')text='후속 사용자 입력을 정상 처리했습니다.';
                else if(latest.startsWith('Explicitly resumed authorized dependency outcomes (outcome is not success):')){
                    if(!continuations.includes(latest))continuations.push(latest);assert.ok(!latest.includes(human));
                    tool=goalTurnLimit&&!reported?{name:'goal_progress',arguments:{disposition:'need-owner',plan:'Inspect original unavailable report',nextAction:'Owner review of original diagnostic',reason:'Original report is unavailable; no successful task completion',resultIds:[]}}:undefined;
                    if(tool)reported=true;
                    if(!tool)text='원래 조사 작업의 보고가 누락됐습니다. 재시도하지 않았습니다.';
                } else if(!assigned)tool={name:'conversation_assign',arguments:{projectId:'P',instructions:'Read the fixed source; do not change it. Report the observation to the coordinator.',operation:'investigate',resultDependency}};
                else {const receipt=JSON.parse(assigned.content.filter(part=>part.type==='text').map(part=>part.text).join(''));tool={name:'conversation_wait',arguments:{resultHandles:[receipt.assignmentId]}};}
            }
            const message={role:'assistant',content:tool?[{type:'toolCall',id:randomUUID(),name:tool.name,arguments:tool.arguments}]:[{type:'text',text}],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:tool?'toolUse':'stop',timestamp:Date.now()};
            stream.push({type:'done',reason:message.stopReason,message});stream.end(message);
        }catch(error){const message={role:'assistant',content:[],api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:'error',errorMessage:String(error),timestamp:Date.now()};stream.push({type:'error',reason:'error',error:message});stream.end(message);}})();return stream;
    }}};
    let goal;
    if(goalTurnLimit){goal=c.createGoal({conversationId:parent,objective:'Inspect the assigned observation without inventing a report',criteria:['Keep missing report unavailable'],turnLimit:goalTurnLimit});c.startGoal({goalId:goal.goalId,expectedRevision:goal.revision,model});}
    else {await c.queueConversationInput({conversationId:parent,expectedGeneration:0,text:'조사를 하나 위임하고 결과를 기다려줘.',mode:'idle'});assert.equal((await c.runConversation({conversationId:parent,model})).status,'waiting');}
    for(let n=0;n<1000&&(!childEntered||c.inspectConversation(parent).state!=='WAITING');n++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(childEntered,true);assert.equal(c.inspectConversation(parent).state,'WAITING');
    if(paused){const current=c.inspectGoal(goal.goalId);await c.pauseGoal({goalId:goal.goalId,expectedRevision:current.revision,reason:'Owner pauses original WAIT before child result'});}
    if(late){
        const beforeFresh=c.completed.beforeFresh.bind(c.completed);
        c.completed.beforeFresh=async conversation=>{
            await beforeFresh(conversation);
            const state=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',parent).data);
            if(conversation!==parent||!state.explicitContinuation?.ordinaryDiagnosticFence||lateInjected)return;
            lateInjected=true;
            const assignment=s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',parent),a=JSON.parse(assignment.data);
            if(late==='own-source'){
                s.run('UPDATE conversation_inputs SET text=? WHERE id=?','Changed queued diagnostic source',state.explicitContinuation.inputId);
                s.run('UPDATE sources SET raw=? WHERE id=?','Changed queued diagnostic source',state.explicitContinuation.sourceId);
            }
            if(late==='child-input')await c.queueConversationInput({conversationId:assignment.target,expectedGeneration:c.inspectConversation(assignment.target).generation,text:'New child owner input after diagnostic enqueue',mode:'idle'});
            if(late==='run'){
                const row=s.one('SELECT data FROM runs WHERE id=?',a.result.runId);
                s.run('UPDATE runs SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),modelIdentity:'f'.repeat(64)}),a.result.runId);
            }
            if(late==='publication'){
                const row=s.one('SELECT data FROM conversation_results WHERE id=?',a.resultId);
                s.run('UPDATE conversation_results SET data=? WHERE id=?',JSON.stringify({...JSON.parse(row.data),publicationHash:'c'.repeat(64)}),a.resultId);
            }
        };
    }
    const observe=c.goals.observeDependencies.bind(c.goals);
    c.goals.observeDependencies=()=>{
        const assignment=s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',parent);
        if(assignment?.state==='UNAVAILABLE'&&!checked){checked=true;originalChild={assignment,runs:s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',assignment.work),publication:s.one('SELECT * FROM conversation_results WHERE id=?',JSON.parse(assignment.data).resultId)};inspect?.({c,s,parent,assignment});}
        return observe();
    };
    release();await c.ordinary.drain();
    assert.equal(checked,true);
    const assignment=s.one('SELECT * FROM conversation_assignments WHERE source_conversation=?',parent),a=JSON.parse(assignment.data);
    assert.equal(assignment.state,'UNAVAILABLE');assert.equal(a.result.status,'unavailable');assert.match(a.result.failure,/^COORDINATOR_REPORT_REQUIRED:/);
    assert.equal(a.result.answer,undefined);assert.equal(a.result.coordinatorReport,undefined);
    assert.equal(s.one('SELECT COUNT(*) n FROM conversation_assignments WHERE source_conversation=?',parent).n,1);
    assert.equal(s.one('SELECT COUNT(*) n FROM runs WHERE work=?',assignment.work).n,1);
    assert.equal(s.one('SELECT state FROM conversation_dependencies WHERE assignment=?',assignment.id)?.state,resultDependency?'PENDING':undefined);
    const shouldResume=!late&&!paused&&goalTurnLimit!==1;
    assert.equal(continuations.length,shouldResume?1:0);
    assert.equal(s.one("SELECT COUNT(*) n FROM runs WHERE json_extract(data,'$.conversation')=?",parent).n,shouldResume?2:1);
    for(let n=0;n<3;n++)c.ordinary.resumeAuthorized();await c.ordinary.drain();assert.equal(continuations.length,shouldResume?1:0);
    assert.deepEqual(assignment,originalChild.assignment);
    if(late!=='run')assert.deepEqual(s.all('SELECT * FROM runs WHERE work=? ORDER BY rowid',assignment.work),originalChild.runs);
    if(late!=='publication')assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',a.resultId),originalChild.publication);
    const parentWork=s.one('SELECT work FROM conversation_state WHERE conversation=?',parent).work;
    assert.equal(s.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",parentWork).consumed,shouldResume?2:1);
    assert.equal(s.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",assignment.work).consumed,1);
    assert.equal(s.one('SELECT COALESCE(SUM(reserved),0) n FROM budgets').n,0);
    assert.ok(s.all('SELECT phase,reservation FROM runs').every(run=>run.phase==='SETTLED'&&run.reservation==='consumed'));
    assert.ok(s.all('SELECT state FROM capacity_leases').every(lease=>lease.state==='RELEASED'));
    assert.equal(await fs.readFile(path.join(project,'original.txt'),'utf8'),'Retain original source bytes.\n');
    if(late){
        assert.equal(lateInjected,true);assert.equal(parentCalls,2,'No parent SDK request after stale diagnostic enqueue');
        const state=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',parent).data),receipt=state.explicitContinuation;
        assert.ok(receipt.ordinaryDiagnosticFence);assert.equal(receipt.newRunId,undefined);
        assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',receipt.inputId).state,'QUEUED');
        await assert.rejects(c.runConversation({conversationId:parent,model}),/Original diagnostic/);
        assert.equal(parentCalls,2,'Stale queued receipt retry cannot recapture changed child evidence');
        const originalState=s.one('SELECT data FROM conversation_state WHERE conversation=?',parent).data;
        try{
            s.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify({...JSON.parse(originalState),explicitContinuation:{...receipt,newRunId:receipt.runId}}),parent);
            await assert.rejects(c.runConversation({conversationId:parent,model}),/Original diagnostic reservation correspondence/);
            assert.equal(parentCalls,2,'A newRunId field alone cannot waive the fence');
        }finally{s.run('UPDATE conversation_state SET data=? WHERE conversation=?',originalState,parent);}

        assert.equal(s.one("SELECT COUNT(*) n FROM runs WHERE json_extract(data,'$.conversation')=?",parent).n,1);
        assert.equal(s.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",parentWork).consumed,1);
    }
    if(goal){const current=c.inspectGoal(goal.goalId);assert.equal(current.startedAttempts,shouldResume?2:1);assert.equal(current.state,paused?'PAUSED':goalTurnLimit===1?'BUDGET_EXHAUSTED':'WAITING_INPUT');}
    if(followup){
        const ownerOptions={conversationId:parent,expectedGeneration:c.inspectConversation(parent).generation,text:'Inspect the same conversation after diagnostic settlement'+(ownerContext?' @original.txt @@owner':''),mode:'idle'};
        const ownerReceipt=ownerContext?await c.queueConversationInputWithContext(ownerOptions):await c.queueConversationInput(ownerOptions);
        const secondOwner=ownerBatch?await c.queueConversationInput({...ownerOptions,text:'Second canonical owner input'}):null;
        if(ownerContext){const input=s.one('SELECT * FROM conversation_inputs WHERE id=?',ownerReceipt.inputId),source=s.one('SELECT * FROM sources WHERE id=?',input.source);assert.notEqual(source.raw,input.text);assert.ok(JSON.parse(input.data).context.files.length===1);}
        if(late){
            const receipt=JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',parent).data).explicitContinuation;
            const extraInput=randomUUID(),extraSource=randomUUID();
            s.run('INSERT INTO sources VALUES(?,?,?,?)',extraSource,parent,JSON.stringify({kind:'agent-conversation-input',actor:receipt.sourceIdentity,event:randomUUID()}),'Unselected controlled agent input');
            s.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)',extraInput,parent,c.inspectConversation(parent).generation,parentWork,extraSource,'QUEUED','idle','Unselected controlled agent input','{}');
            try{await assert.rejects(c.runConversation({conversationId:parent,model,initialInputId:extraInput}),/Original diagnostic/);}
            finally{s.run('DELETE FROM conversation_inputs WHERE id=?',extraInput);s.run('DELETE FROM sources WHERE id=?',extraSource);}
            const oldSource=s.one('SELECT raw FROM sources WHERE id=?',receipt.sourceId).raw;
            try{
                s.run('UPDATE sources SET raw=? WHERE id=?','Forged old diagnostic source',receipt.sourceId);
                await assert.rejects(c.runConversation({conversationId:parent,model}),/Original diagnostic/);
            }finally{s.run('UPDATE sources SET raw=? WHERE id=?',oldSource,receipt.sourceId);}
            assert.equal(parentCalls,2,'Owner presence and conflict labels cannot authorize another selected input or forged old source');
        }
        const next=await c.runConversation({conversationId:parent,model});
        assert.equal(next.status,'delivered');assert.equal(next.answer.text[0].text,'후속 사용자 입력을 정상 처리했습니다.');
        assert.equal(JSON.parse(s.one('SELECT data FROM runs WHERE id=?',next.runId).data).initialInputId,ownerReceipt.inputId,'Default entry selects the first queued canonical owner input');
        assert.equal(s.one("SELECT consumed FROM budgets WHERE lineage=? AND kind='execution'",parentWork).consumed,shouldResume?3:2);
        if(secondOwner){
            const input=s.one('SELECT * FROM conversation_inputs WHERE id=?',secondOwner.inputId);assert.equal(input.source,secondOwner.sourceId);
            if(input.state==='QUEUED')assert.equal((await c.runConversation({conversationId:parent,model})).status,'delivered');
            assert.equal(s.one('SELECT state FROM conversation_inputs WHERE id=?',secondOwner.inputId).state,'CONSUMED');
        }

    }
    await fs.writeFile(path.join(root,'result-'+parent+'.json'),JSON.stringify({parent,assignmentId:assignment.id,childWork:assignment.work,continuations:continuations.length,lateControl:late??null,lateInjected,parentCalls,goal:goal?c.inspectGoal(goal.goalId):null,runs:s.all('SELECT * FROM runs'),leases:s.all('SELECT * FROM capacity_leases'),originalAssignment:assignment},null,2));
}

for(const resultDependency of [false,true])test('actual ordinary missing-report failure resumes original WAIT exactly once; dependency='+resultDependency,{timeout:60000},t=>world(t,{resultDependency}));
for(const [name,options]of [['charged',{goalTurnLimit:4}],['exhausted',{goalTurnLimit:1}],['paused',{goalTurnLimit:4,paused:true}]])test('ordinary failed-report continuation retains original goal '+name,{timeout:60000},t=>world(t,options));

test('ordinary host diagnostic refuses changed family, publication, source, input and unsettled ownership', {timeout:60000}, t=>world(t,{inspect({s,parent,assignment}){
    const a=JSON.parse(assignment.data),run=s.one('SELECT * FROM runs WHERE id=?',a.result.runId),target=s.one('SELECT * FROM conversation_state WHERE conversation=?',assignment.target);
    const read=()=>originalFailedWaitOutcome(s,parent,assignment.id).state;
    assert.equal(read(),'deliverable');
    const tables=['conversation_assignments','conversation_results','conversation_state','conversations','conversation_inputs','sources','works','runs','budgets','capacity_leases'];
    const census=()=>JSON.stringify(tables.map(table=>s.all(`SELECT * FROM ${table} ORDER BY rowid`)));
    const before=census(),rollback=new Error('Rollback controlled negative metadata');
    const patch=(table,key,id,values)=>{const row=s.one(`SELECT data FROM ${table} WHERE ${key}=?`,id);s.run(`UPDATE ${table} SET data=? WHERE ${key}=?`,JSON.stringify({...JSON.parse(row.data),...values}),id);};
    const projection=values=>{const raw={...a.result,...values};patch('conversation_assignments','id',assignment.id,{result:raw});patch('conversation_results','id',a.resultId,{result:raw});};
    const mutations=[
        ['governed operation',()=>patch('conversation_assignments','id',assignment.id,{operation:'change'})],
        ['effect operation',()=>patch('conversation_assignments','id',assignment.id,{operation:'effect-integrate'})],
        ['context',()=>patch('works','id',assignment.work,{contextOrigin:{kind:'fork'}})],
        ['reentry',()=>patch('conversation_assignments','id',assignment.id,{reentries:[]})],
        ['recovery',()=>patch('conversation_assignments','id',assignment.id,{authorityRecovery:{}})],
        ['wrong initial input',()=>patch('runs','id',run.id,{initialInputId:randomUUID()})],
        ['wrong original source',()=>s.run('UPDATE conversation_inputs SET source=? WHERE id=?',s.one('SELECT source FROM works WHERE id=?',JSON.parse(s.one('SELECT data FROM conversation_state WHERE conversation=?',parent).data).sourceIdentity.workId).source,a.inputId)],
        ['wrong assignment input',()=>patch('conversation_inputs','id',a.inputId,{assignment:randomUUID()})],
        ['wrong current run',()=>patch('conversation_state','conversation',assignment.target,{runId:randomUUID()})],
        ['wrong session',()=>s.run('UPDATE conversation_state SET native_id=? WHERE conversation=?',randomUUID(),assignment.target)],
        ['stale epoch',()=>s.run('UPDATE works SET epoch=epoch+1 WHERE id=?',assignment.work)],
        ['stale generation',()=>s.run('UPDATE conversations SET generation=generation+1 WHERE id=?',assignment.target)],
        ['cancelled assignment',()=>s.run("UPDATE conversation_assignments SET state='CANCELLED' WHERE id=?",assignment.id)],
        ['unknown child',()=>s.run("UPDATE works SET state='UNKNOWN' WHERE id=?",assignment.work)],
        ['not report required',()=>patch('runs','id',run.id,{ordinaryCoordinatorReportRequired:false})],
        ['not original delivered',()=>patch('runs','id',run.id,{outcome:'unavailable'})],
        ['malformed answer hash',()=>patch('runs','id',run.id,{ordinaryAnswerHash:'missing'})],
        ['recorded report',()=>patch('runs','id',run.id,{ordinaryReportHash:'a'.repeat(64)})],
        ['no checkpoint',()=>patch('runs','id',run.id,{nativeCheckpoint:null})],
        ['wrong cleanup',()=>patch('runs','id',run.id,{cleanup:'quarantined'})],
        ['unknown run',()=>s.run("UPDATE runs SET phase='UNKNOWN' WHERE id=?",run.id)],
        ['bad capacity',()=>s.run("UPDATE capacity_leases SET state='QUARANTINED' WHERE work=?",assignment.work)],
        ['missing wait',()=>patch('conversation_state','conversation',parent,{waitHandles:[]})],
        ['foreign actor',()=>patch('conversation_assignments','id',assignment.id,{source:{...a.source,runId:randomUUID()}})],
        ['no audience',()=>patch('conversation_results','id',a.resultId,{audience:[]})],
        ['wrong result version',()=>patch('conversation_results','id',a.resultId,{version:1})],
        ['malformed original digest',()=>patch('conversation_results','id',a.resultId,{publicationHash:'unavailable'})],
        ['no publication',()=>s.run('DELETE FROM conversation_results WHERE id=?',a.resultId)],
        ['wrong diagnostic',()=>projection({failure:'Ordinary arbitrary error'})],
        ['human body',()=>projection({answer:{text:human}})],
        ['coordinator report',()=>projection({coordinatorReport:{text:'Invented report'}})],
        ['native result',()=>projection({nativeResult:{value:'Unproved'}})],
        ['extra field',()=>projection({extra:'Unproved'})],
        ['successful label',()=>projection({status:'delivered'})],
    ];
    for(const conversation of [parent,assignment.target])for(const state of ['QUEUED','INITIAL_RESERVED','NATIVE_PENDING','RECONCILIATION_REQUIRED'])mutations.push(['pending '+conversation+' '+state,()=>s.run('INSERT INTO conversation_inputs SELECT ?,conversation,generation,work,source,?,mode,text,data FROM conversation_inputs WHERE id=?',randomUUID(),state,conversation===parent?a.source.initialInputId:a.inputId)]);
    for(const [name,mutate]of mutations){
        assert.throws(()=>s.tx(()=>{mutate();assert.equal(read(),'held',name);throw rollback;}),error=>error===rollback);
        assert.equal(census(),before,'Negative control rollback preserves original '+name);
    }
    assert.throws(()=>s.tx(()=>{s.run("UPDATE runs SET phase='SETTLING',reservation='reserved' WHERE id=?",run.id);assert.equal(read(),'pending');throw rollback;}),error=>error===rollback);
    assert.equal(census(),before);assert.equal(read(),'deliverable');
    // This path authenticates a host diagnostic only. Full-human digest is not
    // reinterpreted as a projected-body checksum or claimed as payload validation.
    assert.notEqual(JSON.parse(s.one('SELECT data FROM conversation_results WHERE id=?',a.resultId).data).publicationHash,undefined);
    assert.equal(JSON.parse(target.data).runId,run.id);
}}));

for(const late of ['child-input','run','publication','own-source'])test('late '+late+' drift after diagnostic enqueue refuses reservation and stale receipt retry',{timeout:60000},t=>world(t,{late}));

test('committed diagnostic successor proof permits a later fresh owner input',{timeout:60000},t=>world(t,{followup:true}));

test('new canonical owner input supersedes a refused queued diagnostic without delivering it',{timeout:60000},t=>world(t,{late:'child-input',followup:true}));

test('repeated canonical owner queue preserves first selection after diagnostic refusal',{timeout:60000},t=>world(t,{late:'child-input',followup:true,ownerBatch:true}));
test('captured file context can supersede a refused diagnostic through public owner entry',{timeout:60000},t=>world(t,{late:'child-input',followup:true,ownerContext:true}));
