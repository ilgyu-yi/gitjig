// Actual author tool writes and charged repair; deliberate scripted bad behavior is not standing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { openController } from '../../dist/controller/index.js';
import { scripted, withValueCases } from './effect-fixture.mjs';
import { changeResultText } from '../../dist/ui/change-result.js';
import { changeCommands } from '../../dist/ui/change-commands.js';
import { HostCommands } from '../../dist/ui/host-commands.js';
import { uiText } from '../../dist/ui/i18n.js';
import { workCommands } from '../../dist/ui/work-commands.js';

async function reviewScopeFromAnotherPane(controller, owner, workId, model) {
    const reader=controller.createConversation({projectId:'P'}).conversationId;
    let selected=reader;
    const choose=async(title,rows)=>{
        if (title.startsWith('Work recovery')) return rows.find(row=>row===uiText('en','change.scopeReplanAction'));
        if (title.startsWith('Scope replan review')) return rows.find(row=>row.startsWith('Open original conversation and review scope'));
        assert.equal(selected,owner);
        assert.match(title,/Review scope replan/);
        assert.ok(rows.includes('Replan this original work'));
        assert.equal(rows[0],'Back without changes');
        return rows[0];
    };
    const activate=async target=>{assert.equal(target,owner);selected=target;};
    const host={controller,isCurrent:target=>selected===target,choose,input:async()=>undefined,activate,notice(){},
        show:async (title,body,primary)=>{
            assert.equal(selected,owner);
            assert.match(title,/Review scope replan/);
            assert.match(body,/"scopeFailures"/);
            assert.equal(primary?.label,uiText('en','change.openReplanConfirmation'));
            await primary.run();
        },
        execute:(...args)=>commands.execute(...args)};
    const commands=new HostCommands([...changeCommands({...host,controls:{model,input:host.input,notice:host.notice,
        draft:()=>'',activateSource:activate,launch(){assert.fail('Back must never launch');}}}),...workCommands(host)]);
    assert.equal(await commands.execute('/work '+workId,reader),'cancelled');
    assert.equal(selected,owner);
}

const replan = process.env.GITJIG_SCOPE_REPLAN_CASE === '1';
const viaTerminal = process.env.GITJIG_SCOPE_REPLAN_VIA_UI === '1';
if (!replan) for (const viaUI of [false, true]) test('explicit scope replan uses a separate ' + (viaUI ? 'interactive terminal' : 'CLI owner'), { timeout: 95000 }, () => {
    const {NODE_TEST_CONTEXT: _workerContext,...environment}=process.env;
    const verified = spawnSync(process.execPath,['--test',fileURLToPath(import.meta.url)],{
        timeout:90000,encoding:'utf8',env:{...environment,GITJIG_SCOPE_REPLAN_CASE:'1',GITJIG_SCOPE_REPLAN_VIA_UI:viaUI?'1':'0'}
    });
    assert.equal(verified.status,0,verified.stdout+'\n'+verified.stderr);
    assert.match(verified.stdout,/RETAINED_SCOPE_REPEAT .* passed=true/u);
});
test(replan ? 'explicit replan corrects an erroneous scope and reaches checked independent review'
    : 'one automatic scope repair stops; explicit continuation can repair the same work', {
    timeout: 85000
}, async t => {
    const parent = process.env.GITJIG_RUNTIME_FIXTURE_ROOT;
    assert.ok(parent && path.isAbsolute(parent));
    assert.equal(await fs.realpath(parent), parent);
    const checkout=await fs.realpath('.');assert.ok(parent!==checkout&&!parent.startsWith(checkout+path.sep));
    assert.ok(process.env.GITJIG_DOCKER_BINARY&&process.env.GITJIG_DOCKER_CONTEXT&&process.env.GITJIG_DOCKER_CONFIG_DIRECTORY&&/^sha256:[a-f0-9]{64}$/.test(process.env.GITJIG_RUNTIME_IMAGE));
    const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'scope-repeat-'))), source = path.join(root, 'source'), home = path.join(root, 'home');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'consumer.cjs'), 'module.exports=2;\n');
    await fs.writeFile(path.join(source, 'check.cjs'), withValueCases("console.log(JSON.stringify({version:1,assertions:[{id:'three',passed:require('./consumer.cjs')===3}]}));\n"));
    process.env.TMPDIR = path.join(home, 'artifacts');
    const roles = [];
    const runtimeProfile = { dockerBinary: process.env.GITJIG_DOCKER_BINARY, dockerContext: process.env.GITJIG_DOCKER_CONTEXT,
        dockerConfigDirectory: process.env.GITJIG_DOCKER_CONFIG_DIRECTORY, image: process.env.GITJIG_RUNTIME_IMAGE };
    const modelFile=path.join(root,'model.json');
    const cliReplan=workId=>[fileURLToPath(new URL('../../dist/cli/main.js',import.meta.url)),
        'change','replan','--details','--home',home,'--work',workId,'--model-profile',modelFile,
        '--docker-binary',runtimeProfile.dockerBinary,'--docker-context',runtimeProfile.dockerContext,
        '--docker-config-directory',runtimeProfile.dockerConfigDirectory,'--image',runtimeProfile.image];
    let extra = false, corrected = false, correctionRequested = false, c, passed = false, allowReplan = false, changeChecker = false;
    let answerImpact='explanation', reviewedAnswer=false;
    const answer='Keep the original request. 변경 대상은 consumer.cjs입니다.';
    const additionalAnswer='Keep the existing check and review.';
    const model = scripted(undefined, ({ role, result, body }) => {
        roles.push(role);
        if (role === 'repairer') {
            const diagnostic = body.context.scopeDiagnostic;
            assert.match(diagnostic.evidenceId, /^[a-f0-9-]{36}$/u);
            assert.deepEqual(diagnostic.entries, replan ? [{path:'consumer.cjs',before:'file',after:'file',reason:'protected-changed'}]
                : [{path:'forbidden.txt',before:'absent',after:'file',reason:'outside-scope'}]);
            assert.equal(diagnostic.omitted, 0);
        }
        if (role === 'planner') {
            if (replan) {
                const scopeInput=body.context.scopeReplanOriginalPlan;
                if (scopeInput) {
                    result.plan=structuredClone(scopeInput);
                    const compound=result.plan.verification.strategies[0];
                    result.plan.verification.strategies[0]={requirementId:compound.requirementId,
                        ...compound.parts.find(part=>part.kind==='consumer-cases')};
                    if (changeChecker) result.plan.verification.checks[0].timeoutMs++;
                } else {
                    result.plan.verification.strategies=[{requirementId:'R1',kind:'all-of',parts:[
                        {kind:'consumer-cases',checkIds:['value']},
                        {kind:'manifest-scope-duty',allowedChangePaths:[],unchangedPaths:['consumer.cjs','check.cjs'],reviewKey:'general'},
                    ]}];
                }
                return;
            }
            result.plan.requirements.push({
                id: 'scope', text: 'Only consumer.cjs changes', source: result.plan.requirements[0].source
            });
            result.plan.verification.strategies = [
                {
                    requirementId: 'R1', kind: 'consumer-cases', checkIds: [
                        'value'
                    ]
                }, {
                    requirementId: 'scope', kind: 'manifest-scope-duty', allowedChangePaths: [
                        'consumer.cjs'
                    ], unchangedPaths: [
                        'check.cjs'
                    ], reviewKey: 'general'
                }
            ];
        }
        if (role === 'adjudicator' && body.context.scopeAmendment) {
            const {subjects}=body.context.scopeAmendment;
            assert.equal(subjects.length,1);
            result.planAccepted=allowReplan;
            if (!allowReplan) result.ownerDecisionRequired=['Confirm the intended file scope.'];
            if (allowReplan) result.scopeAmendments=[{evidenceId:subjects[0].evidenceId,action:'remove',
                reason:'The owner requires consumer.cjs to change and the retained behavioral check already verifies that requirement.'}];
            else delete result.acceptedPlan;
            const held=body.context.sourceInputChain.filter(input=>input.data.effectHold);
            if (held.length) {
                assert.deepEqual(held.map(input=>input.text),viaTerminal?[answer]:[answer,additionalAnswer]);
                assert.ok(held.every(input=>input.sourceOrigin==='owner-conversation-input'));
                assert.deepEqual(body.context.sourceFitReferences.inputs,held.map(input=>({inputId:input.input_id,directionRevision:input.revision})));
                result.inputDecisions=result.inputDecisions.map(decision=>({...decision,impact:answerImpact}));
                if (answerImpact==='explanation') reviewedAnswer=true;
            }
        }
    }), original = model.definition.streamSimple;
    model.definition.streamSimple = (m, context, options) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
            try {
                let message = await original(m, context, options).result();
                const first = context.messages.find(x => x.role === 'user'), text = first?.content.filter(x => x.type === 'text').map(x => x.text).join('') ?? '';
                if (!replan && text.startsWith('Perform the assigned implementer task') && message.stopReason === 'stop' && !extra) {
                    extra = true;
                    message = {
                        ...message, content: [
                            {
                                type: 'toolCall', id: 'forbidden-extra', name: 'write', arguments: {
                                    path: 'forbidden.txt', content: 'Actual disallowed author addition\n'
                                }
                            }
                        ], stopReason: 'toolUse'
                    };
                }
                if (text.startsWith('Perform the assigned repairer task') && message.stopReason === 'stop' && corrected && !correctionRequested) {
                    correctionRequested = true;
                    message = {...message,content:[{type:'toolCall',id:'remove-original-scope-violation',name:'bash',arguments:{command:'rm forbidden.txt'}}],stopReason:'toolUse'};
                }
                stream.push({
                    type: 'done', reason: message.stopReason, message
                });
                stream.end(message);
            }
            catch (error) {
                const failure = {
                    role: 'assistant', content: [], api: m.api, provider: m.provider, model: m.id, usage: {
                        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {
                            input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0
                        }
                    }, stopReason: 'error', errorMessage: String(error), timestamp: Date.now()
                };
                stream.push({
                    type: 'error', reason: 'error', error: failure
                });
                stream.end(failure);
            }
        })();
        return stream;
    };
    try {
        c = await openController({ installationHome: home, runtimeProfile });
        await c.registerProject({
            id: 'P', sourceRoot: source
        });
        const entry = {
            projectId: 'P', request: replan?'Update consumer.cjs to export3 and verify it with the existing check.'
                :'Export3; only consumer.cjs changes', executionLimit: 24, resolutionLimit: 12
        };
        const owner = viaTerminal ? c.createConversation({projectId:'P'}) : undefined;
        const firstScopeFailure = replan && !owner;
        const held = owner ? await c.startConversationChange({...entry, conversationId:owner.conversationId,
            expectedGeneration:owner.generation,expectedModelRevision:c.getConversationModelChoice(owner.conversationId).revision,model,signal:t.signal}) :
            await c.driveChange({workId:(await c.beginChange(entry)).workId,model,signal:t.signal,...(firstScopeFailure ? {maximumSteps:3} : {})});
        const begun = {workId:held.workId};
        assert.equal(held.phase, firstScopeFailure ? 'REPAIR_REQUIRED' : 'BLOCKED', JSON.stringify(held.blocked));
        assert.match(held.blocked.join(), firstScopeFailure ? /Complete current manifest violates/ : /Unchanged candidate repeats/);
        if (replan) {
            const scope=c.inspectChangeResult(begun.workId).scopeFailure, originalObligation=c.store.one(
                "SELECT * FROM obligations WHERE work=? AND json_extract(data,'$.kind')='verification-scope'",begun.workId);
            const evidence=c.store.one('SELECT * FROM change_versions WHERE id=?',scope.evidenceId);
            assert.deepEqual(scope.unchangedPaths.entries,['consumer.cjs','check.cjs']);
            allowReplan=true;
            changeChecker=true;
            const invalid=await c.planChange({workId:begun.workId,model,signal:t.signal});
            assert.match(invalid.blocked.join(),/must keep original requirements, checks, review and all other verification duties/);
            assert.equal(invalid.planVersion,held.planVersion);
            assert.equal(invalid.verificationVersion,held.verificationVersion);
            assert.deepEqual(c.store.one('SELECT * FROM obligations WHERE id=?',originalObligation.id),originalObligation);
            changeChecker=false;
            allowReplan=false;
            const declined=await c.planChange({workId:begun.workId,model,signal:t.signal});
            assert.equal(declined.phase,held.phase,JSON.stringify(declined.blocked));
            assert.equal(declined.planVersion,held.planVersion);
            assert.equal(declined.candidateVersion,held.candidateVersion);
            assert.equal(declined.execution.consumed,invalid.execution.consumed+3);
            assert.deepEqual(declined.planningClarification?.questions.entries,['Confirm the intended file scope.']);
            assert.notEqual(c.changeCore.inspectAssignmentOwnerAction(held.workId,false)?.kind,'planning-clarification');
            assert.deepEqual(c.store.one('SELECT * FROM obligations WHERE id=?',originalObligation.id),originalObligation);
            assert.deepEqual(c.inspectChangeModelPrerequisites(begun.workId),{stage:'repair',roles:['repairer']});
            allowReplan=true;
            const draft='Keep the original terminal draft';
            const replyDraft=answer;
            const replyTarget=declined.planningClarification?.reply?.conversationId;
            const expectedInputs=c.store.one('SELECT count(*) AS n FROM conversation_inputs').n;
            const expectedRuns=c.store.one('SELECT count(*) AS n FROM runs WHERE work=?',held.workId).n;
            if (owner) {
                assert.equal(c.inspectWorkRecovery(held.workId).sourceConversationId,owner.conversationId);
                await reviewScopeFromAnotherPane(c,owner.conversationId,held.workId,model);
                const view=c.inspectConversation(owner.conversationId);
                const reviewed=c.inspectScopeReplan(held.workId);
                assert.notEqual(reviewed.fingerprint,'0'.repeat(64));
                await assert.rejects(c.resumeConversationChange({conversationId:owner.conversationId,
                    expectedGeneration:view.generation,expectedModelRevision:c.getConversationModelChoice(owner.conversationId).revision,
                    workId:held.workId,expectedEpoch:held.epoch,expectedScopeReplan:'0'.repeat(64),model,signal:t.signal}),/scope replan changed/iu);
                const originalRole=c.changeCore.role;
                const otherRuntime={...runtimeProfile,image:'sha256:'+'0'.repeat(64)};
                const checkpoint=()=>c.store.one('SELECT * FROM change_state WHERE work=?',held.workId);
                const originalCheckpoint=checkpoint();
                c.changeCore.role=async function (...args) {
                    await c.applyRuntimeProfile(otherRuntime);
                    return originalRole.apply(this,args);
                };
                try {
                    await assert.rejects(c.resumeConversationChange({conversationId:owner.conversationId,
                        expectedGeneration:view.generation,expectedModelRevision:c.getConversationModelChoice(owner.conversationId).revision,
                        workId:held.workId,expectedEpoch:held.epoch,expectedScopeReplan:reviewed.fingerprint,model,signal:t.signal}),
                    {code:'MANAGED_REVIEW_CHANGED',workId:held.workId});
                    assert.deepEqual(checkpoint(),originalCheckpoint);
                    assert.equal(c.store.one('SELECT count(*) AS n FROM runs WHERE work=?',held.workId).n,expectedRuns);
                    assert.deepEqual(c.inspectChange(held.workId).resolution,declined.resolution);
                } finally {
                    c.changeCore.role=originalRole;
                    await c.applyRuntimeProfile(runtimeProfile);
                }
                assert.deepEqual(c.inspectChange(held.workId).execution,declined.execution);
                c.setConversationLanguage({conversationId:owner.conversationId,expectedGeneration:view.generation,expectedRevision:0,replyLanguage:'en'});
                c.setDraft({conversationId:owner.conversationId,expectedRevision:view.draft.revision,text:draft});
                const reply=c.inspectConversation(replyTarget);
                c.setDraft({conversationId:replyTarget,expectedRevision:reply.draft.revision,text:replyDraft});
            } else {
                let previousReview;
                for (const text of [answer,additionalAnswer]) {
                    const reply=c.inspectConversation(replyTarget);
                    const receipt=await c.queueConversationInputWithContext({conversationId:replyTarget,
                        expectedGeneration:reply.generation,text,mode:'idle'});
                    const input=c.inspectConversationInputs(replyTarget).find(item=>item.inputId===receipt.inputId);
                    c.recoverConversationInput({conversationId:replyTarget,inputId:receipt.inputId,expectedContext:input.fingerprint,action:'withdraw'});
                    previousReview??=c.inspectScopeReplan(held.workId);
                }
                const before=c.inspectChange(held.workId);
                await assert.rejects(c.changeCore.plan({workId:held.workId,model,signal:t.signal},true,previousReview.fingerprint),/scope replan changed/iu);
                assert.deepEqual(c.inspectChange(held.workId).execution,before.execution);
                answerImpact='scope-change';
                const refused=await c.planChange({workId:held.workId,model,signal:t.signal});
                assert.match(refused.blocked.join(),/cannot adopt a change to the original requirements/);
                assert.equal(refused.planVersion,held.planVersion);
                assert.deepEqual(c.store.one('SELECT * FROM obligations WHERE id=?',originalObligation.id),originalObligation);
                assert.deepEqual(c.inspectScopeReplan(held.workId).heldDirections.map(input=>input.text),[answer,additionalAnswer]);
                answerImpact='explanation';
            }
            await c.close();
            const wireRoles=[];
            const server=http.createServer(async(req,res)=>{
                try{
                    const chunks=[];let bytes=0;
                    for await(const chunk of req){bytes+=chunk.length;if(bytes>3*1024*1024)throw Error('Controlled request exceeds limit');chunks.push(chunk);}
                    const user=JSON.parse(Buffer.concat(chunks)).messages.find(message=>message.role==='user');
                    const text=typeof user.content==='string'?user.content:user.content.filter(part=>part.type==='text').map(part=>part.text).join('');
                    wireRoles.push(text.match(/assigned (\w+) task/u)[1]);
                    const response=await model.definition.streamSimple({api:model.definition.api,provider:model.provider,id:model.modelId},
                        {messages:[{role:'user',content:[{type:'text',text}]}]}).result();
                    const part=response.content[0];
                    assert.ok(part.type==='toolCall' || part.type==='text');
                    const delta=part.type==='toolCall'
                        ? {role:'assistant',tool_calls:[{index:0,id:part.id,type:'function',function:{name:part.name,arguments:JSON.stringify(part.arguments)}}]}
                        : {role:'assistant',content:part.text};
                    const chunk=(delta,finish_reason=null)=>({id:'scope-replan-fixture',object:'chat.completion.chunk',created:1,model:'fixture',
                        choices:[{index:0,delta,finish_reason}]});
                    res.writeHead(200,{'Content-Type':'text/event-stream'});
                    res.end('data: '+JSON.stringify(chunk(delta))+'\n\n'+
                        'data: '+JSON.stringify(chunk({},part.type==='toolCall'?'tool_calls':'stop'))+'\n\ndata: [DONE]\n\n');
                }catch(error){res.destroy(error);}
            });
            await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
            let planned;
            try {
                await fs.writeFile(modelFile,JSON.stringify({provider:'scope-replan-fixture',modelId:'fixture',definition:{
                    api:'openai-completions',apiKey:'UNUSED_SCOPE_FIXTURE',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:model.definition.models
                }}),{mode:0o600});
                if (owner) {
                    const checks=[
                        {sql:'SELECT phase FROM change_state WHERE work=?',params:[held.workId],rows:[['BLOCKED']]},
                        {sql:'SELECT count(*) FROM runs WHERE work=?',params:[held.workId],rows:[[expectedRuns]]},
                        {sql:'SELECT kind,consumed,reserved FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',
                            params:[held.workId],rows:[['execution',declined.execution.consumed,declined.execution.reserved],
                                ['resolution',declined.resolution.consumed,declined.resolution.reserved]]},
                    ];
                    const runTerminal=async(name,steps)=>{
                        const file=path.join(root,name+'.json');
                        await fs.writeFile(file,JSON.stringify({command:[process.execPath,fileURLToPath(new URL('../../dist/cli/entry.js',import.meta.url)),
                            'conversation','ui','--home',home,'--conversation',owner.conversationId,'--model-profile',modelFile,
                            '--docker-binary',runtimeProfile.dockerBinary,'--docker-context',runtimeProfile.dockerContext,
                            '--docker-config-directory',runtimeProfile.dockerConfigDirectory,'--image',runtimeProfile.image],
                            cwd:root,env:{...process.env,HOME:root,GITJIG_HOME:home,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
                            steps,timeoutSeconds:28,gracefulShutdownSeconds:3,noForceKill:true,expectedInputs,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
                        const {stdout}=await promisify(execFile)('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:34000});
                        const terminal=JSON.parse(stdout);
                        assert.equal(terminal.exitCode,0);
                        assert.equal(terminal.stages,steps.length);
                        assert.equal(terminal.terminalRestored,true);
                    };
                    const replanChoice=uiText('en','change.scopeReplanAction');
                    const ownerHandoff=uiText('en','change.scopeReplanOpenOrigin',{conversation:''}).trimEnd();
                    const workMenu=uiText('en','workRecovery.title',{id:held.workId,state:'ACTIVE'});
                    const replyState={assertDraft:'',expectedSelected:replyTarget,expectedInputs:expectedInputs+1,queries:checks};
                    const ownerState={assertDraft:draft,expectedSelected:owner.conversationId,expectedInputs:expectedInputs+4};
                    const retainedOwnerDraft={sql:'SELECT selected,draft FROM interaction_view JOIN conversation_views ON conversation=selected',
                        rows:[[owner.conversationId,draft]]};
                    const acceptedChecks=[
                        {sql:'SELECT phase,candidate FROM change_state WHERE work=?',params:[held.workId],rows:[['PLAN_READY',held.candidateVersion]]},
                        {sql:'SELECT count(*) FROM runs WHERE work=?',params:[held.workId],rows:[[expectedRuns+3]]},
                        {sql:'SELECT kind,consumed,reserved FROM budgets WHERE lineage=(SELECT lineage FROM works WHERE id=?) ORDER BY kind',
                            params:[held.workId],rows:[['execution',declined.execution.consumed+3,0],['resolution',declined.resolution.consumed+2,0]]},
                    ];
                    const resumeChoice=uiText('en','result.reviewResume');
                    const resumeFromResult=[
                        {wait:uiText('en','result.next'),...ownerState,queries:acceptedChecks,send:'\r'},
                        {wait:uiText('en','result.nextTitle'),...ownerState,queries:acceptedChecks,send:resumeChoice+'\r'},
                        {wait:'Open resume confirmation',...ownerState,queries:acceptedChecks,send:'\r'},
                    ];
                    await runTerminal('scope-reply-to-replan-terminal',[
                        {wait:draft,assertDraft:draft,send:'\x07r'},
                        {wait:'Independent planning requested an owner decision',send:'\r'},
                        {wait:uiText('en','result.nextTitle'),send:uiText('en','result.planningClarificationReply')+'\r'},
                        {wait:'Send your answer as task feedback',assertDraft:replyDraft,expectedSelected:replyTarget,queries:checks,send:'\r'},
                        {wait:uiText('en','input.recoveryOpenActions'),assertDraft:'',expectedInputs:expectedInputs+1,send:'\r'},
                        {wait:uiText('en','input.feedbackTitle'),send:uiText('en','input.keepFeedback')+'\r'},
                        {wait:replanChoice,...replyState,send:replanChoice+'\r'},
                        {wait:ownerHandoff,...replyState,send:'\r'},
                        {wait:workMenu,...replyState,send:replanChoice+'\r'},
                        {wait:ownerHandoff,...replyState,send:'Open original conversation and review scope\r'},
                        {wait:uiText('en','change.openReplanConfirmation'),assertDraft:draft,expectedSelected:owner.conversationId,expectedInputs:expectedInputs+1,queries:checks,send:'\r'},
                        {wait:'Back without changes',send:'\r'},
                        {wait:draft,assertDraft:draft,expectedInputs:expectedInputs+1,queries:checks,send:'\x07r'},
                        {wait:'Failed file scope',send:'\r'},
                        {wait:uiText('en','result.nextTitle'),send:replanChoice+'\r'},
                        {wait:uiText('en','change.openReplanConfirmation'),assertDraft:draft,expectedSelected:owner.conversationId,expectedInputs:expectedInputs+1,queries:checks,send:'\r'},
                        {wait:'Replan this original work',send:'Replan this original work\r'},
                        {wait:'Plan accepted',...ownerState,queries:acceptedChecks,send:'\x07r'},
                        ...resumeFromResult,
                        {wait:'Resume this original work',...ownerState,queries:acceptedChecks,send:'\r'},
                        {wait:uiText('en','result.openActions'),...ownerState,queries:acceptedChecks,send:'\r'},
                        ...resumeFromResult.slice(1),
                        {wait:'Resume this original work',...ownerState,queries:acceptedChecks,send:'Resume this original work\r'},
                        {wait:'Review-ready result recorded',queries:[retainedOwnerDraft],send:'\x07r'},
                        {wait:uiText('en','result.ready'),queries:[retainedOwnerDraft],send:'\x1b'},
                        {wait:draft,queries:[retainedOwnerDraft],send:'\x07q'},
                    ]);
                } else {
                    const response=await promisify(execFile)(process.execPath,cliReplan(begun.workId),{timeout:20000,maxBuffer:4*1024*1024});
                    planned=JSON.parse(response.stdout);
                }
            } finally {
                server.closeAllConnections();
                await new Promise(resolve=>server.close(resolve));
            }
            assert.deepEqual(wireRoles.slice(0,3),['planner','challenger','adjudicator']);
            if(owner)assert.equal(wireRoles.filter(role=>role==='reviewer').length,1);
            else assert.equal(wireRoles.length,3);
            assert.equal(reviewedAnswer,true);
            c=await openController({installationHome:home,runtimeProfile});
            if (owner) {
                planned=c.inspectChange(held.workId);
                assert.equal(c.inspectConversation(owner.conversationId).draft.text,draft);
                assert.equal(c.inspectConversation(replyTarget).draft.text,'');
            }
            if(!owner)assert.equal(planned.phase,'PLAN_READY',JSON.stringify(planned.blocked));
            assert.equal(planned.workId,held.workId);
            if(!owner)assert.equal(planned.candidateVersion,held.candidateVersion);
            assert.notEqual(planned.planVersion,held.planVersion);
            const directions=c.interactionCore.impacts(held.workId).filter(input=>input.text===answer || input.text===additionalAnswer);
            assert.equal(directions.length,owner?1:2);
            assert.ok(directions.every(input=>!input.data.effectHold && input.data.decision.impact==='explanation'));
            const plan=JSON.parse(c.store.one('SELECT data FROM change_versions WHERE id=?',planned.planVersion).data);
            assert.deepEqual(plan.scopeTransition.amendments[0].originalDuty,{...originalObligation});
            assert.equal(plan.scopeTransition.amendments[0].decision.action,'remove');
            assert.equal(c.changeCore.pending(begun.workId).some(o=>o.kind==='verification-scope'),false);
            const ready=owner?planned:await c.driveChange({workId:begun.workId,model,signal:t.signal});
            assert.equal(ready.reviewReady,true,JSON.stringify(ready.blocked));
            assert.ok(ready.checks.some(check=>check.status==='pass'&&check.verification===planned.verificationVersion));
            assert.ok(ready.launches.some(launch=>launch.role==='reviewer'&&launch.status==='COMPLETE'));
            assert.deepEqual(c.store.one('SELECT * FROM change_versions WHERE id=?',evidence.id),evidence);
            assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');
            passed=true;
            return;
        }
        assert.match(held.blocked.join(), /"forbidden\.txt" \(absent → file\) is outside the accepted change scope/u);
        assert.equal(c.store.one("SELECT count(*) AS n FROM role_launches WHERE work=? AND role='repairer'", begun.workId).n, 1);
        assert.equal(c.store.one('SELECT count(*) AS n FROM check_runs WHERE work=?', begun.workId).n, 0);
        assert.ok(c.changeCore.pending(begun.workId).some(o => o.kind === 'verification-scope'));
        const before = held.execution.consumed, launches = c.store.all('SELECT * FROM role_launches WHERE work=?', begun.workId), failedScope=c.store.all("SELECT * FROM change_versions WHERE work=? AND kind='scope-evidence' ORDER BY rowid",begun.workId);
        assert.deepEqual(c.inspectChangeModelPrerequisites(begun.workId),{stage:'repair',roles:['repairer']});
        assert.match(c.inspectChange(begun.workId).nextAction,/charged repair/);
        const result=c.inspectChangeResult(begun.workId), scope=result.scopeFailure;
        assert.equal(scope.evidenceId,failedScope.at(-1).id);
        assert.equal(scope.requirementId,'scope');
        assert.deepEqual(scope.allowedChangePaths.entries,['consumer.cjs']);
        assert.deepEqual(scope.unchangedPaths.entries,['check.cjs']);
        assert.match(changeResultText(result,'en'),/gitjig change replan --work/);
        assert.match(changeResultText(result,'ko'),/독립 재검토를 요청하세요/);
        const pane=c.createConversation({projectId:'P'}).conversationId;
        let inspection;
        const commands=new HostCommands(changeCommands({controller:c,isCurrent:()=>true,locale:()=> 'ko',
            choose:async()=>assert.fail('Exact inspection needs no selection'),show:async(_title,text)=>{inspection=text;}}));
        await commands.execute('/change inspect '+begun.workId,pane);
        assert.match(inspection,/그대로 유지해야 하는 경로\n"check\.cjs"/u);
        const retained=()=>Object.fromEntries(['works','change_state','role_launches','runs','change_versions','obligations','budgets'].map(table=>[table,c.store.all('SELECT * FROM '+table+' ORDER BY rowid')]));
        const checkpoint=retained();
        await assert.rejects(c.changeCore.plan({workId:begun.workId,model,signal:t.signal}),/requires an explicit scope replan/);
        assert.deepEqual(retained(),checkpoint,'Implicit planning preserves the original repair checkpoint and every retained row');
        const duty=c.store.one("SELECT * FROM obligations WHERE work=? AND json_extract(data,'$.kind')='verification-scope'",begun.workId);
        c.store.run("UPDATE obligations SET data=json_set(data,'$.evidenceId','missing') WHERE id=?",duty.id);
        const drifted=retained();
        // Exercise the original CLI by releasing this fixture's owner before its cold admission.
        await fs.writeFile(modelFile,JSON.stringify({provider:'scope-inspection-fixture',modelId:'fixture',definition:{
            api:'openai-completions',apiKey:'UNUSED_SCOPE_FIXTURE',baseUrl:'http://127.0.0.1:9/v1',models:model.definition.models
        }}),{mode:0o600});
        await c.close();
        const response=spawnSync(process.execPath,cliReplan(begun.workId),{encoding:'utf8',timeout:10000});
        assert.equal(response.status,2,response.stderr);
        assert.match(JSON.parse(response.stderr).message,/Original failed scope evidence is unavailable for replan/);
        c=await openController({installationHome:home,runtimeProfile});
        assert.deepEqual(retained(),drifted,'Cold terminal replan refuses changed evidence without reclassifying it');
        c.store.run('UPDATE obligations SET data=? WHERE id=?',duty.data,duty.id);
        // Old versions could rewrite just the checkpoint on a refused replan.
        c.store.run("UPDATE change_state SET data=json_set(data,'$.resumeStage','plan','$.blocked',json(?)) WHERE work=?",
            JSON.stringify(['Error: Unsupported planning hold remains unresolved']),begun.workId);
        assert.deepEqual(c.inspectChangeResult(begun.workId).scopeFailure,scope);
        assert.deepEqual(c.inspectChangeModelPrerequisites(begun.workId),{stage:'repair',roles:['repairer']});
        assert.equal(c.inspectChange(begun.workId).execution.consumed,before);
        assert.deepEqual(c.store.all('SELECT * FROM role_launches WHERE work=?',begun.workId),launches,'Read-only recovery guidance creates no author');
        corrected=true;
        const again = await c.driveChange({workId:begun.workId,model,maximumSteps:1,signal:t.signal});
        assert.equal(again.phase, 'CANDIDATE_CAPTURED',JSON.stringify(again.blocked));
        assert.equal(correctionRequested,true);assert.notEqual(again.candidateVersion,held.candidateVersion);
        assert.equal(again.execution.consumed, before+1);assert.equal(again.execution.limit,held.execution.limit);assert.equal(again.resolution.limit,held.resolution.limit);
        assert.equal(c.store.one("SELECT count(*) n FROM role_launches WHERE work=? AND role='repairer'",begun.workId).n,2);
        for(const row of failedScope)assert.deepEqual(c.store.one('SELECT * FROM change_versions WHERE id=?',row.id),row,'Original failed evidence is immutable');
        const checked=await c.checkChange({workId:begun.workId,signal:t.signal});assert.equal(checked.phase,'CHECKED',JSON.stringify(checked.blocked));assert.equal(checked.checks.at(-1).status,'pass');assert.equal(checked.reviewReady,false,'Actual check and scope repair do not replace fresh independent review');
        assert.equal(await fs.readFile(path.join(source,'consumer.cjs'),'utf8'),'module.exports=2;\n');assert.deepEqual(await fs.readdir(source),['check.cjs','consumer.cjs']);
        assert.equal(again.execution.reserved, 0);
        assert.equal(again.resolution.reserved, 0);
        await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify({
            root, workId: begun.workId, held, again, checked, roles, scope: 'Actual SDK/engine author and charged repair; scripted judgments only'
        }, null, 2), {
            flag: 'wx', mode: 0o600
        });
        passed = true;
    }
    finally {
        await c?.close();
        console.log('RETAINED_SCOPE_REPEAT ' + root + ' passed=' + passed);
    }
});
