export function createdProtection(provider,body,id=21){
 if(provider==='gitea')return {...body,branch_name:body.rule_name};
 const result={...body,id,inherited:false};for(const kind of ['push','merge','unprotect']){result[kind+'_access_levels']=[{id:id*10,access_level:body[kind+'_access_level'],access_level_description:'Fixture role',user_id:null,group_id:null}];delete result[kind+'_access_level'];}return result;
}
import http from 'node:http';
import https from 'node:https';
export async function nativeConfigurationFixture(provider,options={}){
 const requests=[],sockets=new Set(),prefix='/forge'+(provider==='gitea'?'/api/v1':'/api/v4'),owner=provider==='gitea'?'owner':'group/subgroup';
 const target={provider,apiBase:'https://forge.example'+prefix,repositoryId:9,owner,repository:'repo',actorUserId:7};
 const repository={id:9,[provider==='gitea'?'full_name':'path_with_namespace']:owner+'/repo',archived:false,permissions:provider==='gitea'?{admin:true}:{project_access:{access_level:40},group_access:null},allow_merge_commits:true,allow_rebase:false,allow_rebase_explicit:false,allow_squash_merge:true,merge_method:'merge',squash_option:'default_off',only_allow_merge_if_pipeline_succeeds:false,allow_merge_on_skipped_pipeline:false,only_allow_merge_if_all_discussions_are_resolved:false,description:'preserve-unrelated',temp_clone_token:'fixture-private-native'};
 const protection=provider==='gitea'?{rule_name:'main',branch_name:'main',required_approvals:0,dismiss_stale_approvals:false,block_on_rejected_reviews:false,enable_force_push:true,enable_push:true,block_admin_merge_override:false,unselected_list:['preserve-principal']}:{id:21,name:'main',inherited:false,allow_force_push:true,code_owner_approval_required:false,push_access_levels:[{id:31,access_level:40}],unselected_list:['preserve-principal']};
 const profile={provider,version:'owner-native/v1',repository:provider==='gitea'?{allow_merge_commits:false}:{only_allow_merge_if_pipeline_succeeds:true},protection:{name:'main',fields:provider==='gitea'?{required_approvals:1,dismiss_stale_approvals:true}:{allow_force_push:false}}};
 const state={repository,protection:options.absent?null:protection,actorId:7};
 const listener=async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);let body;try{body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;}catch{res.writeHead(400);res.end();return;}
  const url=new URL(req.url,'http://fixture'),relative=url.pathname.slice(prefix.length),seen={method:req.method,path:req.url,body,token:req.headers.authorization??req.headers['private-token']};requests.push(seen);
  const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(await options.intercept?.({req,res,relative,body,state,send,requests,url}))return;
  if(relative==='/user'&&req.method==='GET'){send({id:state.actorId,login:'owner',username:'owner'});return;}
  const repo=provider==='gitea'?'/repos/owner/repo':'/projects/9',lookup='/projects/'+encodeURIComponent(owner+'/repo');
  if((relative===repo||relative===lookup)&&req.method==='GET'){send(state.repository);return;}
  const rule=repo+(provider==='gitea'?'/branch_protections/':'/protected_branches/')+'main';
  const collection=repo+(provider==='gitea'?'/branch_protections':'/protected_branches');
  if(relative===collection&&req.method==='GET'){const rows=state.inventory??(state.protection?[state.protection]:[]),page=Number(url.searchParams.get('page')??1),size=options.pageSize??100;send(provider==='gitea'?rows:rows.slice((page-1)*size,page*size));return;}
  if(relative===collection&&req.method==='POST'){if(state.protection){send({},409);return;}state.protection=createdProtection(provider,body);send(state.protection,201);return;}
  if(relative===rule&&req.method==='GET'){send(state.protection??{},state.protection?200:404);return;}
  if(relative===repo&&req.method===(provider==='gitea'?'PATCH':'PUT')){Object.assign(state.repository,body);send(state.repository);return;}
  if(relative===rule&&req.method==='PATCH'&&state.protection){Object.assign(state.protection,body);send(state.protection);return;}
  send({private:'fixture-private-native'},404);
 };
 const server=options.tls?https.createServer(options.tls,listener):http.createServer(listener);server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=(options.tls?'https':'http')+'://127.0.0.1:'+server.address().port;
 if(options.tls)target.apiBase=origin+prefix;
 return {target,profile,state,requests,origin,client:async(limits={})=>{const {createOwnedNativeConfigurationSession}=await import('../../dist/platform/repository-configuration.js');return createOwnedNativeConfigurationSession({provider,apiBase:target.apiBase,token:'fixture-native-token',limits},target,origin);},close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
