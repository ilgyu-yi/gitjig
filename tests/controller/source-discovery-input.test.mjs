import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sources} from '../../dist/controller/change-files.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('large captured source collection packs optional seeds but preserves mandatory source',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'source-discovery-input-'));
 try{
  const files=[];
  for(let i=0;i<96;i++){
   const name='context-'+String(i).padStart(3,'0')+'.txt',bytes=Buffer.from(String(i).padEnd(16384,'x'));
   await fs.writeFile(path.join(root,name),bytes);files.push({path:name,sha256:hash(bytes),size:bytes.length});
  }
  const version={id:'B1',artifact:root,hash:'fixture',data:{manifest:{files}}};
  const selected=await sources(version,'base');assert.ok(selected.length>0&&selected.length<96);
  assert.ok(selected.reduce((sum,s)=>sum+Buffer.byteLength(s.content),0)<=1024*1024);
  const mandatory=await sources(version,'base',['context-095.txt'],true);assert.deepEqual(mandatory.map(s=>s.path),['context-095.txt']);
  const priority=await sources(version,'base',['context-095.txt'],false,20000);assert.equal(priority[0].path,'context-095.txt');assert.equal(priority.length,1);
  const bytes=Buffer.alloc(1024*1024+1,65);await fs.writeFile(path.join(root,'large.txt'),bytes);version.data.manifest.files.push({path:'large.txt',sha256:hash(bytes),size:bytes.length});
  await assert.rejects(sources(version,'base',['large.txt'],true),/exceeds1MiB/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
