/** Actual captured @file input and original SDK/Controller. Physical execution scope is controlled. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{registerHooks}from'node:module';import{pathToFileURL}from'node:url';import{randomUUID}from'node:crypto';
import{temporaryDirectory}from'../helpers/temporary-directory.mjs';import{scripted}from'./effect-fixture.mjs';
const root=await temporaryDirectory('request-limit-context'),home=path.join(root,'home'),project=path.join(root,'project'),shim=path.join(root,'scope.mjs');
await fs.mkdir(project);await fs.writeFile(path.join(project,'context.txt'),'Immutable captured file bytes.\n');
const containerScope = new URL('../../dist/execution/container-scope.js',import.meta.url).href;
await fs.writeFile(shim,`export {RuntimeHelperUnavailableError} from ${JSON.stringify(containerScope)};
export async function createScope(options){return globalThis.__limitContextScope(options)}`);
registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/controller/ordinary.js')&&specifier.endsWith('/execution/container-scope.js'))return{url:pathToFileURL(shim).href,shortCircuit:true};return next(specifier,context);}});
const scopes=[];globalThis.__limitContextScope=async options=>{const deny=()=>assert.fail('No engine or project execution in request-limit context fixture');const scope={containerId:'controlled-'+randomUUID(),workspaceRoot:options.workRoot,validatePath:p=>{const full=path.resolve(options.workRoot,p);assert.ok(full===options.workRoot||full.startsWith(options.workRoot+path.sep));return full;},readFile:p=>fs.readFile(path.resolve(options.workRoot,p),'utf8'),access:async()=>{},exec:deny,writeFile:deny,mkdir:deny,closed:false,async close(){scope.closed=true;return{state:'removed'};}};scopes.push(scope);return scope;};
const{openController}=await import('../../dist/controller/index.js');
test('file context and escaped at-signs retain their exact original source on current and cold limit diagnostics',async t=>{
 const runtimeProfile={dockerBinary:process.execPath,dockerContext:'CONTROLLED_NO_ENGINE',image:'sha256:'+'a'.repeat(64)},oldTmp=process.env.TMPDIR;process.env.TMPDIR=path.join(home,'artifacts');let c=await openController({installationHome:home,runtimeProfile,maxProviderRequests:16}),passed=false;
 t.after(async()=>{await c.close();delete globalThis.__limitContextScope;if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;assert.ok(scopes.every(scope=>scope.closed));if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained request-limit file context '+root);});
 await c.registerProject({id:'P',sourceRoot:project});const cid=c.createConversation({projectId:'P'}).conversationId;
 const receipt=await c.queueConversationInputWithContext({conversationId:cid,expectedGeneration:0,text:'Check @context.txt and @@literal without changing either.',mode:'idle'});
 let calls=0;const model=scripted(()=>{calls++;return{tool:{name:'conversation_status',arguments:{}}};});model.provider='file-context-limit';model.definition.api='file-context-limit-api';
 const result=await c.runConversation({conversationId:cid,model});assert.equal(calls,16);assert.deepEqual(result.requestLimit,{limit:16});assert.equal(result.status,'unavailable');
 const input=c.store.one('SELECT * FROM conversation_inputs WHERE id=?',receipt.inputId),source=c.store.one('SELECT raw FROM sources WHERE id=?',input.source);assert.notEqual(source.raw,input.text);assert.equal(JSON.parse(input.data).context.files.length,1);
 const before=c.store.all('SELECT * FROM runs ORDER BY rowid'),view=c.inspectConversationRequestFailure(cid);assert.ok(view);assert.deepEqual(c.store.all('SELECT * FROM runs ORDER BY rowid'),before);
 await c.close();c=await openController({installationHome:home,runtimeProfile,maxProviderRequests:16});assert.deepEqual(c.inspectConversationRequestFailure(cid),view);assert.equal(await fs.readFile(path.join(project,'context.txt'),'utf8'),'Immutable captured file bytes.\n');passed=true;
});
