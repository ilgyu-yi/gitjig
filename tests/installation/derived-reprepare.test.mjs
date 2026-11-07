import {installedQualification,installedQualificationModule} from './qualification-sidecar.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const execute=promisify(execFile),hash=x=>createHash('sha256').update(x).digest('hex');
test('installed Controller preserves dirty source through two native refusals and actual same-operation restart',{timeout:75000},async t=>{
 assert.ok(process.env.GITJIG_INSTALL_RECEIPT,'Explicit actual installed candidate required');
 const{home,payloadId}=JSON.parse(await fs.readFile(process.env.GITJIG_INSTALL_RECEIPT,'utf8')),payload=path.join(home,'versions',payloadId);
 await fs.mkdir('.runtime-fixtures',{recursive:true});
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/installed derived ')));
 await fs.mkdir(path.join(root,'tests/controller'),{recursive:true});await fs.mkdir(path.join(root,'tests/platform'),{recursive:true});await fs.mkdir(path.join(root,'.runtime-fixtures'));
 const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Exact consumer adaptation: '+a);return s.replace(a,b);};
 const inputs={},adaptedInputs={},files=['tests/controller/created-acceptance-dirty-reprepare.test.mjs','tests/controller/effect-fixture.mjs','tests/platform/acceptance-fixture.mjs','tests/platform/acceptance-git-fixture.mjs'];
 for(const file of files){const original=await fs.readFile(file,'utf8');inputs[file]=hash(original);let bound=original;
  if(file.includes('created-acceptance-dirty')){
   for(const module of ['controller/index.js','platform/hosted-context.js'])bound=once(bound,"'../../dist/"+module+"'",JSON.stringify(pathToFileURL(path.join(payload,'dist',module)).href));
   bound=once(bound,"'../../.qualification/controller-acceptance.js'",JSON.stringify(installedQualificationModule(payload,'controller-acceptance.js')));
   bound=once(bound,"home=path.join(f.gitRoot,'controller')",'home='+JSON.stringify(home));
   assert.ok(bound.includes("'P'"));bound=bound.replaceAll("'P'",JSON.stringify('installed-derived-'+hash(root).slice(0,12)));
  }
  if(file.endsWith('effect-fixture.mjs'))bound=once(bound,"'@earendil-works/pi-ai/compat'",JSON.stringify(pathToFileURL(path.join(payload,'node_modules/@earendil-works/pi-ai/dist/compat.js')).href));
  if(file.endsWith('acceptance-fixture.mjs'))bound=once(bound,"'../../.qualification/github-acceptance-setup.js'",JSON.stringify(installedQualificationModule(payload,'github-acceptance-setup.js')));
  adaptedInputs[file]=hash(bound);await fs.writeFile(path.join(root,file),bound);
 }
 const env={...process.env,TMPDIR:path.join(home,'artifacts'),NODE_OPTIONS:'',NODE_PATH:'',PI_PACKAGE_DIR:''};delete env.NODE_TEST_CONTEXT;
 t.diagnostic('Installed recovery subject '+root);
 let actual;try{actual=await execute(path.join(home,'bootstrap/node'),['--import',installedQualification(payload).preload,'--test',path.join(root,files[0])],{cwd:root,env,timeout:65000,maxBuffer:3*2**20});}
 catch(error){await fs.writeFile(path.join(root,'actual.log'),String(error.stdout??'')+String(error.stderr??''));throw error;}
 await fs.writeFile(path.join(root,'actual.log'),actual.stdout+actual.stderr);
 const match=actual.stdout.match(/"receipt":"([^"]+actual-dirty-derived-reprepare-receipt\.json)"/);assert.ok(match,'Actual nested native consumer receipt required');
 const receipt=JSON.parse(await fs.readFile(match[1],'utf8'));assert.equal(receipt.home,home);assert.equal(receipt.actualNativePushAttempts,3);assert.equal(receipt.actualAcceptedPushes,1);assert.equal(receipt.controllerRestart,true);
 const result={scope:'Installed020 dirty-source same-W/op repeat/restart composition; no normal021 or real-provider claim',home,payloadId,root,inputs,adaptedInputs,actualReceipt:match[1],...receipt};
 await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(result,null,2)+'\n');
 if(process.env.GITJIG_INSTALLED_DERIVED_RECEIPT)await fs.writeFile(process.env.GITJIG_INSTALLED_DERIVED_RECEIPT,JSON.stringify(result,null,2)+'\n');
 t.diagnostic('Retained installed derived recovery '+root);
});
