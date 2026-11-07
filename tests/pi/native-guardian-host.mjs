/** ROOT-selected harmless host fixture. No actual Claude/credentials/network. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [subject,root,scenario]=process.argv.slice(2),sha=b=>createHash('sha256').update(b).digest('hex');
const identity={file:fs.realpathSync(process.execPath),sha256:sha(fs.readFileSync(process.execPath))};
if(scenario==='before-config'){
 const {ownerRoot}=await import(pathToFileURL(path.join(path.dirname(subject),'native-owner-records.js')).href);
 const dir=ownerRoot(root),nonce=randomUUID();
 const guardian=spawn(process.execPath,[path.join(path.dirname(subject),'native-guardian.js'),dir,nonce,'harmless-death-owner','provider',String(process.pid),identity.sha256],{env:{},detached:true,stdio:['pipe','pipe','pipe','pipe','ipc']});
 guardian.stdout.resume();guardian.stderr.resume();
 const timer=setInterval(()=>{if(fs.existsSync(path.join(dir,nonce,'admission.json'))){clearInterval(timer);process.send({type:'ready',guardianPid:guardian.pid,nonce,recordRoot:dir});}},10);
}else{
 const {createOwnedNativeProducer}=await import(pathToFileURL(subject).href);
 const producer=await createOwnedNativeProducer(identity,undefined,root);
 const grand="process.on('SIGTERM',()=>{});process.stdout.write('READY\\n');setInterval(()=>{},1000);";
 const code="const{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});spawn(process.execPath,['-e',"+JSON.stringify(grand)+"],{stdio:['ignore','inherit','inherit']});"+(scenario==='leader-exit'?"setTimeout(()=>process.exit(0),50);":"setInterval(()=>{},1000);");
 const launch=producer.launch({command:identity.file,args:['-e',code],cwd:root,env:{PATH:'/usr/bin:/bin'}},{ownerSessionId:'harmless-death-owner',purpose:'provider'});
 if('pid'in launch.process)throw Error('Guardian pid alias');
 launch.process.on('error',()=>{});
 launch.process.once('exit',(code,signal)=>{if(process.connected)process.send({type:'leader-exited',code,signal});});
 let text='';launch.process.stdout.on('data',b=>{text+=b;if(text.includes('READY')){const recordRoot=path.join(root,'runtime/native-owners/v1'),nonce=fs.readdirSync(recordRoot)[0];process.send({type:'ready',recordRoot,nonce});}});
 process.on('message',async message=>{if(message==='close'){const result=await producer.close();process.send({type:'closed',result});process.exitCode=0;process.disconnect();}});
}
