import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {DatabaseSync} from 'node:sqlite';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';import {closedRoleFixture} from './closed-role-feedback-fixture.mjs';import {uiText} from '../../dist/ui/i18n.js';
const execute=promisify(execFile);
for(const [locale,configuredModel,workUnavailable=false] of [['en',true],['ko',true],['en',false],['ko',false],['en',false,true]])test('actual terminal retains finished-role feedback in '+locale+(workUnavailable?' when the work handoff fails':configuredModel?' with saved setup':' without model or runtime setup'),{timeout:20000},async t=>{
    const root=await temporaryDirectory('closed-role-terminal'),f=await closedRoleFixture(root,locale,{configuredModel}),{c,cid,home,workId}=f;let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained feedback terminal '+root);});
    const tables=['works','runs','role_launches','obligations','budgets','capacity_leases'];
    const before=Object.fromEntries(tables.map(name=>[name,c.store.all('SELECT * FROM '+name+' ORDER BY rowid').map(row=>({...row}))]));await c.close();
    const file=path.join(root,'driver.json'),output=file+'.terminal',text='Exact task feedback from a finished role';
    const guard=path.join(root,'no-model.mjs');
    await fs.writeFile(guard,`import ${JSON.stringify(new URL('./readiness-no-execution.mjs',import.meta.url).href)};import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js',import.meta.url).href)};let attempted=0;ApplicationModels.prototype.resolve=async()=>{attempted++;throw Error('No model resolution for recording role feedback');};process.on('exit',()=>{if(attempted)process.exitCode=1;});`);
    if(workUnavailable)await fs.appendFile(guard,`
        import {Controller} from ${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)};
        const inspect=Controller.prototype.inspectWorkRecovery;
        let refused=false;
        Controller.prototype.inspectWorkRecovery=function(id){
            if(!refused&&id===${JSON.stringify(workId)}&&this.store.one("SELECT 1 FROM conversation_inputs WHERE work=? AND state='CONFLICTED'",id)){
                refused=true;
                throw Error('CONTROLLED_WORK_RECOVERY_REFUSAL');
            }
            return inspect.apply(this,arguments);
        };
    `);
    const reopen = locale==='en' && !configuredModel && !workUnavailable;
    const feedbackReview={wait:uiText(locale,'input.recoveryFeedbackNext'),assertDraft:'',expectedInputs:1,
        queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[before.runs.length]]},{sql:'SELECT state FROM conversation_inputs',rows:[['QUEUED']]}],send:reopen?'\x1b':'\r'};
    const steps=[
        {wait:uiText(locale,'footer.roleFeedback',{submit:'Enter'}),send:text+'\x1b\r'},
        feedbackReview,
        ...(reopen ? [
            {wait:'INPUT',assertDraft:'',expectedInputs:1,send:'/inputs\x1b\r'},
            {wait:uiText(locale,'input.recoveryList'),send:'\r'},
            {...feedbackReview,wait:uiText(locale,'input.recoveryOpenActions'),assertDraft:'/inputs',send:'\r'},
        ] : []),
        {wait:uiText(locale,'input.feedbackTitle'),send:uiText(locale,'input.keepFeedback')+'\r'},
        ...(workUnavailable ? [{
            wait:'Feedback kept on task '+workId,assertDraft:'',expectedInputs:1,
            queries:[{sql:'SELECT state FROM conversation_inputs',rows:[['CONFLICTED']]},{sql:'SELECT COUNT(*) FROM runs',rows:[[before.runs.length]]}],
            send:'/work '+workId+'\x1b\r',
        }] : []),
        {wait:uiText(locale,'workRecovery.title',{id:workId,state:''}).trimEnd().replace(/ ·$/u,''),assertDraft:'',expectedInputs:1,queries:[{sql:'SELECT state FROM conversation_inputs',rows:[['CONFLICTED']]},{sql:'SELECT COUNT(*) FROM runs',rows:[[before.runs.length]]}],send:'\x1b'},
        {wait:locale==='ko'?'입력':'INPUT',assertDraft:'',expectedInputs:1,send:'\x07q'},
    ];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid,...(configuredModel?['--docker-binary','/usr/bin/false','--docker-context','never-executed','--image','sha256:'+'0'.repeat(64)]:[])],cwd:root,env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,gracefulShutdownSeconds:3,database:path.join(home,'state/controller.sqlite'),output,expectedInputs:1}));
    try{
        const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:16000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
        const terminal=await fs.readFile(output,'utf8');assert.doesNotMatch(terminal,/The response could not be completed|Use the original governed assignment entry|Project runtime is not configured|No model resolution for recording role feedback|Command cancelled · draft kept/);
        assert.equal(terminal.includes(uiText(locale,'input.recoveryList')),reopen);
        const db=new DatabaseSync(path.join(home,'state/controller.sqlite'),{readOnly:true});try{for(const [name,rows]of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all().map(row=>({...row})),rows);
            assert.equal(db.prepare('SELECT raw FROM sources WHERE id=(SELECT source FROM conversation_inputs)').get().raw,text);
            assert.equal(JSON.parse(db.prepare('SELECT data FROM conversation_directions WHERE source=(SELECT source FROM conversation_inputs)').get().data).effectHold,true);
        }finally{db.close();}passed=true;
    }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-4500));throw error;}
});

for(const action of ['newer-draft','cancel'])test('late finished-role receipt preserves '+action+' without opening a dialog',{timeout:20000},async t=>{
    const root=await temporaryDirectory('closed-role-late'),{c,cid,home}=await closedRoleFixture(root);let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained late feedback terminal '+root);});
    const runs=c.store.one('SELECT COUNT(*) AS n FROM runs').n;await c.close();
    const queued=path.join(root,'queued'),release=path.join(root,'release'),guard=path.join(root,'guard.mjs');
    await fs.writeFile(guard,`import ${JSON.stringify(new URL('./readiness-no-execution.mjs',import.meta.url).href)};import fs from 'node:fs';import {Controller} from ${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)};const original=Controller.prototype.queueConversationInputWithContext;Controller.prototype.queueConversationInputWithContext=async function(...args){const receipt=await original.apply(this,args);fs.writeFileSync(${JSON.stringify(queued)},'queued');const deadline=Date.now()+5000;while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>deadline)throw Error('Controlled feedback receipt barrier expired');await new Promise(r=>setTimeout(r,5));}return receipt;};`);
    const text='Retained original correction',draft=action==='newer-draft'?'Newer draft must remain':'',file=path.join(root,'driver.json'),output=file+'.terminal';
    const steps=[
        {wait:'INPUT',send:text+'\x1b\r'},
        {wait:'Sent inputs waiting',waitFiles:[{path:queued,value:'queued'}],send:action==='newer-draft'?'\x15'+draft:'\x1b'},
        {wait:action==='newer-draft'?draft:uiText('en','input.stoppingReceived'),releaseFile:release,send:''},
        {wait:uiText('en',action==='newer-draft'?'input.feedbackReceived':'input.receivedCancelled'),assertDraft:draft,expectedInputs:1,queries:[{sql:'SELECT state FROM conversation_inputs',rows:[['QUEUED']]},{sql:'SELECT COUNT(*) FROM runs',rows:[[runs]]}],send:'\x07q'},
    ];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid,'--docker-binary','/usr/bin/false','--docker-context','never-executed','--image','sha256:'+'0'.repeat(64)],cwd:root,env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,gracefulShutdownSeconds:3,database:path.join(home,'state/controller.sqlite'),output,expectedInputs:1}));
    try{const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:16000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.doesNotMatch(await fs.readFile(output,'utf8'),/Retained requests · separate/);passed=true;
    }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-4500));throw error;}
});

test('ordinary requests still require setup and retain their draft without admission',{timeout:20000},async t=>{
    const root=await temporaryDirectory('ordinary-feedback-control'),{c,home}=await closedRoleFixture(root,'en',{configuredModel:false}),cid=c.createConversation({projectId:'P'}).conversationId;let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained ordinary setup control '+root);});
    const runs=c.store.one('SELECT COUNT(*) AS n FROM runs').n;await c.close();
    const file=path.join(root,'driver.json'),output=file+'.terminal',draft='A new ordinary request still needs setup';
    const steps=[{wait:'INPUT',send:draft+'\x1b\r'},{wait:uiText('en','requestSetup.title'),assertDraft:draft,expectedInputs:0,queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[runs]]}],send:uiText('en','requestSetup.back')+'\r'},{wait:uiText('en','requestSetup.kept'),assertDraft:draft,expectedInputs:0,send:'\x07q'}];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',fileURLToPath(new URL('./readiness-no-execution.mjs',import.meta.url)),path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],cwd:root,env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,gracefulShutdownSeconds:3,database:path.join(home,'state/controller.sqlite'),output,expectedInputs:0}));
    try{const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:16000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);passed=true;
    }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-4500));throw error;}
});

test('source-only receipt cannot become ordinary execution after its role binding changes',{timeout:20000},async t=>{
    const root=await temporaryDirectory('feedback-role-transition'),{c,cid,home,workId}=await closedRoleFixture(root,'en',{configuredModel:false});let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained postreceipt role transition '+root);});
    const runs=c.store.one('SELECT COUNT(*) AS n FROM runs').n;await c.close();
    const guard=path.join(root,'guard.mjs');
    await fs.writeFile(guard,`import ${JSON.stringify(new URL('./readiness-no-execution.mjs',import.meta.url).href)};import {Controller} from ${JSON.stringify(new URL('../../dist/controller/controller.js',import.meta.url).href)};import {ApplicationModels} from ${JSON.stringify(new URL('../../dist/app/models.js',import.meta.url).href)};let attempted=0;const deny=async()=>{attempted++;throw Error('Source-only feedback must never select or start an ordinary producer');};ApplicationModels.prototype.resolve=deny;Controller.prototype.runConversation=deny;const queue=Controller.prototype.queueConversationInputWithContext;Controller.prototype.queueConversationInputWithContext=async function(...args){const receipt=await queue.apply(this,args);const row=this.store.one('SELECT data FROM conversation_state WHERE conversation=?',receipt.conversationId),{role,...changed}=JSON.parse(row.data);this.store.run('UPDATE conversation_state SET data=? WHERE conversation=?',JSON.stringify(changed),receipt.conversationId);return receipt;};process.on('exit',()=>{if(attempted)process.exitCode=1;});`);
    const file=path.join(root,'driver.json'),output=file+'.terminal',text='Keep this correction on its original task';
    const steps=[{wait:'INPUT',send:text+'\x1b\r'},{wait:'Retained requests · separate',assertDraft:'',expectedInputs:1,send:'\r'},{wait:'Original request · review before action',send:'\x1b'},{wait:'Retained requests · separate',send:'Back\r'},{wait:'INPUT',expectedInputs:1,assertDraft:'',queries:[{sql:'SELECT COUNT(*) FROM runs',rows:[[runs]]},{sql:'SELECT state,work FROM conversation_inputs',rows:[['QUEUED',workId]]}],send:'\x07q'}];
    await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',guard,path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],cwd:root,env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TMPDIR:path.join(home,'artifacts'),TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,gracefulShutdownSeconds:3,database:path.join(home,'state/controller.sqlite'),output,expectedInputs:1}));
    try{const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:16000,maxBuffer:2**20})).stdout);assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);assert.doesNotMatch(await fs.readFile(output,'utf8'),/Source-only feedback must never select/);passed=true;
    }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-4500));throw error;}
});
