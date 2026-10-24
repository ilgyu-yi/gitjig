/** Original SDK command selection through hosted provider/summary options. No native birth or model request. */
import '../normal-hosted/no-external.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {query as sdkQuery} from '@anthropic-ai/claude-agent-sdk';
const entry=import.meta.resolve('@gitjig/pi-claude-bridge-host');
const {BridgeHost}=await import(new URL('./host.js',entry));
const settings={disableAllHooks:true,autoMemoryEnabled:false,syncClaudeAiSkills:false,syncClaudeAiPlugins:false,enabledPlugins:{'agents-md@builtin':false,'bento-slides@bento':false,'drop@drop':false,'plugin-authoring@builtin':false}};
for(const purpose of ['provider','summary'])test(`hosted ${purpose} SDK selects the admitted external executable before native birth`,{timeout:5000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-bridge-executable-'))),executable=path.join(root,'external-native');
    await fs.writeFile(executable,'#!/bin/sh\ntouch "$0.called"\nexit 88\n',{mode:0o700});
    assert.ok(!executable.includes('claude-agent-sdk'),'Selected fixture is separate from the bundled native');
    let host,scope,stream;const calls=[];
    t.after(async()=>{stream?.close();await scope?.close().catch(()=>{});await host?.close();await fs.rm(root,{recursive:true,force:true});});
    host=new BridgeHost({cwd:root,pathToClaudeCodeExecutable:executable,env:{HOME:root,CLAUDE_CONFIG_DIR:root,PATH:'/usr/bin:/bin'},settingSources:[],settings,
        observeNative(){assert.fail('No synthetic native protocol was admitted');},
        spawnNative(input){calls.push({purpose:input.purpose,command:input.options.command});throw Error('OWNED_COMMAND_CAPTURE_ONLY');}});
    host.bind('owned-'+purpose);let captured;
    if(purpose==='summary'){scope=host.openSummaryOperation('owned-'+purpose,new AbortController().signal,async()=>{});captured=(await host.summary('owned-'+purpose)).query;}
    else captured=host.query('owned-'+purpose);
    assert.equal(captured.options().pathToClaudeCodeExecutable,executable);
    await assert.rejects(async()=>{
        stream=sdkQuery({prompt:'This prompt cannot leave the command-capture boundary.',options:{model:'claude-sonnet-4-6',tools:[],maxTurns:1,persistSession:false,...captured.options()}});
        for await(const _message of stream)assert.fail('No native result may exist');
    },/OWNED_COMMAND_CAPTURE_ONLY/);
    assert.deepEqual(calls,[{purpose,command:executable}]);await assert.rejects(fs.stat(executable+'.called'),{code:'ENOENT'});
});
test('host cannot omit its explicit selected executable',()=>{
    assert.throws(()=>new BridgeHost({cwd:'/owned',env:{},settingSources:[],settings,spawnNative(){},observeNative(){}}),/BRIDGE_HOST_OPTIONS_UNAVAILABLE/);
});
