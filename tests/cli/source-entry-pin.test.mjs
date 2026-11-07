import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
const execute=promisify(execFile);
const entry=path.resolve('dist/cli/entry.js');

for(const aliasName of ['gitjig','실행 alias.js']) for(const flags of [[],['--preserve-symlinks-main'],['--preserve-symlinks-main','--preserve-symlinks']])test('public source entry resolves '+aliasName+' with Node flags '+flags.join(' '),async t=>{
 const root=await temporaryDirectory('source-entry-pin');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const alias=path.join(root,aliasName);await fs.symlink(entry,alias);
 const {stdout}=await execute(process.execPath,[...flags,alias,'--version'],{env:{PATH:path.dirname(process.execPath),HOME:root,TMPDIR:root},timeout:5000});
 assert.equal(JSON.parse(stdout).application,'gitjig');
 assert.deepEqual((await fs.readdir(root)).sort(),[aliasName]);
});

test('a switched active alias cannot redirect a pinned entry or its later imports',async t=>{
 const root=await temporaryDirectory('source-entry-switch');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({type:'module'}));
 const versions=['original','replacement'].map(name=>path.join(root,name));
 for(const [index,version] of versions.entries()) {
  await fs.mkdir(version);await fs.copyFile(entry,path.join(version,'entry.js'));
  await fs.writeFile(path.join(version,'source-entry.js'),"await import('./late.js');");
  await fs.writeFile(path.join(version,'late.js'),`console.log(${JSON.stringify(index===0?'ORIGINAL_PAYLOAD':'REPLACEMENT_PAYLOAD')});`);
 }
 const active=path.join(root,'active');await fs.symlink(versions[0],active);
 const hook=path.join(root,'switch.mjs');await fs.writeFile(hook,`import {registerHooks} from 'node:module';import fs from 'node:fs';
 registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(specifier.endsWith('/source-entry.js')){fs.unlinkSync(${JSON.stringify(active)});fs.symlinkSync(${JSON.stringify(versions[1])},${JSON.stringify(active)});}return result;}});`);
 const {stdout}=await execute(process.execPath,['--preserve-symlinks-main','--preserve-symlinks','--import',hook,path.join(active,'entry.js')],{env:{HOME:root,PATH:path.dirname(process.execPath)},timeout:5000});
 assert.equal(stdout.trim(),'ORIGINAL_PAYLOAD');assert.equal(await fs.realpath(active),versions[1]);
});
