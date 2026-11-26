import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { scripted } from '../controller/effect-fixture.mjs';

const cfg = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const source = path.join(cfg.root, 'project');
const shim = path.join(cfg.root, 'scope.mjs');
process.env.TMPDIR = path.join(cfg.home, 'artifacts');
await fs.mkdir(source);
await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
await fs.writeFile(path.join(source, 'check.cjs'), '// Controlled planning scope.\n');
await fs.writeFile(shim, `export {RuntimeHelperUnavailableError} from ${JSON.stringify(import.meta.resolve('../../dist/execution/container-scope.js'))};
export const createScope = options => globalThis.__planningQuestionScope(options);`);
registerHooks({ resolve(specifier, context, next) {
    if (/\/controller\/(ordinary|change-core)\.js$/u.test(context.parentURL ?? '') && specifier.endsWith('/execution/container-scope.js'))
        return { url: pathToFileURL(shim).href, shortCircuit: true };
    return next(specifier, context);
} });
globalThis.__planningQuestionScope = async options => {
    const deny = () => assert.fail('Unexpected project execution');
    return {containerId:'planning-fixture',workspaceRoot:options.workRoot,
        validatePath:name=>path.resolve(options.workRoot,name), readFile:name=>fs.readFile(path.resolve(options.workRoot,name),'utf8'),
        access:async()=>{}, exec:deny, writeFile:deny, mkdir:deny, close:async()=>({state:'removed'})};
};
globalThis.fetch = () => assert.fail('Unexpected provider network request');
const {openController} = await import('../../dist/controller/index.js');
const {startConversationUI} = await import('../../dist/ui/index.js');
const c = await openController({installationHome:cfg.home,
    runtimeProfile:{dockerBinary:process.execPath,dockerContext:'PLANNING_CONTROLLED',image:'sha256:'+'a'.repeat(64)},
    interactionDelegation:{projectIds:['P'],maxAssignments:cfg.continuation ? 1 : 3}});
try {
    await c.registerProject({id:'P',sourceRoot:source});
    const parent=c.createConversation();
    c.setConversationLanguage({conversationId:parent.conversationId,expectedGeneration:0,expectedRevision:0,replyLanguage:cfg.locale});
    if (cfg.continuation) await exerciseOwnerContinuation(c,parent);
    else await exercisePlanningQuestion(c,parent);
} finally { await c.close(); }

async function exercisePlanningQuestion(c, parent) {
    c.setDraft({conversationId:parent.conversationId,expectedRevision:0,text:cfg.draft});
    const text = msg => typeof msg.content === 'string' ? msg.content : msg.content.filter(part=>part.type==='text').map(part=>part.text).join('');
    const model = scripted(context => {
        const source = text(context.messages.find(message=>message.role==='user'));
        if (context.messages.some(message=>message.role==='user' && text(message).startsWith('Explicitly resumed authorized')))
            return {text:'The original task is held for the owner decision.'};
        const assigned=context.messages.find(message=>message.role==='toolResult' && message.toolName==='conversation_assign');
        if (assigned) return {tool:{name:'conversation_wait',arguments:{resultHandles:[JSON.parse(text(assigned)).assignmentId]}}};
        const middle = cfg.nested && !source.includes('MANAGED_PLANNING_MIDDLE');
        return {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:middle?'investigate':'change',
            instructions:middle?'MANAGED_PLANNING_MIDDLE Delegate and wait.':'Consumer exports3',resultDependency:true}}};
    }, ({role,result}) => {
        if (role!=='adjudicator') return;
        result.planAccepted=false;
        delete result.acceptedPlan;
        result.ownerDecisionRequired=[cfg.question];
    });
    await c.queueConversationInput({conversationId:parent.conversationId,expectedGeneration:0,text:'Delegate the original planning and wait.',mode:'idle'});
    await c.runConversation({conversationId:parent.conversationId,model});
    await c.ordinary.drain();
    const assigned=c.store.one("SELECT * FROM conversation_assignments WHERE json_extract(data,'$.operation')='change'");
    assert.equal(assigned.state,'UNAVAILABLE');
    const clarification=c.inspectChangeResult(assigned.work).planningClarification;
    assert.ok(clarification?.reply);
    assert.equal(clarification.questions.total,1);
    const reply=clarification.reply.conversationId;
    c.setConversationLanguage({conversationId:reply,expectedGeneration:clarification.reply.generation,expectedRevision:0,replyLanguage:cfg.locale});
    c.setDraft({conversationId:reply,expectedRevision:0,text:cfg.replyDraft});
    if (cfg.archived) await c.archiveConversation({conversationId:reply,expectedGeneration:clarification.reply.generation});
    c.setConversationView({selectedId:parent.conversationId});
    const facts=()=>c.store.all('SELECT id,work,state FROM conversation_assignments ORDER BY rowid');
    const originals=facts(), runCount=c.store.one('SELECT count(*) AS n FROM runs').n;
    await fs.writeFile(cfg.ready,JSON.stringify({parent:parent.conversationId,reply,work:assigned.work,outputId:clarification.outputId,runCount}));
    await startConversationUI({controller:c,conversationId:parent.conversationId});
    assert.deepEqual(facts(),originals);
    assert.equal(c.store.one('SELECT count(*) AS n FROM runs').n,runCount);
    assert.equal(c.inspectConversation(parent.conversationId).draft.text,cfg.draft);
    assert.equal(c.inspectConversation(reply).draft.text,cfg.answer ? '' : cfg.replyDraft);
    assert.equal(c.store.one('SELECT selected FROM interaction_view').selected,parent.conversationId);
    const answers = c.store.all(`SELECT i.text,i.state,d.data FROM conversation_inputs i
        JOIN conversation_directions d ON d.source=i.source AND d.conversation=i.conversation
        WHERE i.conversation=? AND i.work=?`, reply,assigned.work);
    if (cfg.answer) {
        assert.equal(answers.length,1);
        assert.equal(answers[0].text,cfg.answer);
        assert.equal(answers[0].state,'CONFLICTED');
        assert.equal(JSON.parse(answers[0].data).effectHold,true);
    } else assert.equal(answers.length,0);
}

async function exerciseOwnerContinuation(c, parent) {
    const s=c.store, cid=parent.conversationId, calls=[];
    let initial, original, oldWork, oldDirections, oldUsage;
    const text=message=>typeof message?.content==='string' ? message.content :
        message?.content?.filter(part=>part.type==='text').map(part=>part.text).join('') ?? '';
    const model=scripted(context => {
        const user=context.messages.findLastIndex(message=>message.role==='user');
        const input=text(context.messages[user]);
        const replies=context.messages.slice(user+1).filter(message=>message.role==='toolResult');
        const reply=name=>{
            const value=replies.findLast(message=>message.toolName===name);
            if (value) {
                assert.equal(value.isError,false,text(value));
                return JSON.parse(text(value));
            }
        };
        if (input===cfg.initial) {
            initial=reply('conversation_assign');
            return initial ? {text:'The original governed task was delegated.'} :
                {tool:{name:'conversation_assign',arguments:{projectId:'P',operation:'change',instructions:'Consumer exports3',resultDependency:false}}};
        }
        assert.ok([cfg.diagnose,cfg.resume].includes(input),input);
        const instructions=context.systemPrompt ?? context.messages.filter(message=>message.role==='system')
            .map(message=>[message.content,...Object.values(message.sections??{})].join('\n')).join('\n');
        assert.match(instructions,/Use a current exact resume route only for the original assignment/u);
        const status=reply('conversation_status');
        if (!status) return {tool:{name:'conversation_status',arguments:{conversationId:initial.conversationId}}};
        const item=status.assignments.find(entry=>entry.assignmentId===initial.assignmentId);
        assert.equal(item.workId,oldWork.id);
        assert.equal(item.resultId,original.id);
        if (cfg.unverified) {
            assert.equal(status.recordedResult.state,'unavailable');
            assert.equal(status.originalRecovery?.kind,'current-result-unreadable');
            assert.equal(status.originalRecovery.assignmentId,initial.assignmentId);
            assert.equal(status.originalRecovery.workId,oldWork.id);
            assert.equal(item.resume,undefined);
            return {text:input===cfg.diagnose?cfg.diagnosed:cfg.finished};
        }
        assert.equal(status.recordedResult.temporalScope,'publication-only');
        assert.equal(status.recordedResult.snapshot.phase,'BLOCKED');
        if (cfg.held) {
            assert.equal(item.ownerAction?.kind,'planning-clarification');
            assert.equal(item.resume,undefined);
            assert.equal(item.reentry,undefined);
            return {text:input===cfg.diagnose?cfg.diagnosed:cfg.finished};
        }
        assert.equal(item.resume?.assignmentId,initial.assignmentId);
        assert.match(status.recordedResult.snapshot.recordedResult.blocked.join('\n'),/Unexpected or missing fields: unexpected/u);
        if (input===cfg.diagnose) return {text:cfg.diagnosed};
        const resumed=reply('conversation_resume_assignment');
        if (!resumed) return {tool:{name:'conversation_resume_assignment',arguments:item.resume}};
        assert.equal(resumed.accepted,true);
        assert.equal(resumed.assignmentId,initial.assignmentId);
        assert.equal(resumed.workId,oldWork.id);
        return {text:cfg.finished};
    },({role,result})=>{
        if (!role) return;
        calls.push(role);
        if (!cfg.held && role==='challenger' && calls.length===2) result.unexpected='Controlled initial failed producer';
        if (role==='adjudicator') {
            result.planAccepted=false;
            delete result.acceptedPlan;
            if (cfg.held) result.ownerDecisionRequired=[cfg.question];
        }
    });
    await c.queueConversationInput({conversationId:cid,expectedGeneration:0,text:cfg.initial,mode:'idle'});
    const landed=await c.runConversation({conversationId:cid,model});
    assert.equal(landed.status,'delivered',landed.failure);
    await c.ordinary.drain();
    const readAssignment=()=>s.one('SELECT * FROM conversation_assignments WHERE id=?',initial.assignmentId);
    const assignment=readAssignment();
    assert.equal(assignment.state,'UNAVAILABLE');
    original=s.one('SELECT * FROM conversation_results WHERE id=?',JSON.parse(assignment.data).resultId);
    if (cfg.unverified) {
        s.run("UPDATE conversation_results SET data=json_set(data,'$.publicationHash',?) WHERE id=?",'0'.repeat(64),original.id);
        original=s.one('SELECT * FROM conversation_results WHERE id=?',original.id);
    }
    oldWork=s.one('SELECT * FROM works WHERE id=?',assignment.work);
    const targetModel = c.getConversationModelChoice(assignment.target);
    const directions=()=>s.all('SELECT * FROM conversation_directions WHERE conversation=?',assignment.target);
    const usage=()=>s.all('SELECT * FROM budgets WHERE lineage=? ORDER BY kind',oldWork.lineage).map(row=>({...row}));
    const runs=()=>s.all('SELECT id,phase,reservation,data FROM runs WHERE work=? ORDER BY rowid',oldWork.id);
    oldDirections=directions();
    oldUsage=usage();
    assert.deepEqual(oldUsage.map(row=>row.kind),['execution','resolution']);
    const originalRuns=runs();
    await startConversationUI({controller:c,model,conversationId:cid});
    await c.ordinary.drain();
    assert.equal(s.one('SELECT count(*) n FROM conversation_assignments').n,1);
    assert.deepEqual(s.one('SELECT * FROM conversation_results WHERE id=?',original.id),original);
    assert.deepEqual(directions(),oldDirections);
    const settled=readAssignment();
    assert.equal(settled.work,oldWork.id);
    assert.equal(settled.target,assignment.target);
    assert.deepEqual(c.getConversationModelChoice(assignment.target),targetModel);
    assert.deepEqual(s.all("SELECT text FROM conversation_inputs WHERE conversation=? AND mode='idle' ORDER BY rowid",cid)
        .map(row=>row.text),[cfg.initial,cfg.diagnose,cfg.resume]);
    const record=JSON.parse(settled.data), reentry=record.reentries?.[0];
    if (cfg.held || cfg.unverified) {
        assert.equal(reentry,undefined);
        assert.equal(record.resultId,original.id);
        assert.deepEqual(runs(),originalRuns);
        assert.deepEqual(usage(),oldUsage);
        assert.deepEqual(calls,cfg.unverified?['planner','challenger']:['planner','challenger','adjudicator']);
    } else {
        assert.equal(record.reentries.length,1);
        assert.equal(reentry.resumeResultId,original.id);
        assert.notEqual(record.resultId,original.id);
        const input=s.one('SELECT * FROM conversation_inputs WHERE id=?',reentry.inputId);
        assert.equal(input.work,oldWork.id);
        assert.equal(input.state,'CONSUMED');
        assert.deepEqual(JSON.parse(input.text),{resumeResult:original.id});
        assert.deepEqual(calls,['planner','challenger','challenger','adjudicator']);
        assert.deepEqual(usage(),oldUsage.map(row=>({...row,consumed:row.consumed+2})));
        const latestRuns=runs();
        assert.equal(latestRuns.length,originalRuns.length+2);
        assert.deepEqual(latestRuns.slice(0,originalRuns.length),originalRuns);
    }
    assert.equal(c.inspectConversation(cid).draft.text,cfg.draft);
}
