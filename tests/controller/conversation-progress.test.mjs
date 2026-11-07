import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../../dist/controller/store.js';
import {inspectConversationProgress} from '../../dist/controller/conversation-progress.js';

test('preparation follows only the current ordinary run and its own original input', async () => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-progress-')),store=new Store(path.join(root,'state.sqlite'));
    try {
        store.run("INSERT INTO sources VALUES('S',NULL,'{}','request')");
        store.run("INSERT INTO works VALUES('W',NULL,'S',NULL,'W','ACTIVE',3,5,NULL,'{}')");
        store.run("INSERT INTO conversations VALUES('C',NULL,NULL,7,'{}')");
        store.run("INSERT INTO conversation_state(conversation,work,resource,data) VALUES('C','W','QUEUED',?)",JSON.stringify({runId:'R'}));
        store.run("INSERT INTO conversation_inputs VALUES('I','C',7,'W','S','INITIAL_RESERVED','idle','request','{}')");
        const data={kind:'ordinary-conversation',conversation:'C',initialInputId:'I'};
        store.run("INSERT INTO runs VALUES('R','W',3,5,'CREATED',?,'reserved',?)",root,JSON.stringify(data));
        for(const [phase,extra,stage]of [['CREATED',{},'capacity'],['WAITING_CAPACITY',{},'capacity'],['CAPTURING',{},'capture'],['CAPTURED',{},'runtime'],['RUNTIME_CREATING',{},'runtime'],['RUNNING',{},'session'],['RUNNING',{nativePromptAttempted:true},'dispatch'],['RUNNING',{modelDispatchAttempted:true},'model']]) {
            store.run('UPDATE runs SET phase=?,data=?',phase,JSON.stringify({...data,...extra}));
            assert.deepEqual(inspectConversationProgress(store,'C'),{runId:'R',initialInputId:'I',stage});
        }
        for(const extra of [{manualAction:'compact'},{kind:'check'},{conversation:'another'},{initialInputId:'missing'}]) {
            store.run('UPDATE runs SET data=?',JSON.stringify({...data,...extra}));
            assert.equal(inspectConversationProgress(store,'C'),undefined);
        }
        store.run('UPDATE runs SET data=?',JSON.stringify(data));
        for(const [sql,undo]of [
            ["UPDATE runs SET epoch=2","UPDATE runs SET epoch=3"],
            ["UPDATE runs SET generation=4","UPDATE runs SET generation=5"],
            ["UPDATE conversation_inputs SET generation=6","UPDATE conversation_inputs SET generation=7"],
            ["UPDATE conversation_inputs SET mode='manual'","UPDATE conversation_inputs SET mode='idle'"],
            ["UPDATE works SET state='UNKNOWN'","UPDATE works SET state='ACTIVE'"],
            ["UPDATE conversation_state SET resource='SETTLING'","UPDATE conversation_state SET resource='RUNNING'"],
            ["UPDATE conversation_state SET data='{}'","UPDATE conversation_state SET data='{"+'"runId":"R"'+"}'"],
        ]) {store.run(sql);assert.equal(inspectConversationProgress(store,'C'),undefined,sql);store.run(undo);}
    } finally {store.close();await fs.rm(root,{recursive:true,force:true});}
});

test('actual ordinary capture publishes its progress before capture and runtime creation, without a provider or Docker call', async () => {
    const {openController}=await import('../../dist/controller/index.js');
    const {ApplicationAccounts}=await import('../../dist/app/accounts.js');
    const {ApplicationModels}=await import('../../dist/app/models.js');
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-progress-boundary-'))),source=path.join(root,'source');
    await fs.mkdir(source);await fs.writeFile(path.join(source,'source.txt'),'captured original');
    const c=await openController({installationHome:path.join(root,'home'),runtimeProfile:{dockerBinary:'/usr/bin/false',dockerContext:'NEVER_EXECUTE',image:'sha256:'+'0'.repeat(64)}});
    try {
        await c.registerProject({id:'P',sourceRoot:source});
        const accounts=ApplicationAccounts.open(c),models=new ApplicationModels(c);
        await accounts.configure({providers:{'progress-fixture':{api:'openai-completions',baseUrl:'http://127.0.0.1:9/v1',apiKey:'UNUSED',models:[{id:'fixture'}]}}});
        await accounts.setDefault('progress-fixture','fixture');models.install();
        const view=await models.newConversation({projectId:'P'}),cid=view.conversationId;
        const receipt=await c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:view.generation,text:'Show preparation',mode:'idle'});
        const h=c.ordinary.h,patch=h.patchRun,observed=[];
        h.patchRun=(runId,phase,data)=>{
            patch(runId,phase,data);
            if(['CAPTURING','RUNTIME_CREATING'].includes(phase)) {
                observed.push(c.inspectConversationProgress(cid));
                if(phase==='RUNTIME_CREATING')throw Error('OWNED_STOP_BEFORE_RUNTIME');
            }
        };
        const result=await c.runConversation({conversationId:cid,...models.conversationOperation(cid)});
        assert.equal(result.status,'unavailable');
        assert.deepEqual(observed.map(value=>[value.initialInputId,value.stage]),[[receipt.inputId,'capture'],[receipt.inputId,'runtime']]);
        const run=c.store.one('SELECT * FROM runs');
        assert.equal(JSON.parse(run.data).attainedCapture,true);
        assert.equal(JSON.parse(run.data).nativePromptAttempted,undefined);
        assert.equal(c.inspectConversationProgress(cid),undefined);
        // An old failed reservation must not stand in for the current request.
        for (const [id,state] of [['old','INITIAL_RESERVED'],['first','QUEUED'],['second','QUEUED'],['third','QUEUED']]) {
            c.store.run('INSERT INTO sources VALUES(?,?,?,?)','S-'+id,cid,'{}',id+' preview');
            c.store.run('INSERT INTO conversation_inputs VALUES(?,?,?,?,?,?,?,?,?)',id,cid,c.inspectConversation(cid).generation,null,'S-'+id,state,'idle',id,'{}');
        }
        const queued=c.inspectConversationInputStatus(cid,'third');
        assert.equal(queued.activeInputWaiting,true);
        assert.equal(queued.waiting,3);
        assert.deepEqual(queued.waitingInputIds,['first','second']);
        assert.equal(queued.firstQueuedInputId,'first');
        assert.equal(c.inspectConversationInputStatus(cid,'old').activeInputWaiting,false);
    } finally {await c.close();await fs.rm(root,{recursive:true,force:true});}
});
