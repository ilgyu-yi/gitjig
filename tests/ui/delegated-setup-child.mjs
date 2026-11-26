import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {failedWaitWorld} from '../controller/original-failed-wait-fixture.mjs';
import {seedLocalRoleRequestLimit} from '../controller/planning-failure-fixture.mjs';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {openController} from '../../dist/controller/index.js';
import {startConversationUI} from '../../dist/ui/index.js';

const config = JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const {root,kind,locale,runtime,provider,draft,receipt} = config;
globalThis.fetch=()=>assert.fail('Unexpected network');
ApplicationAccounts.prototype.login=()=>assert.fail('Unexpected authentication');

if (process.argv[3] === 'prepare') test('produce an original blocked assignment', async t => {
    let baseline, blocker;
    const fixture = await failedWaitWorld(t, {originalGovernedDispatch:true, fixtureRoot:root, automatic:false,
        ...(kind==='account'?{runtimeProfile:runtime,waitForResult:false,resultDependency:false}:{}),
        async beforeAssignment({c}) {
            if (kind!=='account') return;
            const accounts = ApplicationAccounts.open(c), models = new ApplicationModels(c);
            await accounts.configure({providers:{[provider]:{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
            baseline = await models.baseline('P',await models.choice(provider,'fixture'));
            blocker = c.createConversation().conversationId;
        },
        prepareResult(c,child) {
            seedLocalRoleRequestLimit(c,child.workId,'challenger',randomUUID());
            if (baseline) c.store.run("UPDATE works SET data=json_set(data,'$.applicationModelBaseline',json(?)) WHERE id=?",
                JSON.stringify(baseline),child.workId);
        },
    });
    await fixture.settle();
    const {c,home,parent}=fixture;
    if (blocker) {
        await c.queueConversationInput({conversationId:blocker,expectedGeneration:0,text:'Unsent earlier request blocking account setup',mode:'idle'});
        assert.equal(c.inspectApplicationMutationBlocker()?.conversationId,blocker);
    }
    const source = c.inspectConversation(parent);
    c.setConversationLanguage({conversationId:parent,expectedGeneration:source.generation,expectedRevision:0,replyLanguage:locale});
    c.setDraft({conversationId:parent,expectedRevision:source.draft.revision,text:draft});
    if (kind!=='account') await ApplicationStartup.open(c).save({version:1,runtime});
    const stop=c.inspectRecordedDelegatedResults(parent).entries[0];
    const tables=['works','runs','conversation_assignments','conversation_results','conversation_inputs','budgets'];
    const stable=tables.map(table=>{
        const sql='SELECT * FROM '+table+' ORDER BY rowid';
        return {sql,rows:c.store.all(sql).map(Object.values)};
    });
    const inputs=c.store.one('SELECT count(*) n FROM conversation_inputs').n;
    await fs.writeFile(receipt,JSON.stringify({parent,home,stop,stable,inputs,blocker}));
    fixture.pass();
});
else {
    const {parent,home} = JSON.parse(await fs.readFile(receipt,'utf8'));
    process.env.TMPDIR=path.join(home,'artifacts');
    const c=await openController({installationHome:home,...kind==='account'?{runtimeProfile:runtime}:{}});
    try {
        await startConversationUI({controller:c,models:new ApplicationModels(c),conversationId:parent});
        assert.equal(c.options.runtimeProfile?.dockerContext,['runtime','account'].includes(kind)?runtime.dockerContext:undefined);
    } finally {await c.close();}
}
