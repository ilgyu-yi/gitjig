import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {freeze,hash,effective} from '../../dist/controller/change-files.js';
import {assertVerificationScopeFeasible,manifestScopeComparison,manifestScopeEvidence} from '../../dist/controller/verification-strategies.js';
const strategy={requirementId:'scope',kind:'manifest-scope-duty',allowedChangePaths:['consumer.cjs'],unchangedPaths:['owner.txt'],reviewKey:'review'};
test('literal Node entry feasibility is conservative about shell syntax, aliases and directory entries', () => {
    const base = {files:[{path:'consumer.cjs'},{path:'owner.txt'}],directories:[],dependencyLinks:[]};
    const verify = (command, manifest = base, scope = strategy) => assertVerificationScopeFeasible(manifest, {
        checks:[{id:'check',command,fixturePaths:[],expectationPaths:[]}],requiredPaths:[],reviewRoles:[],
    },new Set(),[scope]);
    assert.throws(() => verify('node ./checker.cjs'), /requires a regular file "checker\.cjs"/);
    assert.throws(() => verify('node test/checker.cjs'), /requires a regular file "test\/checker\.cjs"/);
    for (const command of ['node consumer.cjs', 'node "$CHECKER"', 'node checker.cjs --filter', 'cat report | node checker.cjs', "node - <<'CHECK'\nreport()\nCHECK"])
        assert.doesNotThrow(() => verify(command),command);
    assert.doesNotThrow(() => verify('node checker.cjs', {...base,directories:[{path:'checker.cjs'}]}));
    assert.doesNotThrow(() => verify('node checker.cjs', {...base,files:[...base.files,{path:'checker.cjs.js'}]}));
    const aliasScope = {...strategy,allowedChangePaths:['consumer.cjs','node_modules/alias']};
    const dependencyTree = {...base,
        files:[...base.files,{path:'node_modules/real/checker.cjs'}],
        directories:[{path:'node_modules'},{path:'node_modules/real'}]};
    assert.doesNotThrow(() => verify('node node_modules/alias/checker.cjs', dependencyTree, aliasScope));
    assert.doesNotThrow(() => verify('node checker.cjs', base, {...strategy,allowedChangePaths:['consumer.cjs','checker.cjs.js']}));
    const directoryScope = {...strategy,allowedChangePaths:['consumer.cjs','checker.cjs','checker.cjs/index.js']};
    assert.doesNotThrow(() => assertVerificationScopeFeasible(base, {
        checks:[{id:'check',command:'node checker.cjs',fixturePaths:[],expectationPaths:['checker.cjs/index.js']}],
        requiredPaths:[],reviewRoles:[],
    },new Set(),[directoryScope]));
});
async function world(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-scope-evidence-'))),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=1;\n');await fs.writeFile(path.join(source,'owner.txt'),'fixed expectations\n');const base=await freeze(source,path.join(root,'base'),{});await fs.writeFile(path.join(source,'consumer.cjs'),'module.exports=2;\n');const candidate=await freeze(source,path.join(root,'candidate'),{});let passed=false;t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained '+root)});return{root,source,base:{id:'B',hash:base.digest,data:{manifest:base.manifest}},candidate:{id:'C',hash:candidate.digest,data:{manifest:candidate.manifest}},pass(){passed=true}}}
test('actual complete captured manifests satisfy exact allowed scope and reject a valid normalized adverse input without changing files',async t=>{const f=await world(t);const before=await fs.readFile(path.join(f.source,'owner.txt'));const receipt=manifestScopeEvidence(f.base,f.candidate,strategy,{epoch:1});assert.equal(receipt.actual.satisfied,true);assert.equal(receipt.actual.changedCount,1);assert.equal(receipt.adverse.path,'owner.txt');assert.equal(receipt.adverse.observation.satisfied,false);assert.match(receipt.adverse.derivation,/normalized.*executable/);assert.deepEqual(await fs.readFile(path.join(f.source,'owner.txt')),before);assert.equal(receipt.strategyDigest,hash(strategy));f.pass()});
for(const [name,mutate]of [['SHA',m=>m.files.find(x=>x.path==='owner.txt').sha256='a'.repeat(64)],['exec',m=>{const f=m.files.find(x=>x.path==='owner.txt');f.mode^=0o100;f.effectiveMode=0o600|(f.mode&0o111)}],['delete',m=>{const f=m.files.find(x=>x.path==='owner.txt');m.files=m.files.filter(x=>x!==f);m.entries--;m.bytes-=f.size}],['directory',m=>{m.directories.push({path:'unexpected',mode:0o700,effectiveMode:0o700});m.entries++}]])test('scope consumer observes forbidden '+name+' changes on complete manifests',async t=>{const f=await world(t);const candidate=structuredClone(f.candidate);mutate(candidate.data.manifest);candidate.hash=hash(effective(candidate.data.manifest));const receipt=manifestScopeEvidence(f.base,candidate,strategy,{epoch:1});assert.equal(receipt.actual.satisfied,false);assert.ok(receipt.actual.violationCount>0);f.pass()});
test('unknown normalization, partial census, wrong digest and unsafe/overlapping operands refuse rather than infer complete scope',async t=>{const f=await world(t);for(const mutate of [x=>x.data.manifest.normalization='unknown',x=>x.data.manifest.files.pop(),x=>x.hash='0'.repeat(64),x=>x.data.manifest.directories.push({path:'../foreign',mode:0o700,effectiveMode:0o700})]){const bad=structuredClone(f.candidate);mutate(bad);assert.throws(()=>manifestScopeEvidence(f.base,bad,strategy,{}));}assert.throws(()=>manifestScopeEvidence(f.base,f.candidate,{...strategy,allowedChangePaths:['owner.txt']},{}),/overlap/);assert.throws(()=>manifestScopeEvidence(f.base,f.candidate,{...strategy,allowedChangePaths:['../foreign']},{}),/relative/);f.pass()});
test('a full configured entry profile uses a valid bounded adverse counterexample when every existing file is allowed',async t=>{const f=await world(t);const all={...strategy,allowedChangePaths:['consumer.cjs','owner.txt'],unchangedPaths:[]};const receipt=manifestScopeEvidence(f.base,f.candidate,all,{}, {maxEntries:2,maxBytes:1000});assert.equal(receipt.actual.satisfied,true);assert.equal(receipt.adverse.observation.satisfied,false);assert.match(receipt.adverse.derivation,/complete virtual minimal counterexample/);assert.equal(receipt.captureLimits.maxEntries,2);f.pass()});

test('the actual comparison names whole violating entries without modifying its original evidence',async t=>{
    const f=await world(t),candidate=structuredClone(f.candidate),manifest=candidate.data.manifest;
    const removed=manifest.files.find(file=>file.path==='owner.txt');
    manifest.files=manifest.files.filter(file=>file!==removed);manifest.bytes-=removed.size;manifest.entries--;
    const additions=['a','b','c','d','e','한'.repeat(80)];
    for(const added of additions){manifest.directories.push({path:added,mode:0o700,effectiveMode:0o700});manifest.entries++;}
    candidate.hash=hash(effective(manifest));
    const result=manifestScopeComparison(f.base,candidate,strategy,{});
    assert.deepEqual(result.evidence,manifestScopeEvidence(f.base,candidate,strategy,{}));
    assert.equal(result.evidence.actual.violationCount,7);
    assert.deepEqual(result.violationSample,{entries:additions.slice(0,4).map(path=>({path,before:'absent',after:'directory',reason:'outside-scope'})),omitted:3});
    assert.equal(result.evidence.actual.violationDigest,hash([...additions,'owner.txt'].sort()));
    const protectedOnly=manifestScopeComparison(f.base,candidate,{...strategy,allowedChangePaths:[...strategy.allowedChangePaths,...additions]},{});
    assert.deepEqual(protectedOnly.violationSample,{entries:[{path:'owner.txt',before:'file',after:'absent',reason:'protected-missing'}],omitted:0});
    const longOnly=manifestScopeComparison(f.base,candidate,{...strategy,unchangedPaths:[],allowedChangePaths:[...strategy.allowedChangePaths,...additions.slice(0,-1),'owner.txt']},{});
    assert.deepEqual(longOnly.violationSample,{entries:[],omitted:1});
    f.pass();
});
