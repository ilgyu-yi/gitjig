import {installedQualificationModule} from './qualification-sidecar.mjs';
import { installedFixtureIO, copyHostedFixtures } from './normal-installed-fixtures.mjs';
/** PREPARED ONLY: final installed normal B follows installed A on the SAME live home.
 * No product, checkout CLI/SDK fallback, acceptance context, DB reset or account call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {validateInstalledNormalTrace} from './normal-integration-trace.mjs';
const execute=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');


test('final installed normal B uses copied Node and installed SDK/CLI after retained normal A, with fresh same-op dispatch', {timeout:120000},async t=>{
    assert.ok(process.env.GITJIG_INSTALL_RECEIPT,'Explicit final A+B installation receipt required; do not run against09');
    assert.ok(process.env.GITJIG_INSTALLED_NORMAL_PUBLICATION_RECEIPT,'Actual completed installed normal A receipt required first');
    assert.ok(process.env.GITJIG_DOCKER_CONTEXT&&process.env.GITJIG_RUNTIME_IMAGE,'Explicit actual owned runtime required');
    const receiptPath=await fs.realpath(process.env.GITJIG_INSTALL_RECEIPT),selected=JSON.parse(await fs.readFile(receiptPath,'utf8')),{home,payloadId}=selected;
    assert.ok(path.isAbsolute(home)&&await fs.realpath(home)===home);assert.match(payloadId,/^[a-f0-9]{64}$/);
    const priorPath=await fs.realpath(process.env.GITJIG_INSTALLED_NORMAL_PUBLICATION_RECEIPT),prior=JSON.parse(await fs.readFile(priorPath,'utf8'));
    assert.equal(prior.status,'PASSED OWNED INSTALLED NORMAL A');assert.equal(prior.home,home);assert.equal(prior.payloadId,payloadId);
    const bindingPath=path.join(home,'binding.json'),binding=JSON.parse(await fs.readFile(bindingPath,'utf8'));assert.equal(binding.payloadId,payloadId);
    const payload=path.join(home,'versions',payloadId),node=path.join(home,'bootstrap/node');
    const nodeInfo=await fs.lstat(node);assert.ok(nodeInfo.isFile()&&!nodeInfo.isSymbolicLink());
    await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/installed normal B ')));await fs.mkdir(path.join(root,'.runtime-fixtures'));
    t.diagnostic('Retained installed normal B harness: '+root);
    const suffix=sha(root).slice(0,10),projectId='P-installed-normal-B-'+suffix,repository='installed-b-'+suffix,repositoryId=100000000+parseInt(suffix.slice(0,6),16),repositoryNodeId='Installed-B-'+suffix;
    const originals={},generated={},substitutions=[],files={},env={...process.env,TMPDIR:path.join(home,'artifacts'),NODE_OPTIONS:'',NODE_PATH:'',PI_PACKAGE_DIR:''};
    delete env.NODE_TEST_CONTEXT;delete env.TEST_NORMAL_REST_ORIGIN;delete env.TEST_NORMAL_HTTPS_PROFILE;delete env.TEST_OWNED_NORMAL_ORIGIN;
    const evidence={status:'PREPARED',receiptPath,priorPath,home,payloadId,payload,root,node,projectId,repository,repositoryId,repositoryNodeId,originals,generated,substitutions,scope:'Owned installed normal public B transport composition; no real GitHub call, credential or provider/P7 acceptance'};
    const url=relative=>pathToFileURL(path.join(payload,relative)).href;
    const io = installedFixtureIO({ lane: 'integration', root, originals, generated, substitutions });
    const { read, write, replace } = io;
    const run=async(label,args,timeout=15000)=>{try{const result=await execute(node,args,{cwd:root,env,timeout,maxBuffer:6*2**20});await fs.writeFile(path.join(root,label+'.log'),result.stdout+result.stderr);return result;}catch(error){await fs.writeFile(path.join(root,label+'.log'),String(error.stdout??'')+String(error.stderr??'')+'\n'+String(error.message));throw error;}};
    const beforeFile=path.join(root,'before.json'),afterFile=path.join(root,'after.json');
    try{
        const resolved=await run('bootstrap-resolve',[path.join(home,'bootstrap/bootstrap.js'),'--resolve']);assert.equal(resolved.stdout.trim(),payloadId);
        const critical=['dist/cli/main.js','dist/cli/arguments.js','dist/cli/target-profile.js','dist/controller/index.js','dist/controller/controller.js','dist/controller/effects.js','dist/controller/hostedintegration.js','dist/controller/change-core.js','dist/controller/capture-worker.js','dist/effects/index.js','dist/effects/native-git.js','dist/effects/git-process-child.js','dist/platform/github-capability.js','dist/platform/github-policy.js','dist/platform/github-classic.js','node_modules/@earendil-works/pi-ai/dist/compat.js','node_modules/@earendil-works/pi-coding-agent/dist/index.js'];
        evidence.installedModules=Object.fromEntries(await Promise.all(critical.map(async file=>[file,sha(await fs.readFile(path.join(payload,file)))])));
        evidence.nodeSha256=sha(await fs.readFile(node));
        const priorWorkIds=[prior.ownerPublication.prepared.workId,prior.ownerConfiguration.applied.workId,...prior.agentPublication.works];assert.ok(priorWorkIds.every(id=>typeof id==='string'&&id));
        const ledgerSource=(output,after=false)=>`import fs from'node:fs';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';const d=new DatabaseSync(${JSON.stringify(path.join(home,'state/controller.sqlite'))},{readOnly:true});try{const priorWorks=${JSON.stringify(priorWorkIds)};for(const id of priorWorks)assert.ok(d.prepare('SELECT id FROM works WHERE id=?').get(id),'Prior normal A work must remain');const snapshot={runtimeNode:process.execPath,works:d.prepare('SELECT id,project,source,lineage,state,epoch,generation FROM works ORDER BY id').all(),operations:d.prepare('SELECT id,work,target,grant_id,phase FROM effect_operations ORDER BY id').all(),budgets:d.prepare('SELECT * FROM budgets ORDER BY lineage,kind').all(),projects:d.prepare('SELECT id,root FROM projects ORDER BY id').all(),activeRuns:d.prepare("SELECT COUNT(*) n FROM runs WHERE phase NOT IN ('SETTLED','INTERRUPTED')").get().n};${after?'':`assert.equal(d.prepare('SELECT id FROM projects WHERE id=?').get(${JSON.stringify(projectId)}),undefined,'Project namespace must be fresh; never reset a live DB');`}assert.equal(snapshot.activeRuns,0,'All prior/native work must be settled');fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(snapshot));}finally{d.close();}\n`;
        files.before=await write('before.mjs',ledgerSource(beforeFile));await run('retained-A-prerequisite',[files.before]);evidence.before=JSON.parse(await fs.readFile(beforeFile,'utf8'));assert.equal(await fs.realpath(evidence.before.runtimeNode),await fs.realpath(node));

        await copyHostedFixtures(io, { payload, home, projectId, repository, repositoryId, repositoryNodeId });
        let model=await read('tests/cli/normal-hosted-model.mjs');model=replace('SSE model existing deterministic role fixture only',model,"'../controller/effect-fixture.mjs'","'./effect-fixture.mjs'");files.model=await write('normal-hosted-model.mjs',model);
        files.noSDK=await write('no-sdk-loader.mjs',await read('tests/cli/no-sdk-loader.mjs'));files.guard=await write('no-external.mjs',await read('tests/normal-hosted/no-external.mjs'));
        let adapter=await read('tests/cli/normal-hosted-adapter.mjs');
        adapter=replace('adapter exact external-network guard',adapter,"'../normal-hosted/no-external.mjs'","'./no-external.mjs'");
        adapter=replace('adapter actual installed Controller prototype',adapter,"'../../dist/controller/controller.js'",JSON.stringify(url('dist/controller/controller.js')));
        adapter=replace('adapter actual installed finite normal testing seam',adapter,"'../../.qualification/controller-testing.js'",JSON.stringify(installedQualificationModule(payload,'controller-testing.js')));
        const cliTrace=path.join(root,'cli-runtime.jsonl');
        const trace=`\nimport{registerHooks as traceInstalledHooks}from'node:module';import{appendFileSync as traceInstalledWrite}from'node:fs';const actualInstalledSDK=new Set(),actualInstalledProduct=new Set(),installedRoot=${JSON.stringify(pathToFileURL(payload+path.sep).href)};traceInstalledHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url?.includes('/node_modules/@earendil-works/')){if(!result.url.startsWith(installedRoot))throw Error('Checkout SDK fallback refused');actualInstalledSDK.add(result.url);}if(result.url?.includes('/dist/controller/')||result.url?.includes('/dist/platform/')||result.url?.includes('/dist/pi/')){if(!result.url.startsWith(installedRoot))throw Error('Checkout product fallback refused');actualInstalledProduct.add(result.url);}return result;}});process.once('exit',()=>traceInstalledWrite(${JSON.stringify(cliTrace)},JSON.stringify({node:process.execPath,cliEntry:process.argv[1],command:process.argv.slice(2,4),controllerModule:${JSON.stringify(url('dist/controller/controller.js'))},testingModule:${JSON.stringify(installedQualificationModule(payload,'controller-testing.js'))},sdkModules:[...actualInstalledSDK].sort(),productModules:[...actualInstalledProduct].sort()})+'\\n',{mode:0o600}));\n`;
        substitutions.push({label:'actual copied CLI process/runtime module trace, no resolver remapping',operation:'append',from:null,to:trace,count:1});adapter+=trace;files.adapter=await write('normal-hosted-adapter.mjs',adapter);
        let consumer=await read('tests/cli/normal-hosted-integration.test.mjs');
        consumer=replace('consumer actual installed Controller inspection',consumer,"'../../dist/controller/index.js'",JSON.stringify(url('dist/controller/index.js')));
        consumer=replace('consumer exact local subject import',consumer,"'../controller/hosted-core-fixture.mjs'","'./hosted-core-fixture.mjs'");
        consumer=replace('consumer same installed home',consumer,"home = path.join(f.native.root, 'home')",'home = '+JSON.stringify(home));
        consumer=replace('consumer project namespace',consumer,"'P'",JSON.stringify(projectId));
        consumer=replace('consumer copied-node installed CLI entry',consumer,"path.resolve('dist/cli/main.js')",JSON.stringify(path.join(payload,'dist/cli/main.js')));
        consumer=replace('consumer no-SDK preload',consumer,"path.resolve('tests/cli/no-sdk-loader.mjs')",JSON.stringify(files.noSDK));
        consumer=replace('consumer normal transport preload',consumer,"path.resolve('tests/cli/normal-hosted-adapter.mjs')",JSON.stringify(files.adapter));
        const outcome=path.join(root,'normal-outcome.json');
        consumer=replace('retain outcome path only, original landing assertions unchanged',consumer,"await fs.writeFile(path.join(f.native.root, 'normal-cli-receipt.json'), JSON.stringify(receipt, null, 2));","await fs.writeFile(path.join(f.native.root, 'normal-cli-receipt.json'), JSON.stringify(receipt, null, 2));await fs.writeFile("+JSON.stringify(outcome)+",JSON.stringify(receipt,null,2));");
        files.consumer=await write('normal-consumer.test.mjs',consumer);
        const forbidden=["../../dist/","path.resolve('dist/cli/","../controller/","@earendil-works/pi-ai/compat"];
        for(const file of ['effect-fixture.mjs','hosted-integration-fixture.mjs','hosted-core-fixture.mjs'].map(name => path.join(root, name)).concat(files.model,files.adapter,files.consumer)){const body=await fs.readFile(file,'utf8');for(const token of forbidden)assert.equal(body.includes(token),false,'Checkout product/SDK reference retained: '+file+' '+token);}
        await fs.writeFile(path.join(root,'adaptations.json'),JSON.stringify({originals,generated,substitutions},null,2));
        await run('actual-installed-normal-public-B',['--import',files.guard,'--test','--test-concurrency=1',files.consumer],100000);
        evidence.outcome=JSON.parse(await fs.readFile(outcome,'utf8'));assert.equal(evidence.outcome.home,home);assert.equal(evidence.outcome.phase,'CONFIRMED');assert.equal(evidence.outcome.nativePushes,1);assert.equal(evidence.outcome.separateCliProcesses,true);assert.equal(evidence.outcome.sourcePreserved,true);assert.notEqual(evidence.outcome.oldCapture,evidence.outcome.newCapture);assert.ok(evidence.outcome.actualOfficialHttpRoles.some(row=>row.role==='reviewer'));
        evidence.nativeWorld=await fs.realpath(evidence.outcome.root);
        assert.ok(evidence.nativeWorld.startsWith(root+path.sep),'Actual native fixture must be owned by this harness');
        evidence.ownerInputs={};for(const name of ['normal-target.json','normal-model.json','normal-credential.json']){const file=path.join(evidence.nativeWorld,name),stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'Actual owner profile must remain private');evidence.ownerInputs[name]={sha256:sha(await fs.readFile(file)),mode:stat.mode&0o777};}
        evidence.nativeReceipts={};for(const name of ['normal-cli-receipt.json','normal-cli-calls.json'])evidence.nativeReceipts[name]=sha(await fs.readFile(path.join(evidence.nativeWorld,name)));
        evidence.cliRuntime=(await fs.readFile(cliTrace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
        evidence.runtimeProjection=await validateInstalledNormalTrace(evidence.cliRuntime,{payload,node});
        files.after=await write('after.mjs',ledgerSource(afterFile,true));await run('preserved-same-home-A-and-B',[files.after]);evidence.after=JSON.parse(await fs.readFile(afterFile,'utf8'));assert.equal(await fs.realpath(evidence.after.runtimeNode),await fs.realpath(node));
        for(const key of ['works','operations','budgets','projects'])for(const old of evidence.before[key])assert.deepEqual(evidence.after[key].find(row=>key==='budgets'?row.lineage===old.lineage&&row.kind===old.kind:row.id===old.id),old,'Earlier same-home A state changed: '+key);
        assert.ok(evidence.after.projects.some(row=>row.id===projectId));assert.ok(evidence.after.operations.some(row=>row.id===evidence.outcome.operationId&&row.phase==='CONFIRMED'));assert.equal(evidence.after.activeRuns,0);
        assert.equal(JSON.parse(await fs.readFile(bindingPath,'utf8')).payloadId,payloadId);evidence.status='PASSED OWNED INSTALLED NORMAL B AFTER A';
    }catch(error){evidence.status='FAILED; exact partial world retained, no DB reset';evidence.error=String(error.message);throw error;}
    finally{await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(evidence,null,2));await fs.writeFile(path.join(root,'adaptations.json'),JSON.stringify({originals,generated,substitutions},null,2));if(process.env.GITJIG_INSTALLED_NORMAL_INTEGRATION_RECEIPT)await fs.writeFile(process.env.GITJIG_INSTALLED_NORMAL_INTEGRATION_RECEIPT,JSON.stringify(evidence,null,2));}
});
