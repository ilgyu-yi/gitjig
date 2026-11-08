import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
const root=await temporaryDirectory('recorded-result-project'),shim=path.join(root,'scope.mjs'),scopes=[];
await fs.writeFile(shim,`export {RuntimeHelperUnavailableError} from ${JSON.stringify(new URL('../../dist/execution/container-scope.js',import.meta.url).href)};
export async function createScope(options){return globalThis.__recordedResultScope(options)}`);
registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/controller/ordinary.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
globalThis.__recordedResultScope=async options=>{
 const deny=()=>assert.fail('Project-generation display controls cannot execute project code');
 const scope={workspaceRoot:options.workRoot,containerId:'controlled-project',validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;},readFile:p=>fs.readFile(p),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,async close(){scope.closed=true;return{state:'removed'};}};scopes.push(scope);return scope;
};
const {recordedResultWorld}=await import('./recorded-delegated-results-fixture.mjs');
after(async()=>{assert.ok(scopes.length>0&&scopes.every(s=>s.closed));delete globalThis.__recordedResultScope;await fs.rm(root,{recursive:true,force:true});});
test('original result survives real project-generation divergence and later parent project change',async t=>{
 const f=await recordedResultWorld(t,{resultDependency:false,runtimeProfile:{dockerBinary:process.execPath,dockerContext:'controlled',image:'sha256:'+'a'.repeat(64)},async beforeAssignment(f){
  const source=path.join(f.root,'another-project');await fs.mkdir(source);await fs.writeFile(path.join(source,'other.txt'),'Other project');await f.c.registerProject({id:'Q',sourceRoot:source});
  for(const projectId of ['P','Q','P'])f.c.setConversationProject({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,projectId});
 }});
 const assignment=f.c.store.one('SELECT data FROM conversation_assignments WHERE id=?',f.children[0].assignmentId),actor=JSON.parse(assignment.data).source;
 const run=f.c.store.one('SELECT generation FROM runs WHERE id=?',actor.runId);assert.notEqual(actor.generation,run.generation);
 const original=f.c.inspectRecordedDelegatedResults(f.parent);assert.equal(original.entries.length,1);assert.equal(original.unavailable,false);
 await f.c.reclaimConversationResource({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation});
 f.c.setConversationProject({conversationId:f.parent,expectedGeneration:f.c.inspectConversation(f.parent).generation,projectId:'Q'});
 assert.deepEqual(f.c.inspectRecordedDelegatedResults(f.parent),original,'Owner history belongs to the original receiver, not the new parent project/work');f.pass();
});
