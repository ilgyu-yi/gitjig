import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('actual native terminal prunes many completed background children without another selection',{timeout:20000},async t=>{
 await fs.mkdir('.runtime-fixtures',{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ui-cache-'))),home=path.join(root,'home');
 const {openController}=await import('../../dist/controller/index.js');const setup=await openController({installationHome:home});await setup.close();const receipt=path.join(root,'receipt.json'),childConfig=path.join(root,'child.json'),driverConfig=path.join(root,'driver.json');
 await fs.writeFile(childConfig,JSON.stringify({home,receipt}));
 await fs.writeFile(driverConfig,JSON.stringify({input:'Owner root input',marker:'CACHE_BACKGROUND_FINISHED',artifacts:path.join(home,'artifacts'),output:path.join(root,'terminal.bin'),command:[process.execPath,path.resolve('tests/ui/cache-pty-child.mjs'),childConfig]}));
 try{const actual=JSON.parse((await exec('python3',[path.resolve('tests/cli/conversation-pty.py'),driverConfig],{timeout:17000,maxBuffer:1024*1024})).stdout);assert.equal(actual.exitCode,0,JSON.stringify(actual));assert.equal(actual.terminalRestored,true);const observed=JSON.parse(await fs.readFile(receipt,'utf8'));assert.equal(observed.children.length,7);assert.ok(observed.children.every(child=>child.state==='IDLE'&&child.status==='delivered'));assert.equal(observed.allHistories,true);assert.ok(observed.finalCache.conversationIds.includes(observed.primary));assert.ok(observed.finalCache.conversationIds.length<=observed.finalCache.limit,JSON.stringify(observed));assert.ok(observed.observed>=7);t.diagnostic(JSON.stringify({...actual,...observed,retainedFixture:root}));}catch(error){t.diagnostic('Cache fixture retained: '+root);throw error;}
});

test('configured idle grace expires completed background presentation caches without human selection',{timeout:20000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/ui-grace-'))),home=path.join(root,'home');
 const {openController}=await import('../../dist/controller/index.js');const setup=await openController({installationHome:home});await setup.close();const receipt=path.join(root,'receipt.json'),childConfig=path.join(root,'child.json'),driverConfig=path.join(root,'driver.json');
 await fs.writeFile(childConfig,JSON.stringify({home,receipt,retention:{completedLimit:10,idleGraceMs:40}}));
 await fs.writeFile(driverConfig,JSON.stringify({input:'Owner retention control',marker:'CACHE_BACKGROUND_FINISHED',artifacts:path.join(home,'artifacts'),output:path.join(root,'terminal.bin'),command:[process.execPath,path.resolve('tests/ui/cache-pty-child.mjs'),childConfig]}));
 try{const actual=JSON.parse((await exec('python3',[path.resolve('tests/cli/conversation-pty.py'),driverConfig],{timeout:17000,maxBuffer:1024*1024})).stdout);assert.equal(actual.exitCode,0);assert.equal(actual.terminalRestored,true);const observed=JSON.parse(await fs.readFile(receipt,'utf8'));assert.deepEqual(observed.finalCache.conversationIds,[observed.primary]);assert.equal(observed.finalCache.limit,10);assert.equal(observed.allHistories,true);t.diagnostic(JSON.stringify({actual,observed,retainedFixture:root}));}catch(error){t.diagnostic('Grace fixture retained: '+root);throw error;}
});
