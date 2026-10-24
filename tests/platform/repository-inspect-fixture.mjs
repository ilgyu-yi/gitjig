import http from 'node:http';
import https from 'node:https';
export const HEAD='1'.repeat(40);
export async function inspectionFixture(provider,options={}){
 const requests=[],sockets=new Set();let repositoryReads=0,branchReads=0;
 const prefix='/forge'+(provider==='gitea'?'/api/v1':'/api/v4'),namespace=provider==='gitea'?'owner':'group/subgroup',fullName=namespace+'/repo',selected='feature/path';
 const branch=()=>provider==='gitea'?{name:selected,commit:{id:HEAD},protected:true,effective_branch_protection_name:'feature/*',required_approvals:2,enable_status_check:true,status_check_contexts:['checks / linux'],user_can_merge:true,user_can_push:false}:{name:selected,commit:{id:HEAD},protected:true,developers_can_push:false,developers_can_merge:true,can_push:false};
 const levels=[{id:12,access_level:40,access_level_description:'Maintainers',user_id:null,group_id:null}];
 const rules=provider==='gitea'?[{rule_name:'main',branch_name:'main',required_approvals:1,enable_push:false},{rule_name:'feature/*',branch_name:'feature/*',required_approvals:2,enable_status_check:true,status_check_contexts:['checks / linux'],block_admin_merge_override:false,unknown_secret:'server-secret'}]:[{id:21,name:'feature/*',allow_force_push:false,code_owner_approval_required:true,inherited:true,merge_access_levels:levels,push_access_levels:[],unprotect_access_levels:levels},{id:22,name:'same-display-name',allow_force_push:false,inherited:false}];
 const listener=(req,res)=>{
  requests.push({method:req.method,path:req.url,authorization:req.headers.authorization,privateToken:req.headers['private-token']});
  const send=(body,status=200,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(typeof body==='string'?body:JSON.stringify(body));};
  const url=new URL(req.url,'http://fixture'),relative=url.pathname.slice(prefix.length);
  if(!url.pathname.startsWith(prefix+'/')){send({},500);return;}
  if(options.intercept?.({req,res,url,relative,send,requests}))return;
  if(relative==='/user'){send({id:7,[provider==='gitea'?'login':'username']:'owner',email:'server-secret'});return;}
  const lookup=provider==='gitea'?'/repos/owner/repo':'/projects/'+encodeURIComponent(fullName),numeric=provider==='gitea'?lookup:'/projects/9';
  if(relative===lookup||relative===numeric){repositoryReads++;send({id:options.drift&&repositoryReads>1?10:9,[provider==='gitea'?'full_name':'path_with_namespace']:options.wrongRepository?'other/repo':fullName,default_branch:selected,allow_merge_commits:true,allow_rebase:false,allow_rebase_explicit:false,allow_squash_merge:true,default_merge_style:'squash',has_pull_requests:true,archived:false,merge_method:'merge',squash_option:'default_on',only_allow_merge_if_pipeline_succeeds:true,only_allow_merge_if_all_discussions_are_resolved:true,temp_clone_token:'server-secret'});return;}
  if(relative===numeric+(provider==='gitea'?'/branches/':'/repository/branches/')+encodeURIComponent(selected)){branchReads++;send({...branch(),...(options.branchPatch??{}),...(options.branchDrift&&branchReads>1?{commit:{id:'2'.repeat(40)}}:{})});return;}
  if(relative===numeric+(provider==='gitea'?'/branch_protections':'/protected_branches')||relative===numeric+'/approval_rules'){
   const page=Number(url.searchParams.get('page')),isApproval=relative.endsWith('/approval_rules');
   if(options.pageError&&page===2&&!isApproval){send({private:'server-secret'},503);return;}
   const rows=isApproval?[{id:31,name:'security',rule_type:'regular',approvals_required:3,contains_hidden_groups:true,applies_to_all_protected_branches:true,protected_branches:[{id:21,name:'feature/*'}]}]:options.duplicate?[rules[0],rules[0]]:rules;
   if(provider==='gitea'||options.ignoredPage){send(rows);return;}
   send(rows.slice((page-1)*1,page*1));return;
  }
  if(relative===numeric+'/approvals'){send({reset_approvals_on_push:true,merge_requests_author_approval:false,merge_requests_disable_committers_approval:true});return;}
  send({},404);
 };
 const server=options.tls?https.createServer(options.tls,listener):http.createServer(listener);
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const apiBase=(options.tls?'https':'http')+'://127.0.0.1:'+server.address().port+prefix;
 return {apiBase,namespace,selected,requests,inspect:async(limits={},signal)=>{const {createOwnedRepositoryInspectionFixture}=await import('../../dist/platform/repository-inspect.js');return createOwnedRepositoryInspectionFixture({provider,apiBase,token:'fixture-only-token',limits}).inspect({owner:namespace,repository:'repo',signal});},close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
