import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {freeze} from '../../dist/controller/change-files.js';
import {inspectSourceCapture,assertSourceCapture,parseSourceOids,parseSourceTree,sourceContextRelation} from '../../dist/effects/source-snapshot-projection.js';

for (const format of ['sha1','sha256']) {
    test(format+' ordered object framing accepts repeated identities but refuses missing/extra/malformed frames', () => {
        const oid='a'.repeat(format==='sha1'?40:64);
        assert.deepEqual(parseSourceOids(Buffer.from(`${oid}\n${oid}\n`),2,format),[oid,oid]);
        for (const value of [oid,`${oid}\n`,`${oid}\n${oid}\n${oid}\n`,`${oid}\r\n${oid}\n`,`unknown\n${oid}\n`])
            assert.throws(()=>parseSourceOids(Buffer.from(value),2,format));
    });
    test(format+' all-tree metadata distinguishes empty root and unsupported explicit empty subtree', () => {
        const oid='b'.repeat(format==='sha1'?40:64);
        assert.deepEqual(parseSourceTree(Buffer.alloc(0),format,10),[]);
        assert.throws(()=>parseSourceTree(Buffer.from(`040000 tree ${oid}       -\tempty\0`),format,10),/empty/);
        const leaf=`100644 blob ${oid}       3\ta/file\0`;
        assert.equal(parseSourceTree(Buffer.from(`040000 tree ${oid}       -\ta\0${leaf}`),format,10)[0].path,'a/file');
        for(const frame of [leaf.slice(0,-1),leaf+leaf,`100644 commit ${oid}       3\ta\0`,`100644 blob ${oid}       3\t../a\0`])
            assert.throws(()=>parseSourceTree(Buffer.from(frame),format,10));
    });
}

async function captured(t) {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-source-relation-')));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const source=path.join(root,'source');await fs.mkdir(source,{mode:0o700});
    await fs.mkdir(path.join(source,'empty'),{mode:0o700});
    await fs.writeFile(path.join(source,'script'),Buffer.concat([Buffer.alloc(65535,97),Buffer.from('한글\n')]));
    await fs.chmod(path.join(source,'script'),0o700);
    const frozen=await freeze(source,path.join(root,'capture'),{});
    return{root,input:{versionId:'original',root:path.join(root,'capture'),...frozen}};
}
test('full capture checks streaming UTF8, exact owner-only executable mask and empty-directory type',async t=>{
    const f=await captured(t),signal=new AbortController().signal;
    const actual=await inspectSourceCapture(f.input,100,1024*1024,signal);
    assert.equal(actual.files.get('script').opaque,false);
    assert.equal(actual.files.get('script').effectiveMode,0o700);
    await fs.chmod(path.join(f.input.root,'script'),0o711);
    await assert.rejects(assertSourceCapture(actual,signal),/changed/);
    await assert.rejects(inspectSourceCapture(f.input,100,1024*1024,signal),/mode/);
    await fs.chmod(path.join(f.input.root,'script'),0o700);
    await fs.rmdir(path.join(f.input.root,'empty'));await fs.writeFile(path.join(f.input.root,'empty'),'not a directory');
    await assert.rejects(inspectSourceCapture(f.input,100,1024*1024,signal),/directory/);
});
test('retained private namespace and exact C execution mask distinguish identity, product difference and ancestor conflict',()=>{
    const file=(name,mode=0o600)=>({path:name,effectiveMode:mode,sha256:'raw',size:3});
    const candidate={manifest:{files:[file('code',0o700),file('private.env')],directories:[{path:'private-cache'}],dependencyLinks:[]}};
    const h=[{path:'code',mode:'100755',type:'blob',size:3,objectId:'oid'}];
    assert.equal(sourceContextRelation(candidate,new Set(['code']),h,new Map([['code','oid']])).kind,'identical');
    assert.equal(sourceContextRelation(candidate,new Set(['code']),[{...h[0],mode:'100644'}],new Map([['code','oid']])).kind,'nonidentity');
    assert.equal(sourceContextRelation(candidate,new Set(['private-cache']),[{...h[0],path:'private-cache'}],new Map()).kind,'structural-conflict');
    assert.equal(sourceContextRelation(candidate,new Set(['private.env/file']),[{...h[0],path:'private.env/file'}],new Map()).kind,'structural-conflict');
    assert.throws(()=>sourceContextRelation(candidate,new Set(['code']),[{...h[0],path:'unconsented'}],new Map()),/outside/);
});

test('publication baseline classification keeps original S provenance and derives whole additions/deletions only from actual product/K',async()=>{
    const {sourcePublicationBaseline}=await import('../../dist/effects/source-snapshot-projection.js');
    const blob=(side,name,mode=0o600)=>({side,path:name,objectId:side+'-'+name,sha256:'raw-'+side+'-'+name,size:17,effectiveMode:mode});
    const originals=[blob('base','tracked'),blob('candidate','tracked'),blob('base','edited'),blob('candidate','edited'),
        blob('candidate','fresh'),blob('base','deleted'),blob('base','mode'),blob('candidate','mode',0o700),blob('base','unused'),blob('candidate','unused')];
    const before=structuredClone(originals);
    const result=sourcePublicationBaseline(new Set(['tracked','edited','fresh','deleted','mode']),new Set(['tracked']),originals);
    assert.deepEqual([...result.omittedBasePaths],['deleted','edited','fresh','mode']);
    assert.deepEqual(result.wholeFileAdditions.map(row=>[row.path,row.capturedBasePresent,row.effectiveMode]),[
        ['edited',true,0o600],['fresh',false,0o600],['mode',true,0o700]]);
    assert.equal(result.wholeFileAdditions[0].baseBlob,'base-edited');
    assert.equal(result.wholeFileAdditions[0].baseSha256,'raw-base-edited');
    assert.equal(result.wholeFileAdditions[0].candidateSha256,'raw-candidate-edited');
    assert.deepEqual(originals,before);
});
