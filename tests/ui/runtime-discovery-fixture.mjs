import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {dockerContextInspection} from '../helpers/docker-context-inspection.mjs';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';
import {ApplicationSettings} from '../../dist/app/settings.js';
export const image='sha256:'+'1'.repeat(64);
export const untaggedImage='sha256:'+'2'.repeat(64);
export const imageListArgs=(config, dangling=false)=>['--config',config,'--context','owned','image','ls','--no-trunc','--format','{{json .}}',...(dangling?['--filter','dangling=true']:[])];
export const markerListArgs=config=>['--config',config,'--context','owned','image','ls','--all','--no-trunc','--quiet','--filter','label=io.gitjig.runtime.recipe=1'];
export async function discoveryFixture(t){
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-runtime-discovery-'))),binary=path.join(root,'docker-fixture'),config=path.join(root,'docker-config'),calls=path.join(root,'calls'),mode=path.join(root,'mode'),held=path.join(root,'held');
    await fs.mkdir(config,{mode:0o700});await fs.writeFile(mode,'normal',{mode:0o600});await fs.writeFile(calls,'',{mode:0o600});
    await fs.writeFile(binary,'#!'+process.execPath+'\n'+`
import fs from 'node:fs';import {spawn} from 'node:child_process';
const root=${JSON.stringify(root)},args=process.argv.slice(2),mode=fs.readFileSync(root+'/mode','utf8');
fs.appendFileSync(root+'/calls',JSON.stringify({args,env:process.env,cwd:process.cwd()})+'\\n');
${await dockerContextInspection(config)}
if(args[0]!=='--config'||args[1]!==root+'/docker-config')throw Error('Unexpected route');
const contexts=JSON.stringify(args.slice(2))===JSON.stringify(['context','ls','--quiet']);
const images=JSON.stringify(args)===JSON.stringify(${JSON.stringify(imageListArgs(config))});
const dangling=JSON.stringify(args)===JSON.stringify(${JSON.stringify(imageListArgs(config,true))});
const markers=JSON.stringify(args)===JSON.stringify(${JSON.stringify(markerListArgs(config))});
if(!contexts&&!images&&!dangling&&!markers)throw Error('Unexpected native command');
const tagged=JSON.stringify({ID:${JSON.stringify(image)},Repository:'gitjig-runtime',Tag:'checked'});
const tagless=id=>JSON.stringify({ID:id,Repository:'<none>',Tag:'<none>'});
if(mode==='hold'||(mode==='dangling-hold'&&dangling)){
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});
 fs.writeFileSync(root+'/held',JSON.stringify({group:process.pid,descendant:child.pid}));setInterval(()=>{},1000);
}else if(markers){
 if(mode==='marker-invalid')process.stdout.write('invalid\\n');
 else if(mode==='marker-truncated')process.stdout.write(${JSON.stringify(image)});
 else if(mode==='marker-overflow')process.stdout.write('x'.repeat(1024*1024+1));
 else if(mode==='overlap')process.stdout.write(${JSON.stringify([untaggedImage,untaggedImage,'sha256:'+'3'.repeat(64),''].join('\n'))});
 else if(mode==='normal')process.stdout.write(${JSON.stringify(image+'\n')});
}else if(mode==='delayed'){
 fs.writeFileSync(root+'/held',JSON.stringify({group:process.pid}));const timer=setInterval(()=>{if(fs.existsSync(root+'/release')){clearInterval(timer);process.stdout.write(contexts?'owned\\n':JSON.stringify({ID:${JSON.stringify(image)},Repository:'gitjig-runtime',Tag:'checked'})+'\\n');}},5);
}else if(mode==='untagged'){
 if(dangling)process.stdout.write(tagless(${JSON.stringify(image)})+'\\n');
}else if(mode==='overlap'){
 const taglessRow=tagless(${JSON.stringify(untaggedImage)});
 process.stdout.write(dangling?taglessRow+'\\n':tagged+'\\n'+taglessRow+'\\n');
}else if(mode==='dangling-failed'){
 if(dangling)process.exitCode=1;else process.stdout.write(tagged+'\\n');
}else if(mode==='dangling-truncated'){
 process.stdout.write(tagged+(dangling?'':'\\n'));
}else if(mode==='combined-overflow')process.stdout.write((tagged+'\\n').repeat(dangling?129:128));
else if(mode==='bad')process.stdout.write(contexts?'owned\\nBAD CONTEXT\\n':'{"ID":"latest","Repository":"repo","Tag":"tag"}\\n');
else if(mode==='ambiguous')process.stdout.write('{"ID":'+JSON.stringify(${JSON.stringify(image)})+',"ID":'+JSON.stringify(${JSON.stringify(image)})+',"Repository":"repo","Tag":"tag"}\\n');
else if(mode==='combined-bytes')process.stdout.write(JSON.stringify({...JSON.parse(tagged),Padding:'x'.repeat(600000)})+'\\n');
else if(mode==='utf8')process.stdout.write(Buffer.from([255,10]));
else if(mode==='overflow')process.stdout.write('owned\\n'.repeat(257));
else if(mode==='bytes')process.stdout.write('x'.repeat(1024*1024+1));
else if(mode==='incomplete')process.stdout.write('owned');
else if(mode==='failed'){process.stderr.write('PRIVATE_NATIVE_FAILURE');process.exitCode=1;}
else if(mode!=='empty'&&!dangling)process.stdout.write(contexts?'default\\nowned\\nowned\\n':[JSON.stringify({ID:${JSON.stringify(image)},Repository:'gitjig-runtime',Tag:'checked'}),JSON.stringify({ID:${JSON.stringify(image)},Repository:'gitjig-runtime',Tag:'also'})].join('\\n')+'\\n');
`,{mode:0o700});
    const c=await openController({installationHome:path.join(root,'app')}),startup=ApplicationStartup.open(c),accounts=ApplicationAccounts.open(c),models=new ApplicationModels(c),settings=ApplicationSettings.open(c),source=await models.newConversation();let passed=false,cleanupUnknown=false;
    await startup.save({version:1,runtime:{dockerBinary:binary,dockerContext:'owned',image,dockerConfigDirectory:config,memoryMiB:2048}});
    t.after(async()=>{try{await c.close();}catch(error){if(!cleanupUnknown||error.code!=='RUNTIME_DISCOVERY_CLEANUP_UNKNOWN')throw error;}if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained runtime discovery fixture: '+root);});
    return {root,binary,config,calls,mode,held,c,startup,accounts,models,settings,source,file:path.join(c.applicationHome(),'config/startup.json'),input:{dockerBinary:binary,dockerConfigDirectory:config,dockerContext:'owned'},pass(){passed=true;},expectCleanupUnknown(){cleanupUnknown=true;}};
}
export async function heldIds(f){const until=Date.now()+2000;while(Date.now()<until){try{return JSON.parse(await fs.readFile(f.held,'utf8'));}catch{}await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Owned discovery group did not start');}
