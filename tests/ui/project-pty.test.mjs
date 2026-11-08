import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {translator} from '../../dist/ui/i18n.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {shared as publicationWorld, target as publicationTarget} from '../contributions/publication-fixture.mjs';

test('closing the original terminal during project directory validation prevents registration', {timeout:16000}, async t=>{
    const root=await temporaryDirectory('project-registration-close'),home=path.join(root,'home'),source=path.join(root,'source');
    const draft='Keep this project draft · 한글', guard=path.join(root,'hold.mjs'),release=path.join(root,'release');
    let passed=false;
    t.after(async()=>{
        if(passed)await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained project registration terminal '+root);
    });
    await fs.mkdir(source,{mode:0o700});
    const controller=await openController({installationHome:home});
    const {conversationId:cid}=controller.createConversation();
    controller.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    await controller.close();
    await fs.writeFile(guard,`import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const realpath=fs.realpath;
fs.realpath=async function(file,...options){
 const resolved=await realpath.call(this,file,...options);
 if(file===${JSON.stringify(source)}){
  process.stderr.write('PROJECT_VALIDATION_HELD\\n');
  while(!await fs.access(${JSON.stringify(release)}).then(()=>true,()=>false))await delay(10);
 }
 return resolved;
};
`);
    const tr=translator('en'),file=path.join(root,'terminal.json');
    const steps=[
        {wait:tr('footer.setup'),send:'\x07j'},
        {wait:tr('project.title',{project:tr('value.none')}),send:tr('project.register')+'\r'},
        {wait:tr('project.directory'),send:'\x15'+source+'\r'},
        {wait:tr('project.id'),send:'\x15pending-project\r'},
        {wait:'PROJECT_VALIDATION_HELD',assertDraft:draft,queries:[{sql:'SELECT COUNT(*) FROM projects',rows:[[0]]}],send:'\x04'},
        {wait:tr('interaction.closing'),releaseFile:release,send:''},
    ];
    const cli=process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js');
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,cli,'conversation','ui','--home',home,'--conversation',cid],
        env:{HOME:root,GITJIG_HOME:home,PATH:path.dirname(process.execPath),LANG:'C.UTF-8',TERM:'xterm-256color'},
        database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',steps,timeoutSeconds:8,gracefulShutdownSeconds:3,expectedInputs:0}));
    const receipt=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
    const reopened=await openController({installationHome:home});
    try {
        assert.deepEqual(reopened.listProjects(),[]);
        assert.equal(reopened.inspectConversation(cid).projectId,null);
        assert.equal(reopened.inspectConversation(cid).draft.text,draft);
    } finally {await reopened.close();}
    passed=true;
});

for (const locale of ['en', 'ko']) test(`goal-held project switch can open the exact other project independently in ${locale}`, {timeout:15000}, async t => {
    const root = await temporaryDirectory('project-goal-hold');
    const home = path.join(root, 'home');
    const c = await openController({installationHome:home});
    let passed = false, cid, goal, generation;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive:true,force:true});
        else t.diagnostic('Retained project goal hold terminal ' + root);
    });
    const draft = 'Keep this unsent draft · 한글', objective = 'Goal stays in the original conversation';
    try {
        for (const id of ['P','Q']) {
            const sourceRoot = path.join(root,id);
            await fs.mkdir(sourceRoot);
            await c.registerProject({id, sourceRoot});
        }
        cid = c.createConversation({projectId:'P'}).conversationId;
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
        goal = c.createGoal({conversationId:cid,objective,criteria:['Preserve the original scope'],turnLimit:2});
        generation = c.inspectConversation(cid).generation;
    } finally {
        await c.close();
    }
    const tr = translator(locale);
    const held = locale==='ko' ? '프로젝트 변경 보류 · 이 대화에 완료되지 않은 목표가 있습니다' :
        'Project unchanged · this conversation has an unfinished goal';
    const retry = tr('error.retryProjectSwitch',{project:'Q'});
    const destination = tr('error.requestedProject',{project:'"Q"'});
    const unchanged = [
        {sql:'SELECT project FROM conversations WHERE id=?',params:[cid],rows:[['P']]},
        {sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[cid],rows:[[draft]]},
        {sql:'SELECT id,conversation,revision,state FROM goals',rows:[[goal.goalId,cid,goal.revision,goal.state]]},
        {sql:'SELECT COUNT(*) FROM goal_attempts',rows:[[0]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
        {sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]},
    ];
    const step = (wait,send) => ({wait,send,queries:unchanged});
    const stages = [
        step('/ready','\x07j'),
        step(tr('project.title',{project:'P'}),'\x1b[B\r'),
        step(held,retry+'\r'),
        step(tr('error.projectRetryHeld'),tr('error.goal')+'\r'),
        step(tr('goal.menu',{state:tr('goal.state.READY'),objective}),'\x1b'),
        step(destination,tr('error.independentSelectedProject',{project:'Q'})+'\r'),
        {...step(tr('newConversation.opened',{project:'Q'}),'\x07q'),assertDraft:'',queries:[
            ...unchanged,
            {sql:'SELECT project FROM conversations JOIN interaction_view ON selected=conversations.id',rows:[['Q']]},
        ]},
    ];
    const file = path.join(root,'terminal.json');
    const cli = [process.execPath,'--import','./tests/ui/readiness-no-execution.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js'];
    const env = {HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
        LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
    await assert.rejects(promisify(execFile)(cli[0], [...cli.slice(1),'conversation','project','--home',home,
        '--conversation',cid,'--project','Q','--generation',String(generation)], {env}), error => {
        assert.equal(error.code, 2);
        assert.equal(JSON.parse(error.stderr).error, 'PROJECT_GOAL_PENDING');
        return true;
    });
    const command = [...cli,'conversation','ui','--home',home,'--conversation',cid];
    await fs.writeFile(file, JSON.stringify({command, steps:stages, timeoutSeconds:10,
        env,
        database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
    const receipt = JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.stages, stages.length);
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.terminalRestored, true);
    passed = true;
});

for (const locale of ['en', 'ko']) for (const state of ['QUEUED','RECONCILIATION_REQUIRED'])
test(`project switch explains ${state} and retains the original destination in ${locale}`, {timeout:18000}, async t => {
    const root = await temporaryDirectory('project-input-hold');
    const home = path.join(root, 'home');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive:true, force:true});
        else t.diagnostic('Retained project input hold terminal ' + root);
    });
    const c = await openController({installationHome:home});
    const request = 'Original admitted request must stay on P';
    const draft = 'New unsent draft · 한글';
    let cid;
    try {
        for (const id of ['P', 'Q']) {
            const sourceRoot = path.join(root, id);
            await fs.mkdir(sourceRoot);
            await c.registerProject({id, sourceRoot});
        }
        const conversation = c.createConversation({projectId:'P'});
        cid = conversation.conversationId;
        c.setDraft({conversationId:cid, expectedRevision:0, text:draft});
        const receipt = await c.queueConversationInput({conversationId:cid, expectedGeneration:conversation.generation, text:request, mode:'idle'});
        if (state === 'RECONCILIATION_REQUIRED')
            c.store.run("UPDATE conversation_inputs SET state='RECONCILIATION_REQUIRED' WHERE id=?", receipt.inputId);
    } finally {
        await c.close();
    }
    const tr = translator(locale);
    const uncertain = state === 'RECONCILIATION_REQUIRED';
    const held = uncertain ? (locale === 'ko' ? '프로젝트 변경 보류 · 요청이 전달됐는지 확인이 필요합니다' : 'Project unchanged · request delivery is uncertain') :
        (locale === 'ko' ? '프로젝트 변경 보류 · 보관된 요청 확인 필요' : 'Project unchanged · retained request needs review');
    const guidance = locale === 'ko' ? '보관된 요청 확인에서 전송 상태와 가능한 동작을 확인하세요.' : 'Choose Review retained requests to inspect delivery and available actions.';
    const retry = tr('error.retryProjectSwitch', {project:'Q'});
    const destination = tr('error.requestedProject',{project:'"Q"'});
    const pending = [
        {sql:'SELECT project FROM conversations WHERE id=?', params:[cid], rows:[['P']]},
        {sql:'SELECT state,text FROM conversation_inputs', rows:[[state, request]]},
        {sql:'SELECT COUNT(*) FROM runs', rows:[[0]]},
    ];
    const step = (wait, send, queries=pending) => ({wait, send, assertDraft:draft, expectedInputs:1, queries});
    const steps = uncertain ? [
        step('/ready', '\x07j'),
        step(tr('project.title', {project:'P'}), '\x1b[B\r'),
        step(held, retry + '\r'),
        step(tr('error.projectRetryHeld'), tr('error.inputs') + '\r'),
        step(tr('input.recoveryReconciliation'), '\x1b'),
        step(destination, tr('error.details') + '\r'),
        step('PROJECT_INPUT_UNCERTAIN', '\x1b'),
        step(tr('error.projectRetryHeld'), tr('error.independentSelectedProject', {project:'Q'}) + '\r'),
        {...step(tr('newConversation.opened',{project:'Q'}), '\x07q', [
            ...pending,
            {sql:'SELECT project FROM conversations JOIN interaction_view ON selected=conversations.id',rows:[['Q']]},
            {sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[cid],rows:[[draft]]},
        ]), assertDraft:''},
    ] : [
        step('/ready', '\x07j'),
        step(tr('project.title', {project:'P'}), '\x1b[B\r'),
        step(held, tr('error.details') + '\r'),
        step(guidance, '\x1b'),
        step(tr('error.title'), retry + '\r'),
        step(tr('error.projectRetryHeld'), tr('error.inputs') + '\r'),
        step(tr('input.recoveryList'), '\r'),
        step(tr('input.recoveryOpenActions'), '\r'),
        step(tr('input.recoveryRuntimeRequired'), tr('input.recoveryWithdraw') + '\r'),
        step(tr('input.recoveryWithdrawn').split('.')[0], '\x07e', [
            {sql:'SELECT state,text FROM conversation_inputs', rows:[['CONFLICTED', request]]},
            {sql:'SELECT project FROM conversations', rows:[['P']]},
        ]),
        step(tr('error.title'), retry + '\r', [{sql:'SELECT project FROM conversations', rows:[['P']]}]),
        step(tr('project.selected', {id:'Q'}), '\x07q', [
            {sql:'SELECT project FROM conversations', rows:[['Q']]},
            {sql:'SELECT state,text FROM conversation_inputs', rows:[['CONFLICTED', request]]},
            {sql:'SELECT COUNT(*) FROM runs', rows:[[0]]},
        ]),
    ];
    const file = path.join(root, 'terminal.json');
    const cli = ['--import', './tests/ui/readiness-no-execution.mjs', process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js'];
    const command = [process.execPath, ...cli, 'conversation', 'ui', '--home', home, '--conversation', cid];
    const env = {HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
        LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
    await fs.writeFile(file, JSON.stringify({command, steps, timeoutSeconds:12,
        env,
        database:path.join(home, 'state/controller.sqlite'), output:file+'.terminal'}));
    const receipt = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', file], {timeout:15000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.stages, steps.length);
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.terminalRestored, true);
    const output = await fs.readFile(file+'.terminal', 'utf8');
    if (uncertain) {
        assert.match(output, /PROJECT_INPUT_UNCERTAIN/);
        await assert.rejects(promisify(execFile)(command[0], [...cli, 'conversation','project',
            '--home',home,'--conversation',cid,'--project','Q','--generation','0'], {env}), error => {
            assert.equal(error.code, 2);
            assert.equal(JSON.parse(error.stderr).error, 'NATIVE_INPUT_RECOVERY_REQUIRED');
            return true;
        });
    } else assert.match(output, /LIFECYCLE_HELD: input:/);
    assert.ok(output.includes(tr('error.independentSelectedProject', {project:'Q'})));
    passed = true;
});

for (const locale of ['en','ko']) for (const unavailable of [false,true]) test(`project recovery retains the destination for an owned external operation in ${locale} · ${unavailable?'unavailable proof':'readable proof'}`, {timeout:16000}, async t => {
    const root = await temporaryDirectory('project-effect-hold'), home = path.join(root,'home'), file = path.join(root,'driver.json');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained external operation project fixture '+root);
    });
    const c = await openController({installationHome:home});
    const draft = 'Protect source draft', operation = 'original-effect';
    let source, unrelated;
    try {
        for (const id of ['P','Q']) {
            const sourceRoot = path.join(root,id);
            await fs.mkdir(sourceRoot);
            await c.registerProject({id,sourceRoot});
        }
        source = c.createConversation({projectId:'P'}).conversationId;
        unrelated = c.createConversation({projectId:'P'}).conversationId;
        for (const [cid,work,id,data] of [[source,'owned-work',operation,'{}'],[unrelated,'foreign-work','foreign-effect','malformed']]) {
            c.store.run('INSERT INTO sources VALUES(?,?,?,?)','source-'+work,cid,'{}','Original request');
            c.store.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?)',work,'P','source-'+work,null,work,'ACTIVE',1,1,null,
                JSON.stringify({kind:'ordinary-conversation',conversation:cid}));
            c.store.run('INSERT INTO effect_targets VALUES(?,?,?)','target-'+id,'P','{}');
            c.store.run('INSERT INTO effect_delegations VALUES(?,?,?,?,?)','grant-'+id,work,'target-'+id,1,'{}');
            c.store.run('INSERT INTO effect_operations VALUES(?,?,?,?,?,?)',id,work,'target-'+id,'grant-'+id,'UNKNOWN',data);
        }
        c.setDraft({conversationId:source,expectedRevision:0,text:draft});
    } finally { await c.close(); }
    const tr = translator(locale);
    const held = locale==='ko'?'프로젝트 변경 보류 · 원래 외부 작업의 상태 확인이 필요합니다':'Project unchanged · an original external operation needs review';
    const unavailableProof = locale==='ko'?'원래 저장소 작업의 상태를 확인할 수 없음':'Could not check the original repository operation';
    const cli = await fs.realpath(process.env.GITJIG_TEST_CLI_ENTRY ?? 'dist/cli/entry.js');
    const guard = path.join(root,'effect-proof.mjs');
    if (unavailable) await fs.writeFile(guard,`import {Controller} from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(cli),'../controller/controller.js')).href)};
Controller.prototype.matchesProjectEffectHold = () => { throw Error('Controlled unavailable operation proof'); };`);
    const unchanged = [
        {sql:'SELECT project,generation FROM conversations WHERE id=?',params:[source],rows:[['P',0]]},
        {sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[source],rows:[[draft]]},
        {sql:'SELECT id,phase,data FROM effect_operations ORDER BY id',rows:[['foreign-effect','UNKNOWN','malformed'],[operation,'UNKNOWN','{}']]},
        {sql:'SELECT COUNT(*) FROM effect_receipts',rows:[[0]]},
        {sql:'SELECT COUNT(*) FROM runs',rows:[[0]]},
    ];
    const step = (wait,send) => ({wait,send,queries:unchanged});
    const steps = [
        step(draft,'\x07j'),
        step(tr('project.title',{project:'P'}),'\x1b[B\r'),
        {...step(unavailable?unavailableProof:held,tr('error.details')+'\r'), assertDraft:draft},
        step('effect:'+operation+':UNKNOWN','\x1b'),
        step(tr('error.title'),tr('error.repositoryOperations')+'\r'),
        step(tr('repository.menu.title'),'\x1b'),
        step(tr('error.requestedProject',{project:'"Q"'}),tr('error.retryProjectSwitch',{project:'Q'})+'\r'),
        step(tr('error.projectRetryHeld'),tr('error.independentSelectedProject',{project:'Q'})+'\r'),
        {...step(tr('newConversation.opened',{project:'Q'}),'\x07q'), assertDraft:'', queries:[...unchanged,
            {sql:'SELECT project FROM conversations JOIN interaction_view ON selected=conversations.id',rows:[['Q']]}]},
    ];
    await fs.writeFile(file,JSON.stringify({
        command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs',...(unavailable?['--import',guard]:[]),cli,
            'conversation','ui','--home',home,'--conversation',source],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
            LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,timeoutSeconds:10,gracefulShutdownSeconds:3,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',
    }));
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    const screen = await fs.readFile(file+'.terminal','utf8');
    assert.ok(!screen.includes('effect:foreign-effect'));
    assert.ok(!screen.includes(tr('error.originalRepositoryOperation')));
    assert.equal(screen.includes(unavailableProof),unavailable);
    passed = true;
});

for (const locale of ['en','ko']) test(`project recovery opens the exact original publication in ${locale}`, {timeout:16000}, async t => {
    const f = await publicationWorld(), home = path.join(f.root,'home'), file = path.join(f.root,'project-operation.json');
    let passed = false;
    t.after(() => f.close({preserve:!passed}));
    for (const id of ['P','Q']) {
        const sourceRoot = path.join(f.root,id);
        await fs.mkdir(sourceRoot);
        await f.c.registerProject({id,sourceRoot});
    }
    const cid = f.c.createConversation({projectId:'P'}).conversationId;
    const {targetId} = f.c.registerPublicationTarget({target:publicationTarget,visibility:'public'});
    const op = await f.c.prepareOwnerPublication({targetId,action:{kind:'create-comment',purpose:'bootstrap',
        parent:{kind:'issue',number:8,nodeId:'I8'},body:'Retained original for terminal recovery'}});
    // The operation and reader are real. Bind the retained work to this UI fixture's source conversation.
    f.c.store.run("UPDATE works SET data=json_set(data,'$.conversation',?) WHERE id=?",cid,op.workId);
    const draft = 'Original draft survives exact inspection';
    f.c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    assert.equal(f.c.inspectRetainedPublication(op.operationId).view?.workId, op.workId);
    const recorded = f.c.store.one('SELECT phase,data FROM effect_operations WHERE id=?', op.operationId);
    const calls = f.requests.length;
    await f.c.close();
    const tr = translator(locale), held = tr('project.effectPending');
    const unchanged = [
        {sql:'SELECT project,generation FROM conversations WHERE id=?',params:[cid],rows:[['P',0]]},
        {sql:'SELECT draft FROM conversation_views WHERE conversation=?',params:[cid],rows:[[draft]]},
        {sql:'SELECT phase,data FROM effect_operations WHERE id=?',params:[op.operationId],rows:[[recorded.phase,recorded.data]]},
        {sql:'SELECT COUNT(*) FROM effect_receipts WHERE operation=? AND kind=\'publication-send\'',params:[op.operationId],rows:[[0]]},
    ];
    const step = (wait,send) => ({wait,send,queries:unchanged});
    const steps = [
        step(draft,'\x07j'),
        step(tr('project.title',{project:'P'}),'\x1b[B\r'),
        step(tr('error.originalRepositoryOperation'),tr('error.originalRepositoryOperation')+'\r'),
        step(tr('publication.record.title',{id:op.operationId}),'\x1b'),
        step(tr('error.requestedProject',{project:'"Q"'}),tr('error.back')+'\r'),
        {...step(held,'\x07q'),assertDraft:draft},
    ];
    await fs.writeFile(file,JSON.stringify({
        command:[process.execPath,'--import','./tests/ui/readiness-no-execution.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js',
            'conversation','ui','--home',home,'--conversation',cid],
        env:{HOME:f.root,GITJIG_HOME:home,TMPDIR:f.root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',
            LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,timeoutSeconds:10,gracefulShutdownSeconds:3,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',
    }));
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    assert.equal(f.requests.length,calls);
    assert.ok(!(await fs.readFile(file+'.terminal','utf8')).includes(tr('repository.menu.title')));
    passed = true;
});

for(const locale of ['en','ko']) test('cancelling staged registration returns to project selection in '+locale,{timeout:16000},async t=>{
    const root=await temporaryDirectory('project-registration-back'),home=path.join(root,'home'),file=path.join(root,'terminal.json');
    let passed=false; t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained registration terminal '+root);});
    const c=await openController({installationHome:home}),draft='Keep the original draft · 한글';
    let cid,projects;
    try{
        for(const id of ['P','Q']){const sourceRoot=path.join(root,id);await fs.mkdir(sourceRoot);await c.registerProject({id,sourceRoot});}
        projects=c.listProjects().map(p=>[p.id,p.sourceRoot]);
        cid=c.createConversation({projectId:'P'}).conversationId;
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
        c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
    }finally{await c.close();}
    const tr=translator(locale),title=tr('project.title',{project:'P'}),open=tr('project.register')+'\r';
    const queries=[{sql:'SELECT id,root FROM projects ORDER BY id',rows:projects},{sql:'SELECT COUNT(*) FROM runs',rows:[[0]]}];
    const step=(wait,send,project='P')=>({wait,send,assertDraft:draft,queries:[...queries,
        {sql:'SELECT project,generation FROM conversations WHERE id=?',params:[cid],rows:[[project,project==='P'?0:1]]}]});
    const steps=[step(draft,'\x07j'),step(title,open),step(tr('project.directory'),'\x1b'),
        step(title,open),step(tr('project.directory'),'\x15relative/invalid\r'),step(tr('project.id'),'\x1b'),
        step(title,open),step(tr('project.directory'),'\x15relative/invalid\r'),step(tr('project.id'),'\x15held-id\r'),
        step(tr('project.registrationFailed'),'\x1b'),step(tr('project.editDirectory'),tr('project.editDirectory')+'\r'),
        step(tr('project.directory'),'\x1b'),step(tr('project.cancelRegistration'),tr('project.cancelRegistration')+'\r'),
        step(title,'Q · '+path.join(root,'Q')+'\r'),step(tr('project.selected',{id:'Q'}),'\x07q','Q')];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
        '--import','./tests/ui/readiness-no-execution.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js','conversation','ui','--home',home,'--conversation',cid],
        env:{HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,timeoutSeconds:10,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
    const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:13000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);passed=true;
});

test('fresh UI registers/selects a project with Korean command keys and retains cancelled slash input without a model',{timeout:12000},async t=>{
    const root=await temporaryDirectory('project-pty'),home=path.join(root,'home'),source=path.join(root,'한글 project');
    await fs.mkdir(source);const file=path.join(root,'pty.json');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained project PTY '+root);});
    const rows=[['demo',source]];
    const steps=[
        {wait:'Model: not selected',send:'\x07'},
        {wait:'Project: select or register',send:'ㅓ'},
        {wait:'Project for this conversation',send:'\r'},
        {wait:'Project directory',send:'\x15'+source+'\r'},
        {wait:'Project ID',send:'\x15demo\r'},
        {wait:'Project selected: demo',queries:[{sql:'SELECT id,root FROM projects',rows}],send:'\x07'},
        {wait:'Project: select or register',send:'ㅓ'},
        {wait:'Project for this conversation',send:'\r'},
        {wait:'Project already selected: demo',send:'/project\x1b\r'},
        {wait:'Project for this conversation',send:'\x1b'},
        {wait:'Command cancelled · draft kept',assertDraft:'/project',queries:[{sql:'SELECT project,generation FROM conversations',rows:[['demo',1]]}],send:'\x07'},
        {wait:'Commands · Ctrl+G, then a letter',assertDraft:'/project',send:'q'},
    ];
    const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,PATH:path.dirname(process.execPath),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import','./tests/cli/account-ui-no-network.mjs',process.env.GITJIG_TEST_CLI_ENTRY??'dist/cli/entry.js'],env,steps,timeoutSeconds:8,expectedInputs:0,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal'}));
    const result=JSON.parse((await promisify(execFile)('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:10000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);passed=true;
});

for (const locale of ['en', 'ko']) test('original ' + locale + ' terminal retains launch-directory default and corrects staged registration under an active bridge', {timeout: 20000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-project-launch-ui-')));
    const home = path.join(root, 'application'), launch = path.join(root, 'launch-project'), corrected = path.join(root, 'corrected-project');
    for (const name of ['launch-project', 'corrected-project', 'host', 'agent', 'agent/home', 'account'])
        await fs.mkdir(path.join(root, name), {mode: 0o700});
    const executable = path.join(root, 'owned-native');
    await fs.writeFile(executable, '#!/bin/sh\nexit 90\n', {mode: 0o700});
    await fs.writeFile(path.join(root, 'agent/claude-bridge.json'), '{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}', {mode: 0o600});
    const c = await openController({installationHome: home});
    try {
        await ApplicationStartup.open(c).save({version: 1, bridge: {
            profile: {kind: 'installed-claude-bridge', cwd: path.join(root, 'host'), agentDir: path.join(root, 'agent'), executable: {file: executable, sha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},
            nativeAccountDirectory: path.join(root, 'account'),
        }});
    }
    finally { await c.close(); }
    const copy = locale === 'ko' ? {
        menu: '이 대화의 프로젝트', register: '프로젝트 등록…', directory: '프로젝트 폴더 · 절대 경로', id: '프로젝트 ID',
        selected: '프로젝트 선택됨:', failed: '프로젝트를 등록하지 못했습니다', edit: '프로젝트 폴더 수정', retry: '이 프로젝트 값으로 다시 등록',
    } : {
        menu: 'Project for this conversation', register: 'Register a project…', directory: 'Project directory', id: 'Project ID',
        selected: 'Project selected:', failed: 'Project not registered', edit: 'Edit project directory', retry: 'Retry these project fields',
    };
    const empty = [{sql: 'SELECT COUNT(*) FROM works', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM runs', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM conversation_inputs', rows: [[0]]}];
    const steps = [
        {wait: '/ready', send: '/project\x1b\r'},
        {wait: copy.menu, send: '\r'},
        {wait: copy.directory, send: '\r'},
        {wait: copy.id, send: '\r'},
        {wait: copy.selected + ' launch-project', queries: [...empty, {sql: 'SELECT id,root FROM projects', rows: [['launch-project', launch]]}], send: '/project\x1b\r'},
        {wait: copy.menu, send: copy.register + '\r'},
        {wait: copy.directory, send: '\x15relative/invalid\r'},
        {wait: copy.id, send: '\x15retained-id\r'},
        {wait: copy.failed, send: '\x1b'},
        {wait: copy.edit, send: copy.edit + '\r'},
        {wait: copy.directory, send: '\x15' + corrected + '\r'},
        {wait: copy.retry, queries: [{sql: 'SELECT COUNT(*) FROM projects', rows: [[1]]}], send: copy.retry + '\r'},
        {wait: copy.selected + ' retained-id', queries: [...empty, {sql: 'SELECT id,root FROM projects ORDER BY id', rows: [['launch-project', launch], ['retained-id', corrected]]}], assertDraft: '', send: '/quit\x1b\r'},
    ];
    const config = path.join(root, 'terminal.json'), output = config + '.terminal'; let passed = false;
    t.after(async () => { if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained project launch/correction terminal ' + root); });
    await fs.writeFile(config, JSON.stringify({command: [process.execPath, '--import', path.resolve('tests/ui/readiness-no-execution.mjs'), path.resolve('dist/cli/entry.js')], cwd: launch,
        env: {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: root, USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture', GITJIG_HOME: home, TMPDIR: root, TERM: 'xterm-256color', LANG: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', LC_ALL: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', NODE_OPTIONS: '', NODE_PATH: ''},
        steps, timeoutSeconds: 12, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output, gracefulShutdownSeconds: 3}));
    try {
        const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], {timeout: 16000, maxBuffer: 2 ** 20})).stdout);
        assert.equal(result.exitCode, 0); assert.equal(result.stages, steps.length); assert.equal(result.terminalRestored, true);
        passed = true;
    }
    catch (error) { t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-6000)); throw error; }
});

for (const locale of ['en', 'ko']) test('project refusal keeps its destination when retained input is unreadable in ' + locale, {timeout: 18000}, async t => {
    const root = await temporaryDirectory('project-unreadable-input'), home = path.join(root, 'home');
    const database = path.join(home, 'state/controller.sqlite'), observation = path.join(root, 'current.json');
    const config = path.join(root, 'driver.json'), output = path.join(root, 'terminal');
    const draft = 'Unsent project draft · 새 초안', original = 'Original retained input · 이전 요청';
    const tr = translator(locale);
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive: true, force: true});
        else t.diagnostic('Retained project hold terminal ' + root);
    });
    const controller = await openController({installationHome: home});
    let cid, receipt, malformed, unchanged;
    try {
        for (const id of ['P', 'Q']) {
            const sourceRoot = path.join(root, id);
            await fs.mkdir(sourceRoot, {mode: 0o700});
            await controller.registerProject({id, sourceRoot});
        }
        const source = controller.createConversation({projectId: 'P'});
        cid = source.conversationId;
        controller.setDraft({conversationId: cid, expectedRevision: 0, text: draft});
        controller.setConversationLanguage({conversationId: cid, expectedGeneration: source.generation, expectedRevision: 0, replyLanguage: locale});
        const {inputId} = await controller.queueConversationInput({conversationId: cid, expectedGeneration: source.generation, text: original, mode: 'idle'});
        receipt = controller.store.one('SELECT * FROM conversation_inputs WHERE id=?', inputId);
        assert.deepEqual(controller.inspectConversationInputs(cid).map(input => [input.inputId, input.state, input.text]), [[inputId, 'QUEUED', original]]);
        malformed = '!' + receipt.data;
        controller.store.run('UPDATE conversation_inputs SET data=? WHERE id=?', malformed, inputId);
        assert.throws(() => controller.inspectConversationInputs(cid));
        await assert.rejects(controller.changeConversationProject({conversationId: cid, expectedGeneration: source.generation, projectId: 'Q'}),
            error => error.reasons?.includes('input:' + inputId + ':QUEUED'));
        unchanged = ['works', 'runs', 'budgets', 'sources', 'conversation_directions', 'effect_delegations', 'effect_operations'].map(table => {
            const sql = 'SELECT * FROM ' + table + ' ORDER BY rowid';
            return {sql, rows: controller.store.all(sql).map(Object.values)};
        });
        unchanged.push({sql: 'SELECT project,generation FROM conversations WHERE id=?', params: [cid], rows: [['P', source.generation]]});
    } finally { await controller.close(); }
    const checks = data => [...unchanged, {sql: 'SELECT * FROM conversation_inputs ORDER BY rowid', rows: [Object.values({...receipt, data})]}];
    const selected = tr('error.requestedProject', {project: '"Q"'});
    const retry = tr('error.retryProjectSwitch', {project: 'Q'});
    const independent = tr('error.independentSelectedProject', {project: 'Q'});
    const unavailable = tr('error.inputsUnavailable'), refresh = tr('error.refreshProjectRecovery');
    const inputReview = tr('error.inputs'), inputReviewRow = '\n  ' + inputReview + '\n', held = tr('project.inputPending');
    const state = (wait, editorFocused, contains, send, data = malformed) => ({
        wait, send, assertDraft: draft, expectedSelected: cid, queries: checks(data),
        frame: {selected: cid, draft, editorFocused, contains},
    });
    const unavailableStep = (heading, send) => {
        const step = state(heading, false, [heading, selected, held, unavailable, retry, independent, refresh], send);
        step.frame.excludes = [inputReviewRow];
        return step;
    };
    const details = tr('error.detailsTitle'), later = tr('error.projectRetryHeld');
    const opened = tr('newConversation.opened', {project: 'Q'});
    const steps = [
        state(tr('activity.retained'), true, [draft], '\x07j'),
        state(tr('project.title', {project: 'P'}), false, ['Q · ' + path.join(root, 'Q')], '\x1b[B\r'),
        unavailableStep(tr('error.title'), tr('error.details') + '\r'),
        state('PROJECT_INPUT_PENDING', false, [details, 'PROJECT_INPUT_PENDING', 'input:' + receipt.id + ':QUEUED'], '\x1b'),
        unavailableStep(tr('error.title'), retry + '\r'),
        {...unavailableStep(later, refresh + '\r'),
            mutations: [{sql: 'UPDATE conversation_inputs SET data=? WHERE id=?', params: [receipt.data, receipt.id]}]},
        state(inputReview, false, [selected, held, retry, independent, inputReviewRow], inputReview + '\r', receipt.data),
        state(tr('input.recoveryList'), false, [tr('input.recoveryList'), original], '\x1b', receipt.data),
        state(independent, false, [selected, independent, retry], independent + '\r', receipt.data),
        {wait: opened, send: '\x07q', assertDraft: '', frame: {draft: '', editorFocused: true, contains: [opened]},
            queries: [...checks(receipt.data), {sql: 'SELECT project FROM conversations JOIN interaction_view ON conversations.id=selected', rows: [['Q']]}]},
    ];
    const entry = process.env.GITJIG_TEST_CLI_ENTRY ?? path.resolve('dist/cli/entry.js');
    const guard = process.env.GITJIG_UI_MODULE_GUARD;
    await fs.writeFile(config, JSON.stringify({
        command: [process.execPath, ...(guard ? ['--import', guard] : []), '--import', path.resolve('tests/ui/readiness-no-execution.mjs'),
            '--import', path.resolve('tests/ui/inspection-pty-observer.mjs'), entry, 'conversation', 'ui', '--home', home, '--conversation', cid],
        env: {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: root, GITJIG_HOME: home, TMPDIR: root,
            TERM: 'xterm-256color', LANG: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', NODE_OPTIONS: '', NODE_PATH: '',
            GITJIG_RESULT_OBSERVATION: observation}, database, observation, output, steps, expectedInputs: 1,
        columns: 160, timeoutSeconds: 9, noForceKill: true,
    }));
    const result = JSON.parse((await promisify(execFile)('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], {timeout: 14500, maxBuffer: 2 ** 20})).stdout);
    assert.deepEqual([result.exitCode, result.stages, result.terminalRestored], [0, steps.length, true]);
    const reopened = await openController({installationHome: home});
    try {
        assert.deepEqual(reopened.store.one('SELECT * FROM conversation_inputs WHERE id=?', receipt.id), receipt);
        assert.deepEqual(reopened.listConversations().map(view => [view.projectId, view.draft.text, view.parentId]).sort(),
            [['P', draft, null], ['Q', '', null]]);
        for (const {sql, params = [], rows} of unchanged) assert.deepEqual(reopened.store.all(sql, ...params).map(Object.values), rows);
    } finally { await reopened.close(); }
    passed = true;
});
