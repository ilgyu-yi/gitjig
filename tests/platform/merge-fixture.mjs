import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fixture, set, pr} from './policy-fixture.mjs';
import {createOwnedOrdinaryMergeSession} from '../../dist/platform/github-merge-session.js';
const execute=promisify(execFile);

// Native API identity/review/policy are owned fixtures; Git objects, checks,
// conditional ref updates and resulting merge topology are actual native work.
export async function mergeFixture(t, changes={}) {
 const {nativeRepository,...requested}=changes;
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-native-merge-'))),checkout=path.join(root,'checkout'),bare=nativeRepository?.bare??path.join(root,'receiver.git'),git=await fs.realpath('/opt/homebrew/bin/git');
 const env={PATH:'/usr/bin:/bin',HOME:root,LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const commands=[],command=async(binary,args)=>{const result=await execute(binary,args,{env,cwd:root,timeout:10000,maxBuffer:1024*1024});commands.push({binary,args,stdout:result.stdout,stderr:result.stderr});return result.stdout.trim();};
 const native=(...args)=>command(git,args);
 let base,head,tree;
 if(nativeRepository){base=await native('--git-dir='+bare,'rev-parse','refs/heads/main');head=await native('--git-dir='+bare,'rev-parse','refs/heads/feature/path');tree=await native('--git-dir='+bare,'rev-parse',head+'^{tree}');}
 else {
 await fs.mkdir(checkout,{mode:0o700});await native('init','--initial-branch=main','--template=',checkout);await fs.writeFile(path.join(checkout,'value.cjs'),'module.exports=2;\n');await native('-C',checkout,'add','value.cjs');await native('-C',checkout,'-c','commit.gpgsign=false','commit','-m','Original base');
 base=await native('-C',checkout,'rev-parse','HEAD');await native('-C',checkout,'checkout','-b','feature/path');await fs.writeFile(path.join(checkout,'value.cjs'),'module.exports=3;\n');await native('-C',checkout,'add','value.cjs');await native('-C',checkout,'-c','commit.gpgsign=false','commit','-m','Reviewed candidate');
 head=await native('-C',checkout,'rev-parse','HEAD');tree=await native('-C',checkout,'rev-parse','HEAD^{tree}');await native('clone','--bare','--template=',checkout,bare);await native('--git-dir='+bare,'config','--remove-section','remote.origin');
 }
 const strict={type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,required_status_checks:[{context:'native-ci',integration_id:23}]}},review={...structuredClone(pr),parameters:{...pr.parameters,required_approving_review_count:1,require_last_push_approval:false,required_review_thread_resolution:false}};
 const fence=set(2,{conditions:{ref_name:{include:['~ALL'],exclude:['refs/heads/main']}},rules:[{type:'creation'},{type:'update',parameters:{update_allows_fetch_and_merge:false}}]});
 const options={normalNative:true,base,head,sets:[set(1,{rules:[{type:'non_fast_forward'},{type:'deletion'},strict,review]}),fence],...requested};
 const ci=[],outcomes=[];let puts=0,passed=false;
 const subject={expectedUserId:7,target:{owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9',visibility:'public'},pullNumber:12,pullId:120,pullNodeId:'PR120',baseRef:'main',headRef:'feature/path',expectedBase:base,expectedHead:head,expectedTree:tree};
 const gitCommit=async sha=>({sha,tree:{sha:await native('--git-dir='+bare,'rev-parse',sha+'^{tree}')},parents:(await native('--git-dir='+bare,'show','-s','--format=%P',sha)).split(' ').filter(Boolean).map(sha=>({sha}))});
 const pull=()=>({id:120,node_id:'PR120',number:12,state:options.merged?'closed':'open',merged:!!options.merged,draft:false,stack:options.stack??null,mergeable:true,mergeable_state:'clean',merge_commit_sha:options.merged??null,updated_at:options.updatedAt??'2026-10-22T00:00:00Z',title:options.title??'Export three',body:'Preserve the original implementation shape.',user:{id:7},base:{ref:options.baseRef??'main',sha:options.base,repo:{id:9,node_id:'R9',full_name:'owner/repo'}},head:{ref:'feature/path',sha:options.head,repo:{id:9,node_id:'R9',full_name:'owner/repo'}}});
 const perform=async request=>{
  const baseRef=options.baseRef??'main',destination='refs/heads/'+baseRef;
  // Native repository enforcement is independent of the application's policy
  // calculator. A retarget cannot select another ref under this actual fence.
  const blocked=options.sets.some(ruleSet=>ruleSet.enforcement==='active'&&ruleSet.target==='branch'&&ruleSet.current_user_can_bypass==='never'&&ruleSet.conditions.ref_name.include.includes('~ALL')&&!ruleSet.conditions.ref_name.exclude.includes(destination)&&ruleSet.rules.some(rule=>rule.type==='update'));
  if(blocked)return {status:405,body:{message:'Native destination update restriction refused.'}};
  if(options.stack!=null)return {status:405,body:{message:'Synchronous merge does not support stacks.'}};
  const currentBase=await native('--git-dir='+bare,'rev-parse',destination),currentHead=await native('--git-dir='+bare,'rev-parse','refs/heads/feature/path');
  if(currentHead!==request.sha)return {status:409,body:{message:'Head changed.'}};
  if(options.sets[0].rules.find(rule=>rule.type==='required_status_checks')?.parameters.strict_required_status_checks_policy===true){
   try{await native('--git-dir='+bare,'merge-base','--is-ancestor',currentBase,currentHead);}catch{return {status:405,body:{message:'Native strict up-to-date enforcement refused.'}};}
  }
  let mergedTree;try{mergedTree=(await native('--git-dir='+bare,'merge-tree','--write-tree',currentBase,currentHead)).split('\n')[0];}catch{return {status:405,body:{message:'Native merge conflict.'}};}
  const commit=await native('--git-dir='+bare,'commit-tree',mergedTree,'-p',currentBase,'-p',currentHead,'-m',request.commit_title);
  await native('--git-dir='+bare,'update-ref',destination,commit,currentBase);options.base=commit;options.merged=commit;
  return {status:200,body:{message:'Pull request was merged.',sha:commit,merged:true}};
 };
 const intercepted=options.intercept;
 options.intercept=async({req,res,raw,send,requests})=>{
  if(nativeRepository){options.base=await native('--git-dir='+bare,'rev-parse','refs/heads/main');options.head=await native('--git-dir='+bare,'rev-parse','refs/heads/feature/path');}
  assert.equal(req.headers.authorization,'Bearer owned-native-merge-only');assert.equal(req.headers['x-github-api-version'],'2026-03-10');
  const url=new URL(req.url,'https://api.github.com'),route=url.pathname;
  if(await intercepted?.({req,res,raw,send,requests,options}))return true;
  if(route==='/repos/owner/repo/pulls/12'){send(pull());return true;}
  if(route==='/repos/owner/repo/pulls/12/reviews'){send(Number(url.searchParams.get('page')??1)>1?[]:[{id:301,node_id:'REVIEW301',user:{id:options.approver??22},state:'APPROVED',commit_id:options.head,submitted_at:'2026-10-22T00:00:00Z'}]);return true;}
  if(route.startsWith('/repos/owner/repo/git/commits/')){const sha=route.split('/').at(-1);try{send(await gitCommit(sha));}catch{send({},404);}return true;}
  if(route.startsWith('/repos/owner/repo/compare/')){const [basis,candidate]=route.split('/').at(-1).split('...');send({base_commit:{sha:basis},merge_base_commit:{sha:await native('--git-dir='+bare,'merge-base',basis,candidate)},status:'ahead',ahead_by:1,behind_by:0});return true;}
  if(route.endsWith('/statuses')){send([]);return true;}
  if(route.endsWith('/check-runs')){
   const source=await native('--git-dir='+bare,'show',options.head+':'+(options.checkFile??'value.cjs')),file=path.join(root,'actual-ci.cjs');await fs.writeFile(file,source+'\nrequire("node:assert/strict").equal(module.exports,'+(options.badCI?4:3)+');\n');
   const result=await execute(process.execPath,[file],{env,cwd:root,timeout:10000}).then(()=>({exitCode:0}),error=>({exitCode:error.code}));ci.push({head:options.head,...result});
   send({total_count:1,check_runs:[{id:401,name:'native-ci',head_sha:options.head,app:{id:23},status:'completed',conclusion:result.exitCode===0?'success':'failure'}]});return true;
  }
  if(route.startsWith('/repos/owner/repo/rules/branches/')){
   const name=decodeURIComponent(route.split('/branches/')[1]),literal='refs/heads/'+name;
   send(options.sets.filter(ruleSet=>ruleSet.enforcement==='active'&&ruleSet.target==='branch'&&ruleSet.conditions.ref_name.include.includes('~ALL')&&!ruleSet.conditions.ref_name.exclude.includes(literal)).flatMap(ruleSet=>ruleSet.rules.map(rule=>({...rule,ruleset_source_type:ruleSet.source_type,ruleset_source:ruleSet.source,ruleset_id:ruleSet.id}))));return true;
  }
  if(route==='/repos/owner/repo/pulls/12/merge'&&req.method==='PUT'){
   puts++;const request=JSON.parse(raw);await options.beforeAccept?.({options,native,bare,checkout});
   const outcome=await perform(request);outcomes.push({request,...outcome});
   if(options.dropAcceptance){res.destroy();return true;}
   send(outcome.body,outcome.status);return true;
  }
  return false;
 };
 const server=await fixture(options);
 const session=()=>createOwnedOrdinaryMergeSession({origin:server.origin,token:'owned-native-merge-only',limits:{requestTimeoutMs:2000}});
 t.after(async()=>{await server.close();await fs.writeFile(path.join(root,'native-receipt.json'),JSON.stringify({passed,root,bare,subject,puts,ci,outcomes,commands,requests:server.requests.map(({method,path,bytes})=>({method,path,body:bytes.toString()}))},null,2),{mode:0o600});if(passed&&process.env.GITJIG_RETAIN_MERGE_FIXTURE!=='1')await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained native merge fixture: '+root);});
 return {root,bare,checkout,origin:server.origin,subject,options,ci,requests:server.requests,session,native,puts:()=>puts,head:()=>native('--git-dir='+bare,'rev-parse','refs/heads/main'),pass(){passed=true;}};
}
