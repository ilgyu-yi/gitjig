// Actual public CLI/TUI over explicitly seeded recorded procedure status. No model/engine or delivery qualification.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile),packageRoot=path.resolve(process.env.GITJIG_TEST_PACKAGE_ROOT??'.'),entry=process.env.GITJIG_TEST_CLI_ENTRY??path.join(packageRoot,'dist/cli/entry.js');
const load=file=>import(pathToFileURL(path.join(packageRoot,'dist',file)).href);
const {openController}=await load('controller/index.js'),{freeze,delta,hash}=await load('controller/change-files.js'),{caseDescriptor,compareCases}=await load('controller/check-cases.js'),{uiText}=await load('ui/i18n.js');
const parse=JSON.parse, tables=['works','sources','requirements','change_state','change_versions','runs','budgets','obligations','effect_delegations','effect_operations','check_runs','role_launches','role_outputs'];
const ledger=store=>Object.fromEntries(tables.map(table=>[table,store.all('SELECT * FROM '+table+' ORDER BY rowid').map(row=>({...row}))]));
async function seed(root,locale){
 const home=path.join(root,'home'),c=await openController({installationHome:home});
 try {
 for(const id of ['A','B']){const source=path.join(root,id);await fs.mkdir(source);await fs.writeFile(path.join(source,'file.txt'),'Original '+id);await c.registerProject({id,sourceRoot:source});}
 const started=await c.beginChange({projectId:'A',request:'SYNTHETIC_RECORDED_RESULT: controlled review/check records, never executed. Preserve original result identity.'}),workId=started.workId,f={root,home,c};
    const selected = f.c.store.one('SELECT * FROM change_state WHERE work=?', workId);
    const base = f.c.store.one('SELECT * FROM change_versions WHERE id=?', selected.base);
    const working = path.join(f.root, 'candidate-source'), artifact = path.join(f.home, 'inputs', 'result-candidate');
    await fs.cp(base.artifact, working, {recursive:true});
    await fs.writeFile(path.join(working, 'file.txt'), 'Changed candidate\n');
    await fs.writeFile(path.join(working, 'added.txt'), 'New output\n');
    const frozen = await freeze(working, artifact, {}), candidate = 'result-candidate';
    const candidateData = {manifest:frozen.manifest, delta:delta(parse(base.data).manifest, frozen.manifest), producer:'synthetic-fixture-author'};
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', candidate, workId, 'candidate', base.id, artifact, frozen.digest, JSON.stringify(candidateData));
    const check = {id:'behavior', command:'synthetic-not-executed', assertions:['value'], timeoutMs:1000,
        guaranteeIds:['R'], fixturePaths:['file.txt'], cases:['healthy','adverse'].map(kind=>({id:kind, kind,
            guaranteeIds:['R'], derivation:'Controlled required case', consumerPaths:['file.txt'],
            input:{literalUtf8:kind, fixturePaths:['file.txt']}, expected:{kind:'return', value:'Expected observation'}}))};
    const verification = {checks:[check], requiredPaths:['file.txt'], reviewRoles:[{key:'behavior-review', kind:'reviewer', purpose:'Behavior review', requiredPaths:['file.txt']}]};
    const plan = {requirements:[{id:'R', text:'Retain correct changed output'}], verification};
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'result-plan', workId, 'plan', null, null, hash(plan), JSON.stringify({plan}));
    f.c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)', 'result-verification', workId, 'verification', null, null, hash(verification), JSON.stringify({verification}));
    const data = {...parse(selected.data), selection:{}, blocked:[], nextAction:'Run the required checks'};
    f.c.store.run('UPDATE change_state SET candidate=?,plan=?,verification=?,phase=?,data=? WHERE work=?', candidate, 'result-plan', 'result-verification', 'CANDIDATE_CAPTURED', JSON.stringify(data), workId);
    const work = f.c.store.one('SELECT * FROM works WHERE id=?', workId);
    const tuple = {base:base.id, candidate, plan:'result-plan', verification:'result-verification', contracts:data.contractsVersion, requirements:data.requirementVersion??null};
    function receipt(id, status, declaration=check, overrides={}) {
        const run = f.c.store.one('SELECT id FROM runs WHERE work=?', workId).id;
        const descriptor = caseDescriptor(declaration, {hash:frozen.digest, data:{manifest:frozen.manifest}}, tuple, run);
        const output = {version:1, assertions:[{id:'value', passed:status==='pass'}], cases:descriptor.cases.map(c=>({id:c.id, inputDigest:c.inputDigest, observed:c.declaration.expected}))};
        const record = {check:declaration, caseDescriptor:descriptor, caseResults:compareCases(declaration, descriptor, output), parsed:{value:output}, cleanup:'removed', durationMs:12, boundVersions:tuple, ...overrides};
        f.c.store.run('INSERT INTO check_runs VALUES(?,?,?,?,?,?,?,?)', id, workId, run, candidate, tuple.verification, declaration.id, status, JSON.stringify(record));
    }
    function review(id='selected-review', overrides={}) {
        const runId = id+'-run', historyRef = path.join(f.home, 'state', id+'.jsonl');
        f.c.store.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)', runId, workId, work.epoch, work.generation, 'SETTLED', 'retained-not-read', 'consumed', JSON.stringify({cleanup:'removed', historyRef, nativeSessionId:id, nativeCheckpoint:{sessionId:id, leafId:id+'-entry', bytes:1, sha256:'a'.repeat(64)}}));
        const launchData = {inputVersions:tuple, stage:'fresh-review', reviewKey:'behavior-review', purpose:verification.reviewRoles[0].purpose, requiredPaths:verification.reviewRoles[0].requiredPaths, cleanup:'removed', historyRef, nativeSessionId:id, ...overrides};
        f.c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)', id, workId, runId, 'reviewer', work.epoch, 'COMPLETE', 'none', JSON.stringify(launchData));
        const protocol = {version:1, summary:'Retained synthetic reviewer judgment', findings:[], assessedScope:[{sourceId:'candidate:file.txt', startLine:1, endLine:2}], outcome:'clear'};
        const metadata = {protocol, terminal:'complete', rawFinalTruncated:false, omittedFindingCount:0, issues:[], historyRef, nativeEntryId:id+'-entry'};
        f.c.store.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)', id+'-output', id, JSON.stringify(protocol), 'usable', JSON.stringify(metadata));
        f.c.store.run("UPDATE change_state SET data=json_set(data,'$.selection',json(?)) WHERE work=?", JSON.stringify({'behavior-review':id}), workId);
        return {runId, metadata, protocol};
    }
    function markReady() {
        f.c.store.run('UPDATE works SET state=? WHERE id=?', 'DELIVERED', workId);
        f.c.store.run("UPDATE change_state SET phase=?,data=json_set(data,'$.nextAction',?) WHERE work=?", 'REVIEW_READY', 'local review-ready only', workId);
        assert.equal(f.c.inspectChange(workId).reviewReady, true, 'Controlled retained premise must satisfy the existing assessment');
    }

 receipt('synthetic-check','pass');review();markReady();
 const cid=c.createConversation({projectId:'B'}).conversationId;
 c.setConversationLanguage({conversationId:cid,expectedGeneration:c.inspectConversation(cid).generation,expectedRevision:0,replyLanguage:locale});
 const draft='KEEP exact 한국어 draft';c.setDraft({conversationId:cid,expectedRevision:0,text:draft});
 const before=ledger(c.store);return{home,cid,workId,draft,before};
 } finally {await c.close();}
}
for(const locale of ['en','ko'])test('original '+locale+' terminal reviews a foreign-project result and opens only its branch-delivery context',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-result-delivery-pty-')));let passed=false;
 t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained original result terminal '+root);});
 const f=await seed(root,locale),file=path.join(root,'pty.json'),output=file+'.terminal',title=uiText(locale,'result.title'),next=uiText(locale,'result.nextTitle');
 const pick=[{wait:title+' · B',send:'All projects · first page\r'},{wait:title+' · all projects',send:'SYNTHETIC_RECORDED_RESULT\r'},{wait:'added.txt',send:'\x1b[6~'.repeat(8)},{wait:'Work: '+f.workId,send:'\x1b'}];
 const unchanged=[{sql:'SELECT COUNT(*) FROM effect_delegations',rows:[[0]]},{sql:'SELECT COUNT(*) FROM effect_operations',rows:[[0]]},{sql:'SELECT COUNT(*) FROM conversation_inputs',rows:[[0]]},{sql:'SELECT project FROM conversations WHERE id=?',params:[f.cid],rows:[['B']]}];
 const steps=[{wait:f.draft,send:'\x07r'},...pick,{wait:next,assertDraft:f.draft,queries:unchanged,send:'\r'},
  {wait:f.draft,assertDraft:f.draft,send:'\x07r'},...pick,{wait:next,assertDraft:f.draft,send:uiText(locale,'result.reviewDelivery')+'\r'},
  {wait:'Review original result delivery scope',send:'\x1b'},{wait:'Choose the next branch-delivery step',send:'Review receivers for this original result\r'},
  {wait:'Branch delivery · project A · work '+f.workId,assertDraft:f.draft,expectedSelected:f.cid,queries:unchanged,send:'Back\r'},
  {wait:f.draft,assertDraft:f.draft,queries:unchanged,send:'\x07q'}];
 await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',fileURLToPath(new URL('./readiness-no-execution.mjs',import.meta.url)),entry,'conversation','ui','--home',f.home,'--conversation',f.cid],cwd:root,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},steps,timeoutSeconds:12,gracefulShutdownSeconds:3,expectedInputs:0,database:path.join(f.home,'state/controller.sqlite'),output}));
 try{
  const result=JSON.parse((await execute('/usr/bin/python3',[fileURLToPath(new URL('../cli/fork-ui-pty.py',import.meta.url)),file],{timeout:16000,maxBuffer:2**20})).stdout);
  assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
  const db=new DatabaseSync(path.join(f.home,'state/controller.sqlite'),{readOnly:true});try{
   for(const [table,rows]of Object.entries(f.before))assert.deepEqual(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>({...row})),rows,table+' must remain unchanged');
   assert.equal(db.prepare('SELECT draft FROM conversation_views WHERE conversation=?').get(f.cid).draft,f.draft);
  }finally{db.close();}passed=true;
 }catch(error){t.diagnostic((await fs.readFile(output,'utf8').catch(()=>'' )).slice(-6500));throw error;}
});
