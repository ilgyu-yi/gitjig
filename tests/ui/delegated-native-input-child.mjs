import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

const cfg = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
process.env.TMPDIR = path.join(cfg.home, 'artifacts');
const project = path.join(cfg.root, 'project');
const shim = path.join(cfg.root, 'scope.mjs');
await fs.mkdir(project);
await fs.writeFile(path.join(project, 'source.txt'), 'Controlled original source\n');
await fs.writeFile(shim, 'export const createScope = options => globalThis.__delegatedInputScope(options); export class RuntimeHelperUnavailableError extends Error {}');
registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/controller/ordinary.js') && specifier.endsWith('/execution/container-scope.js'))
        return { url: pathToFileURL(shim).href, shortCircuit: true };
    return next(specifier, context);
} });
globalThis.__delegatedInputScope = async options => {
    const deny = () => assert.fail('Unexpected physical command or write');
    return { containerId: 'dialog-fixture', workspaceRoot: options.workRoot, closed: false,
        validatePath: file => path.resolve(options.workRoot, file), access: async () => {},
        readFile: file => fs.readFile(path.resolve(options.workRoot, file), 'utf8'), exec: deny, writeFile: deny, mkdir: deny,
        async close() { this.closed = true; return {state:'removed'}; } };
};

const { openController } = await import('../../dist/controller/index.js');
const { startConversationUI } = await import('../../dist/ui/index.js');
const { ApplicationModels } = await import('../../dist/app/models.js');
const c = await openController({installationHome:cfg.home,maxProviderRequests:10,
    runtimeProfile:{dockerBinary:process.execPath,dockerContext:'DIALOG_CONTROLLED',image:'sha256:'+'1'.repeat(64)},
    interactionDelegation:{projectIds:['P'],maxAssignments:cfg.nested ? 3 : 1}});
await c.registerProject({id:'P',sourceRoot:project});
const models = new ApplicationModels(c);
if (cfg.confirm !== 'enter') {
    await fs.mkdir(path.join(cfg.home, 'config'), { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(cfg.home, 'config', 'keybindings.json'),
        JSON.stringify({ 'tui.select.confirm': cfg.confirm }), { mode: 0o600 });
}
const parent = c.createConversation();
c.setConversationName({ conversationId: parent.conversationId, expectedGeneration: parent.generation, name: 'Assigning conversation' });
const unrelated = c.createConversation();
c.setConversationName({ conversationId: unrelated.conversationId, expectedGeneration: unrelated.generation, name: 'Unrelated conversation' });
c.setConversationLanguage({conversationId:parent.conversationId,expectedGeneration:parent.generation,expectedRevision:0,replyLanguage:cfg.locale});
c.setDraft({conversationId:parent.conversationId,expectedRevision:0,text:cfg.draft});
const waitForFile = async file => {
    const deadline = Date.now()+10000;
    while (!await fs.access(file).then(()=>true,()=>false)) {
        if (Date.now()>deadline) throw Error('Controlled terminal signal missing');
        await new Promise(resolve=>setTimeout(resolve,15));
    }
};
const usage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const abort = new AbortController();
let answer, dialogRun, openCount=0;
const model = { provider:'owned-dialog',modelId:'fixture',definition:{api:'owned-dialog-api',apiKey:'fixture-only',
    baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:32000,maxTokens:2000,cost:usage.cost}],
    streamSimple(selected, context) {
        const stream = createAssistantMessageEventStream();
        const finish = (tool, text) => {
            const message={role:'assistant',content:tool?[{type:'toolCall',id:randomUUID(),...tool}]:[{type:'text',text}],
                api:selected.api,provider:selected.provider,model:selected.id,usage,stopReason:tool?'toolUse':'stop',timestamp:Date.now()};
            stream.push({type:'done',reason:message.stopReason,message});stream.end(message);
        };
        const text = msg => typeof msg.content === 'string' ? msg.content :
            msg.content.filter(part => part.type === 'text').map(part => part.text).join('');
        const users = context.messages.filter(message => message.role === 'user').map(text);
        const child = users.some(message => message.includes('OWNED_DIALOG_LEAF'));
        const middle = users.some(message => message.includes('OWNED_DIALOG_MIDDLE'));
        const result = name => context.messages.find(message=>message.role==='toolResult' && message.toolName===name);
        void (async () => {
            if (child) {
                if (result('conversation_report')) return finish(undefined,'The original dialog ended.');
                const assignment = c.store.one(`SELECT id,target,work FROM conversation_assignments
                    WHERE source_conversation=CASE WHEN ? THEN
                        (SELECT target FROM conversation_assignments WHERE source_conversation=?) ELSE ? END`,
                    Number(cfg.nested), parent.conversationId, parent.conversationId);
                const registration=c.getNativeHandle(assignment.target);
                assert.ok(registration);
                c.setConversationName({conversationId:assignment.target,expectedGeneration:registration.identity.generation,name:'Original investigation'});
                const target = c.inspectConversation(assignment.target);
                c.setConversationParent({ childId: assignment.target, parentId: null, expectedRevision: target.relationRevision });
                const language = c.getConversationLanguage(assignment.target);
                c.setConversationLanguage({ conversationId: assignment.target, expectedGeneration: target.generation,
                    expectedRevision: language.revision, replyLanguage: cfg.locale });
                dialogRun=registration.identity.runId;
                openCount++;
                const ui=registration.session.extensionRunner.getUIContext();
                if (cfg.crash) {
                    await fs.writeFile(cfg.crashProof, JSON.stringify({parent:parent.conversationId, leaf:assignment.target,
                        work:assignment.work, run:dialogRun, assignment:assignment.id}));
                    void waitForFile(cfg.crash).then(() => process.kill(process.pid, 'SIGKILL'));
                }
                if (cfg.stale) void waitForFile(cfg.expire).then(()=>abort.abort()).catch(error=>stream.end(error));
                answer=await ui.confirm('Original delegated confirmation','Answer only in the original native dialog.',{signal:abort.signal});
                if (cfg.stale) await fs.writeFile(cfg.expired,'done');
                return finish({name:'conversation_report',arguments:{text:'The original owner confirmation ended. No external action was run.'}});
            }
            if (users.some(message => message.includes('Explicitly resumed authorized')))
                return finish(undefined,'Original investigation result received.');
            const assigned = result('conversation_assign');
            if (assigned) return finish({name:'conversation_wait',arguments:{resultHandles:[JSON.parse(text(assigned)).assignmentId]}});
            const instructions = cfg.nested && !middle
                ? 'OWNED_DIALOG_MIDDLE Delegate the investigation, then wait.'
                : 'OWNED_DIALOG_LEAF Request the original owner answer.';
            finish({name:'conversation_assign',arguments:{projectId:'P',operation:'investigate',instructions,resultDependency:true}});
        })().catch(error => {
            const message = {role:'assistant',content:[],api:selected.api,provider:selected.provider,model:selected.id,
                usage,stopReason:'error',errorMessage:String(error),timestamp:Date.now()};
            stream.push({type:'error',reason:'error',error:message});
            stream.end(message);
        });
        return stream;
    }}};
if (cfg.parentModelUnavailable) {
    await c.setConversationModelChoice({
        conversationId: parent.conversationId, expectedGeneration: parent.generation, expectedRevision: 0,
        choice: { kind: 'legacy-external', provider: model.provider, modelId: model.modelId },
    });
}
const run = (async()=>{
    await waitForFile(cfg.start);
    await c.queueConversationInput({conversationId:parent.conversationId,expectedGeneration:parent.generation,text:'Delegate the original investigation and wait.',mode:'idle'});
    const result = await c.runConversation({conversationId:parent.conversationId,model});
    assert.equal(result.status, 'waiting', result.failure);
    await c.ordinary.drain();
})();
try {
    await startConversationUI({ controller:c, model:cfg.parentModelUnavailable ? undefined : model, models,
        conversationId:parent.conversationId });
    await run;
    const assignment = c.store.one(`SELECT a.id,a.target,a.work FROM conversation_assignments a
        JOIN runs r ON r.work=a.work WHERE r.id=?`, dialogRun);
    assert.ok(assignment);
    assert.equal(c.inspectConversation(parent.conversationId).draft.text,cfg.draft);
    assert.equal(c.store.one('SELECT count(*) n FROM conversation_assignments').n,cfg.nested ? 2 : 1);
    assert.equal(c.store.one('SELECT count(*) n FROM runs WHERE work=?',assignment.work).n,1);
    assert.equal(c.store.one('SELECT count(*) n FROM conversation_inputs WHERE conversation=?',assignment.target).n,1);
    assert.equal(c.store.one('SELECT id FROM runs WHERE work=?',assignment.work).id,dialogRun);
    assert.equal(c.store.one('SELECT selected FROM interaction_view').selected,parent.conversationId);
    assert.equal(c.inspectConversation(assignment.target).inputNeeded,false);
    assert.equal(c.inspectConversation(assignment.target).parentId, null);
    await fs.writeFile(cfg.receipt,JSON.stringify({answer,openCount}));
} finally { abort.abort();await c.close(); }
