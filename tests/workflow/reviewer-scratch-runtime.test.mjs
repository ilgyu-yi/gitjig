import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shell = text => "'" + text.replaceAll("'", "'\"'\"'") + "'";
const usage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};

test('two actual concurrent reviewers share frozen input but same scratch filenames retain independent canaries', {timeout:30000}, async t => {
  assert.ok(process.env.GITJIG_DOCKER_CONTEXT && process.env.GITJIG_RUNTIME_IMAGE, 'Explicit actual runtime required');
  await fs.mkdir('.runtime-fixtures', {recursive:true});
  const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/reviewer-scratch-')));
  const stateRoot = path.join(root,'state'), artifactRoot = path.join(root,'artifacts'), candidate = path.join(root,'candidate');
  for (const dir of [stateRoot,artifactRoot,candidate]) await fs.mkdir(dir,{mode:0o700});
  // One host startup/artifact root is selected before any SDK initialization.
  process.env.TMPDIR = artifactRoot;
  const content = 'module.exports = 42;';
  await fs.writeFile(path.join(candidate,'consumer.cjs'),content,{mode:0o400});
  await fs.chmod(candidate,0o500);
  const before = sha(await fs.readFile(path.join(candidate,'consumer.cjs')));
  const [{createScope},{initializePiHost},{runRole},{createAssistantMessageEventStream}] = await Promise.all([
    import('../../dist/execution/container-scope.js'), import('../../dist/pi/index.js'),
    import('../../dist/workflow/index.js'), import('@earendil-works/pi-ai/compat'),
  ]);
  const host = await initializePiHost({stateRoot,artifactRoot});
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(Error('Reviewer scratch fixture deadline')),20000);
  let release;
  const bothWrites = new Promise(resolve => {release=resolve;});
  const written = new Set(), observations = [], scopes = [], roles = [], cleanups = [];
  const source = {id:'candidate:consumer.cjs',version:'fixture-C1:'+before,side:'candidate',path:'consumer.cjs',content,sha256:before,exposeInPrompt:false};
  const requiredScope = [{sourceId:source.id,startLine:1,endLine:1}];
  const machine = event => {
    assert.equal(event.isError,false,JSON.stringify(event));
    const actual = event.result?.structuredContent;
    assert.ok(actual,'Actual native Bash structured receipt missing');
    assert.equal(actual.exit_code,0,JSON.stringify(actual));
    return JSON.parse(actual.output.trim());
  };
  function selection(actor) {
    let turn = 0;
    return {provider:'scratch-reviewer-'+actor,modelId:'fixture',definition:{api:'scratch-reviewer-api',apiKey:'fixture-only',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'Owned scratch isolation',reasoning:false,input:['text'],cost:usage.cost,contextWindow:32000,maxTokens:1200}],
      streamSimple(model,_context,options) {
        const stream = createAssistantMessageEventStream(), current = turn++;
        void (async () => {
          try {
            if (current === 2) {
              await Promise.race([bothWrites,new Promise((_,reject) => {
                if (options.signal.aborted) reject(options.signal.reason);
                else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
              })]);
              options.signal.throwIfAborted();
              assert.equal(written.size,2,'Read must follow BOTH actual tool-end write receipts');
            }
            let tool;
            if (current === 0) tool = {name:'read',arguments:{path:'consumer.cjs'}};
            if (current === 1) {
              const code = `const fs=require('fs');fs.writeFileSync('/scratch/shared.txt',${JSON.stringify(actor)});fs.writeFileSync('/scratch/fixture.cjs','module.exports='+JSON.stringify(${JSON.stringify(actor)})+';');console.log(JSON.stringify({stage:'written',actor:${JSON.stringify(actor)}}));`;
              tool = {name:'bash',arguments:{command:'node -e '+shell(code)}};
            }
            if (current === 2) {
              const code = `const fs=require('fs'),assert=require('assert/strict');assert.equal(fs.readFileSync('/scratch/shared.txt','utf8'),${JSON.stringify(actor)});assert.equal(require('/scratch/fixture.cjs'),${JSON.stringify(actor)});assert.equal(require('/work/consumer.cjs'),42);let denied=false;try{fs.writeFileSync('/work/consumer.cjs','forbidden')}catch(error){assert.ok(['EROFS','EACCES','EPERM'].includes(error.code));denied=true}assert.ok(denied);console.log(JSON.stringify({stage:'read',actor:${JSON.stringify(actor)},sameFileCanary:fs.readFileSync('/scratch/shared.txt','utf8'),fixtureCanary:require('/scratch/fixture.cjs'),candidate:42,readonlyDenied:denied}));`;
              tool = {name:'bash',arguments:{command:'node -e '+shell(code)}};
            }
            assert.ok(current<=3,'Unexpected automatic retry/provider turn');
            const result = {version:1,summary:'Actual own scratch and immutable source observed',findings:[],assessedScope:requiredScope,outcome:'clear'};
            const message = {role:'assistant',content:tool?[{type:'toolCall',id:actor+'-'+current,...tool}]:[{type:'text',text:JSON.stringify(result)}],api:model.api,provider:model.provider,model:model.id,usage,stopReason:tool?'toolUse':'stop',timestamp:Date.now()};
            stream.push({type:'done',reason:message.stopReason,message});stream.end(message);
          } catch(error) {
            abort.abort(error);release();
            const result={role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,usage,stopReason:'error',errorMessage:String(error),timestamp:Date.now()};
            stream.push({type:'error',reason:'error',error:result});stream.end(result);
          }
        })();
        return stream;
      },
    }};
  }
  let completed=false;
  t.diagnostic('Retained actual reviewer scratch world '+root);
  try {
    for (const actor of ['A','B']) scopes.push(await createScope({dockerBinary:'/opt/homebrew/bin/docker',dockerContext:process.env.GITJIG_DOCKER_CONTEXT,image:process.env.GITJIG_RUNTIME_IMAGE,workRoot:candidate,stateRoot,workId:'scratch-review-'+actor,runId:'scratch-review-'+actor,readOnlyWork:true,signal:abort.signal,defaultTimeoutMs:5000,uid:process.getuid(),gid:process.getgid()}));
    assert.notEqual(scopes[0].containerId,scopes[1].containerId);
    for (const [index,actor] of ['A','B'].entries()) {
      roles.push(runRole({launchId:'review-'+actor,role:'reviewer',inputBundle:{requirements:[{id:'R1',text:'Scratch fixture remains isolated while reading exact C1',source:'owned-test-source'}],contracts:'Independent readonly reviewer runtime fixture, no Controller voting.',context:{candidateVersion:source.version},sources:[source],requiredScope},operations:scopes[index],host,model:selection(actor),signal:abort.signal,maxProviderRequests:4,timeoutMs:18000,
        assertEntry(){abort.signal.throwIfAborted();},
        async beforeModelRequest(manager){
          assert.ok(manager.getLeafId());
          const file=manager.getSessionFile();assert.ok(file);
          await fs.appendFile(path.join(root,'native-checkpoints.jsonl'),JSON.stringify({actor,sessionId:manager.getSessionId(),leafId:manager.getLeafId(),historyRef:file,sha256:sha(await fs.readFile(file))})+'\n');
        },
        onObservation(event){
          if(event.type!=='tool_execution_end'||event.toolName!=='bash')return;
          const receipt=machine(event);observations.push({actor,toolCallId:event.toolCallId,receipt,exitCode:event.result.structuredContent.exit_code});
          if(receipt.stage==='written'){
            assert.equal(receipt.actor,actor);assert.equal(written.has(actor),false);written.add(actor);
            if(written.size===2)release();
          } else {assert.equal(receipt.stage,'read');assert.equal(written.size,2);assert.equal(receipt.actor,actor);}
        },
      }).then(result=>{if(!result.usable){abort.abort(Error(result.issues.join('; ')));release();}return result;},error=>{abort.abort(error);release();throw error;}));
    }
    const results=await Promise.all(roles);
    assert.equal(written.size,2);assert.equal(observations.filter(x=>x.receipt.stage==='written').length,2);assert.equal(observations.filter(x=>x.receipt.stage==='read').length,2);
    assert.notEqual(results[0].historyRef,results[1].historyRef);assert.notEqual(results[0].nativeSessionId,results[1].nativeSessionId);
    const native=[];
    for(const [index,result] of results.entries()){
      const actor=['A','B'][index];assert.equal(result.usable,true,result.issues.join(';'));assert.equal(result.providerRequests,4);assert.equal(result.terminal,'complete');
      const exposure=result.exposures.find(x=>x.producer==='read');assert.ok(exposure);assert.equal(exposure.launchId,'review-'+actor);assert.equal(exposure.version,source.version);assert.equal(exposure.sourceSha256,before);assert.equal(exposure.path,'consumer.cjs');assert.equal(exposure.sourceId,source.id);
      const read=observations.find(x=>x.actor===actor&&x.receipt.stage==='read');assert.equal(read.receipt.sameFileCanary,actor);assert.equal(read.receipt.fixtureCanary,actor);assert.equal(read.receipt.readonlyDenied,true);
      const bytes=await fs.readFile(result.historyRef);assert.ok(result.nativeCheckpoint);assert.ok(bytes.includes(Buffer.from(actor+'-2')));native.push({actor,launchId:result.launchId,historyRef:result.historyRef,nativeSessionId:result.nativeSessionId,historySha256:sha(bytes),nativeCheckpoint:result.nativeCheckpoint,exposure,providerRequests:result.providerRequests});
    }
    assert.equal(sha(await fs.readFile(path.join(candidate,'consumer.cjs'))),before);
    await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify({scope:'Direct concurrent existing reviewer/runtime boundary, not Controller parallel voting or model reliability',root,candidateVersion:source.version,candidateSha256:before,observations,native,completed:true},null,2)+'\n');
    completed=true;
  } finally {
    abort.abort(Error('Scratch fixture finishing'));release();clearTimeout(timer);
    await Promise.allSettled(roles);
    const settled=await Promise.allSettled(scopes.map(scope=>scope.close()));
    for(const result of settled)cleanups.push(result.status==='fulfilled'?result.value:{state:'unknown',reason:String(result.reason)});
    await fs.writeFile(path.join(root,'cleanup.json'),JSON.stringify({completed,cleanups},null,2)+'\n');
    if(completed)assert.equal(scopes.length,2);assert.equal(cleanups.length,scopes.length);assert.ok(cleanups.every(x=>x.state==='removed'),JSON.stringify(cleanups));
  }
});
