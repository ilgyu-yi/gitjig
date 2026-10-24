// Original prepared editor and native helpers; all tools and homes are owned fixtures.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {openController} from '../../dist/controller/index.js';import {ApplicationStartup} from '../../dist/app/startup.js';import {editRuntimeFields} from '../../dist/ui/runtime-fields.js';
import {prepareColima,interactiveSetup,runCommand} from '../../runtime/setup.mjs';
const image='sha256:'+'a'.repeat(64);
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/contextual-recovery-case-'))),config=path.join(root,'docker'),tools=path.join(root,'tools'),owner=path.join(root,'owner');for(const dir of [config,tools,owner])await fs.mkdir(dir,{mode:0o700});const calls=path.join(root,'calls');
 const binary=path.join(tools,'docker');await fs.writeFile(binary,'#!'+process.execPath+'\n'+`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');console.error('OWNED_RECOVERY_FAILURE');process.exit(1);`,{mode:0o700});
 const c=await openController({installationHome:path.join(root,'app')}),startup=ApplicationStartup.open(c);await startup.save({version:1,runtime:{dockerBinary:binary,dockerConfigDirectory:config,dockerContext:'owned',image}});const saved=await fs.readFile(path.join(root,'app/config/startup.json'),'utf8');let passed=false;t.after(async()=>{await c.close();if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained contextual case '+root);});return{root,config,tools,owner,c,startup,binary,calls,saved,pass(){passed=true;}};}
for(const action of ['Interactive runtime installer','Prepare an execution image','Check runtime connection and image'])test(action+' failure offers direct field repair and preserves staged/saved inputs',async t=>{
 const f=await fixture(t),edit=await f.startup.prepareRuntimeEdit(),seen=[];let opened=false,correcting=false,inputs=0;
 // D1 frontend boundary: an ordinary preparation failure, using the original edit for recovery.
 if(action==='Interactive runtime installer')edit.prepareInteractive=async()=>{throw Error('Owned preparation prerequisite failure');};
 const result=await editRuntimeFields({guard(){},notice(){},show:async()=>{},input:async(_title,value)=>{assert.ok(correcting);inputs++;return value;},runPreparation:async(_title,task)=>task(new AbortController().signal,()=>{}),
 choose:async(title,labels)=>{seen.push({title,labels});if(title==='Choose a recovery action'){assert.equal(labels[0],'Back to runtime setup');assert.ok(labels.includes('Edit runtime fields'));correcting=true;return 'Edit runtime fields';}if(title.startsWith('Runtime setup')){if(opened)return'Cancel';opened=true;return action;}if(title==='Build execution image?')return'Build execution image';if(title==='Check selected runtime?')return'Check connection and image';throw Error(title);}},edit);
 assert.equal(result,'cancelled');assert.equal(inputs,4);assert.equal(await fs.readFile(path.join(f.root,'app/config/startup.json'),'utf8'),f.saved);assert.ok(seen.some(row=>row.title==='Choose a recovery action'));for(const table of ['works','runs','conversation_inputs'])assert.equal(f.c.store.one('SELECT COUNT(*) n FROM '+table).n,0);f.pass();
});
test('recovery choice source drift cannot open an old form',async t=>{
 const f=await fixture(t),edit=await f.startup.prepareRuntimeEdit();let opened=false;
 await assert.rejects(editRuntimeFields({guard(){},notice(){},show:async()=>{},input:async()=>assert.fail('Stale recovery opened input'),runPreparation:async(_title,task)=>task(new AbortController().signal,()=>{}),choose:async(title)=>{if(title.startsWith('Runtime setup')){assert.ok(!opened);opened=true;return'Check runtime connection and image';}if(title==='Check selected runtime?')return'Check connection and image';if(title==='Choose a recovery action'){await fs.appendFile(path.join(f.root,'app/config/startup.json'),'\n');return'Edit runtime fields';}throw Error(title);}},edit),/changed while editing/);f.pass();
});
test('Colima start retry repeats only the failed native command, preserving completed packages',async t=>{
 const f=await fixture(t),receipt=path.join(f.root,'phase-calls'),prefix=path.join(f.root,'prefix');await fs.mkdir(path.join(prefix,'bin'),{recursive:true});await fs.mkdir(path.join(prefix,'opt/docker-buildx/bin'),{recursive:true});
 const tool=async(name,body)=>{const file=path.join(prefix,name);await fs.writeFile(file,'#!'+process.execPath+'\n'+body,{mode:0o700});return file;};
 const brew=await tool('bin/brew',`import fs from 'node:fs';const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(receipt)},JSON.stringify(['brew',...a])+'\\n');if(a[0]==='--prefix')console.log(${JSON.stringify(prefix)});`);
 await tool('bin/docker','');await tool('opt/docker-buildx/bin/docker-buildx','');const colima=await tool('bin/colima',`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(receipt)},JSON.stringify(['colima',...process.argv.slice(2)])+'\\n');const f=${JSON.stringify(path.join(f.root,'started-once'))};if(!fs.existsSync(f)){fs.writeFileSync(f,'once');process.exit(1);}`);
 let retries=0;const result=await prepareColima({brewBinary:brew,installPackages:true,profile:'owned'},{ownerHome:f.owner,retryCommand:async(title)=>{assert.match(title,/Start Colima profile owned/);retries++;return true;}});
 assert.equal(result.dockerContext,'colima-owned');assert.equal(retries,1);const calls=(await fs.readFile(receipt,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(a=>a.slice(0,2)),[['brew','install'],['brew','--prefix'],['colima','start'],['colima','start']]);assert.ok(calls.slice(2).every(a=>a.includes('--activate=false')));f.pass();
});
test('phase retry refuses changed executable and never offers unknown or cancelled native retry',async t=>{
 const f=await fixture(t);const colima=path.join(f.tools,'colima');await fs.copyFile(f.binary,colima);let retries=0;
 await assert.rejects(prepareColima({dockerBinary:f.binary,colimaBinary:colima,profile:'owned'},{ownerHome:f.owner,retryCommand:async()=>{retries++;await fs.appendFile(colima,'\n');return true;}}),/executable changed/);assert.equal(retries,1);
 for(const code of ['RUNTIME_PREPARATION_CLEANUP_UNKNOWN','RUNTIME_PREPARATION_CANCELLED'])await assert.rejects(prepareColima({dockerBinary:f.binary,colimaBinary:colima,profile:'owned'},{ownerHome:f.owner,execute:async()=>{throw Object.assign(Error('Owned stop'),{code});},retryCommand:async()=>assert.fail('Unsafe retry offered')}),e=>e.code===code);f.pass();
});
test('missing Homebrew can switch directly to reviewed existing Docker without provisioning',async t=>{
 const f=await fixture(t),prior={HOME:process.env.HOME,PATH:process.env.PATH};process.env.HOME=f.owner;process.env.PATH=f.tools;const answers=['2',f.binary,f.config,'owned','n','n'];const labels=[];
 try{const result=await interactiveSetup({initialRuntime:{dockerBinary:f.binary,dockerConfigDirectory:f.config,dockerContext:'owned'},ask:async()=>answers.shift(),choose:async(_title,choices)=>{labels.push(choices);return'Use existing Docker backend';},output(){}});assert.equal(result,undefined);assert.equal(answers.length,0);assert.ok(labels[0].includes('Finish without saving'));await assert.rejects(fs.access(f.calls));}finally{for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}f.pass();
});

test('execute-time path refusal propagates without a native command or recovery prompt',async t=>{
 const f=await fixture(t);for(const name of ['brew','colima'])await fs.copyFile(f.binary,path.join(f.tools,name));const prior={HOME:process.env.HOME,PATH:process.env.PATH};process.env.HOME=f.owner;process.env.PATH=f.tools;let executing=false;const answers=['2','y','owned','y'];
 try {await assert.rejects(interactiveSetup({ask:async()=>answers.shift(),choose:async()=>assert.fail('Path safety refusal offered retry'),output(){},checkPath(file){if(executing&&file===path.join(f.tools,'brew'))throw Error('Owned dispatch path refusal');},execute:async(file,args,options)=>{executing=true;return runCommand(file,args,options);}}),/Owned dispatch path refusal/);await assert.rejects(fs.access(f.calls));}
 finally{for(const[key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}f.pass();
});
test('failed start retry rechecks nested Colima storage aliases before another launch',async t=>{
 const f=await fixture(t),project=path.join(f.root,'project');await fs.mkdir(project);await f.c.registerProject({id:'P',sourceRoot:project});const edit=await f.startup.prepareRuntimeEdit(),colima=path.join(f.tools,'colima');await fs.copyFile(f.binary,colima);let retries=0;
 await assert.rejects(prepareColima({dockerBinary:f.binary,colimaBinary:colima,profile:'owned'},{ownerHome:f.owner,checkPath:edit.checkPath,guard:edit.assertCurrent,retryCommand:async()=>{retries++;await fs.symlink(project,path.join(f.owner,'.colima/_lima'));return true;}}),/disjoint|project|overlap/);
 assert.equal(retries,1);assert.equal((await fs.readFile(f.calls,'utf8')).trim().split('\n').length,1);f.pass();
});
