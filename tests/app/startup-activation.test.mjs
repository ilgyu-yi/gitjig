import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {temporaryDirectory} from '../helpers/temporary-directory.mjs';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
const runtime=context=>({dockerBinary:'/usr/bin/false',dockerContext:context,image:'sha256:'+'1'.repeat(64)});
async function fixture(t,prepared,{managementOnly=true}={}){
 const root=await temporaryDirectory('startup-activation'),home=path.join(root,'app');
 const c=await openController({installationHome:home},{managementOnly});
 t.after(async()=>{await c.close();await fs.rm(root,{recursive:true,force:true});});
 return {startup:ApplicationStartup.open(c,prepared),c,file:path.join(home,'config/startup.json')};
}
for(const [name,prepared,saved,expected] of [
 ['same runtime',{configuration:{version:1,runtime:runtime('old')},sources:{runtime:'saved',bridge:'none'}},{version:1,runtime:runtime('old')},{runtime:'current',bridge:'current'}],
 ['runtime replacement',{configuration:{version:1,runtime:runtime('old')},sources:{runtime:'saved',bridge:'none'}},{version:1,runtime:runtime('new')},{runtime:'apply',bridge:'current'}],
 ['runtime addition',{configuration:{version:1},sources:{runtime:'none',bridge:'none'}},{version:1,runtime:runtime('new')},{runtime:'apply',bridge:'current'}],
 ['runtime removal',{configuration:{version:1,runtime:runtime('old')},sources:{runtime:'saved',bridge:'none'}},{version:1},{runtime:'relaunch',bridge:'current'}],
 ['invocation runtime',{configuration:{version:1,runtime:runtime('old')},sources:{runtime:'invocation',bridge:'none'}},{version:1,runtime:runtime('new')},{runtime:'current',bridge:'current'}],
 ['no prepared context',undefined,{version:1,runtime:runtime('new')},{runtime:'unknown',bridge:'unknown'}],
 // The effective bridge is a historical observation, not an executable authority in this management-only fixture.
 ['bridge removal',{configuration:{version:1,bridge:{profile:{kind:'historical'},nativeAccountDirectory:'/historical'}},sources:{runtime:'none',bridge:'saved'}},{version:1},{runtime:'current',bridge:'relaunch'}],
])test('startup activation observes '+name,async t=>{
 const f=await fixture(t,prepared),receipt=await f.startup.save(saved);const before=await fs.readFile(f.file);
 const view=await f.startup.inspect();assert.deepEqual(view.activation,expected);assert.equal(view.restartRequired,Object.values(expected).includes('relaunch'));
 assert.deepEqual(receipt.activation,expected);
 if(expected.runtime==='apply')assert.match(receipt.nextAction,/Apply the saved runtime now with \/setup runtime/);
 if(expected.runtime==='relaunch')assert.match(receipt.nextAction,/Restart to remove the active runtime/);
 if(expected.bridge==='relaunch')assert.match(receipt.nextAction,/Restart to apply the bridge settings/);
 if(expected.runtime==='current'&&expected.bridge==='current')assert.match(receipt.nextAction,/Current startup selections are unchanged/);
 if(expected.runtime==='unknown')assert.match(receipt.nextAction,/Check activation with \/setup inspect/);
 if(!view.restartRequired)assert.doesNotMatch(receipt.nextAction,/restart|relaunch/i);
 assert.deepEqual(await fs.readFile(f.file),before);assert.equal(f.c.store.one('SELECT COUNT(*) n FROM runs').n,0);
});
test('invalid complete settings cannot be masked by invocation runtime',async t=>{
 const f=await fixture(t,{configuration:{version:1,runtime:runtime('old')},sources:{runtime:'invocation',bridge:'none'}});
 await f.startup.save({version:1});await fs.writeFile(f.file,'{"version":1,"bridge":null}');
 const view=await f.startup.inspect();assert.ok(view.diagnostic);assert.deepEqual(view.activation,{runtime:'unknown',bridge:'unknown'});assert.equal(view.restartRequired,false);
});
test('inspection captures effective settings before asynchronous validation',async t=>{
 const prepared={configuration:{version:1,runtime:runtime('old')},sources:{runtime:'saved',bridge:'none'}},f=await fixture(t,prepared);
 await f.startup.save({version:1,runtime:runtime('new')});const original=fs.realpath;let changed=false;
 fs.realpath=async function(...args){if(!changed){changed=true;prepared.configuration={version:1,runtime:runtime('new')};}return original.apply(this,args);};
 try{const view=await f.startup.inspect();assert.equal(changed,true);assert.equal(view.effective.runtime.dockerContext,'old');assert.deepEqual(view.activation,{runtime:'apply',bridge:'current'});}finally{fs.realpath=original;}
});

for(const mode of ['add','replace','both'])test('canonical bridge '+mode+' remains a relaunch while runtime can apply',async t=>{
 const prepared={configuration:{version:1,runtime:runtime('old')},sources:{runtime:'saved',bridge:'none'}},f=await fixture(t,prepared),root=path.dirname(path.dirname(f.file));
 for(const name of ['host','agent','agent/home','account','docker'])await fs.mkdir(path.join(root,name),{recursive:true,mode:0o700});
 const executable=await fs.realpath(process.execPath),bridge={profile:{kind:'installed-claude-bridge',cwd:path.join(root,'host'),agentDir:path.join(root,'agent'),executable:{file:executable,sha256:createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},nativeAccountDirectory:path.join(root,'account')};
 await fs.writeFile(path.join(root,'agent/claude-bridge.json'),JSON.stringify({askClaude:{enabled:false},provider:{strictMcpConfig:true,autoMemoryEnabled:false}}),{mode:0o600});
 const selected={...runtime('old'),dockerConfigDirectory:path.join(root,'docker')};prepared.configuration.runtime=selected;
 if(mode==='replace'){prepared.configuration.bridge={...bridge,nativeAccountDirectory:'/historical'};prepared.sources.bridge='saved';}
 const receipt=await f.startup.save({version:1,runtime:mode==='both'?{...selected,dockerContext:'new'}:selected,bridge});
 const view=await f.startup.inspect();assert.deepEqual(view.activation,{runtime:mode==='both'?'apply':'current',bridge:'relaunch'});assert.equal(view.restartRequired,true);
 assert.match(receipt.nextAction,/Restart to apply the bridge settings/);
 assert.equal(receipt.nextAction.includes('/setup runtime'),mode==='both');
});
test('absent saved file is valid empty intent, not unknown activation',async t=>{
 const f=await fixture(t,{configuration:{version:1},sources:{runtime:'none',bridge:'none'}});
 assert.deepEqual((await f.startup.inspect()).activation,{runtime:'current',bridge:'current'});
});

test('startup rechecks both file presence and safety before a prepared save', async t => {
    const f = await fixture(t, {configuration:{version:1}, sources:{runtime:'none',bridge:'none'}});
    const absent = await f.startup.prepareEdit();
    await fs.mkdir(path.dirname(f.file), {mode:0o700});
    await fs.writeFile(f.file, '', {mode:0o600});
    await assert.rejects(absent.save({version:1}), /Saved startup changed/);
    assert.match((await f.startup.inspect()).diagnostic, /requires repair/);

    const repair = await f.startup.prepareEdit();
    await fs.chmod(f.file, 0o644);
    await assert.rejects(repair.save({version:1}), /Unsafe or oversized/);
    assert.equal(await fs.readFile(f.file, 'utf8'), '');
    await fs.chmod(f.file, 0o600);
    await (await f.startup.prepareEdit()).save({version:1});
    assert.deepEqual((await f.startup.inspect()).saved, {version:1});
});

for (const scenario of ['bridge host inside project','account contains project','runtime inside execution storage']) test(
    'startup inspection reports validated overlap for '+scenario, async t=>{
        const f=await fixture(t,undefined,{managementOnly:false}), home=path.dirname(path.dirname(f.file)), root=path.dirname(home);
        const account=path.join(root,'account'), agent=path.join(root,'agent');
        const project=scenario==='account contains project'?path.join(account,'project'):path.join(root,'project\u009b');
        const host=scenario==='bridge host inside project'?path.join(project,'host'):path.join(root,'host');
        const runtimeDirectory=path.join(home,'inputs','docker');
        for(const directory of [project,host,path.join(agent,'home'),account,runtimeDirectory])
            await fs.mkdir(directory,{recursive:true,mode:0o700});
        await f.c.registerProject({id:'P',sourceRoot:project});
        await f.startup.save({version:1});
        const saved=scenario==='runtime inside execution storage'
            ? {version:1,runtime:{...runtime('owned'),dockerConfigDirectory:runtimeDirectory}}
            : {version:1,bridge:{profile:{kind:'installed-claude-bridge',cwd:host,agentDir:agent,
                executable:{file:'/usr/bin/false',sha256:'0'.repeat(64)}},nativeAccountDirectory:account}};
        // Installed fixture has neither a matching executable pin nor a policy file.
        await fs.writeFile(f.file,JSON.stringify(saved));
        const view=await f.startup.inspect();
        const [field, authority, scope, protectedRoot]=scenario==='runtime inside execution storage'
            ? ['runtime.dockerConfigDirectory',runtimeDirectory,'application execution storage',path.join(home,'inputs')]
            : [scenario==='account contains project'?'bridge.nativeAccountDirectory':'bridge.profile.cwd',
                scenario==='account contains project'?account:host,'registered project',project];
        const quote=value=>JSON.stringify(value).replaceAll('\u009b','\\u009b');
        assert.equal(view.diagnostic,`Startup authority overlap: ${field} ${quote(authority)} overlaps ${scope} ${quote(protectedRoot)}`);
        assert.equal(view.saved,null);
        assert.deepEqual(view.activation,{runtime:'unknown',bridge:'unknown'});
        assert.equal(await fs.readFile(f.file,'utf8'),JSON.stringify(saved));
    });
