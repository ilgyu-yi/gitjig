import assert from 'node:assert/strict';
import http from 'node:http';
import { createOwnedPolicyFixture } from '../../dist/platform/github-policy.js';
export const B='b'.repeat(40),H='a'.repeat(40);const repo={id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},visibility:'public',private:false,permissions:{admin:true},archived:false,disabled:false,has_issues:true,fork:false};
export const input=()=>({expectedUserId:7,target:{owner:'owner',repository:'repo',repositoryId:9,repositoryNodeId:'R9',visibility:'public'},branch:'main',expectedBase:B});
export const pr={type:'pull_request',parameters:{dismiss_stale_reviews_on_push:true,require_code_owner_review:false,require_last_push_approval:true,required_review_thread_resolution:true,required_approving_review_count:0}};
const status={type:'required_status_checks',parameters:{required_status_checks:[{context:'native-ci',integration_id:23}],strict_required_status_checks_policy:true}};
export const set=(id=1,patch={})=>({id,node_id:'RS'+id,source_type:'Repository',source:'owner/repo',target:'branch',enforcement:'active',rules:[{type:'non_fast_forward'},{type:'deletion'}],current_user_can_bypass:'never',bypass_actors:[],conditions:{ref_name:{include:['~ALL'],exclude:[]}},...patch});
export const override=id=>set(id,{rules:[structuredClone(pr),structuredClone(status)],current_user_can_bypass:'always',bypass_actors:[{actor_type:'User',actor_id:7,bypass_mode:'always'}]});
export async function fixture(options={}){
 const requests=[],sockets=new Set();let userReads=0,listReads=0,enteredResolve,closedResolve;const entered=new Promise(r=>enteredResolve=r),closed=new Promise(r=>closedResolve=r);
 const getSets=()=>structuredClone(options.sets??[]).map(s=>options.drift&&listReads>1?{...s,current_user_can_bypass:'always'}:s);
 const ref=name=>({__typename:'Ref',id:'REF-'+name,name,prefix:'refs/heads/',target:{__typename:'Commit',oid:options.wrongBase?'c'.repeat(40):name==='feature/path'?(options.head??H):(options.base??B)}});
 const server=http.createServer(async(req,res)=>{try{
  const chunks=[];for await(const b of req)chunks.push(b);const raw=Buffer.concat(chunks);requests.push({method:req.method,path:req.url,bytes:raw});const send=(value,status=200,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value));};
  if(await options.intercept?.({req,res,raw,send,requests}))return;
  if(req.url==='/user'){userReads++;if(options.stallUser){req.socket.once('close',()=>closedResolve());enteredResolve();return;}send({id:options.wrongUser?8:7,type:'User',login:'owner'},200,{'x-oauth-scopes':options.noGrant?'':options.scopeFlip&&userReads>1?'public_repo':'repo'});return;}
  if(req.url==='/repos/owner/repo'){send({...repo,...options.repoPatch},200,{'x-oauth-scopes':options.noGrant?'':options.scopeFlip&&userReads>1?'public_repo':'repo'});return;}
  if(req.url?.startsWith('/repos/owner/repo/git/ref/heads/')){const name=decodeURIComponent(req.url.split('/heads/')[1]);send({ref:'refs/heads/'+name,node_id:'REF-'+name,url:'https://api.github.com/repos/owner/repo/git/refs/heads/'+name,object:{type:'commit',sha:options.wrongBase?'c'.repeat(40):name==='feature/path'?(options.head??H):(options.base??B)}});return;}
  if(req.url?.startsWith('/repos/owner/repo/rulesets?')){
   const page=Number(new URL(req.url,'https://api.github.com').searchParams.get('page'));if(page===1)listReads++;
   if(options.pageError&&page===2){send({},500);return;}
   const sets=getSets(),metadata=sets.map(s=>({id:s.id,node_id:s.node_id,source_type:s.source_type,source:s.source,enforcement:s.enforcement}));
   if(options.paginate&&metadata.length>1&&page===1){const nextUrl=new URL(req.url,'https://api.github.com');nextUrl.searchParams.set('page','2');const next=nextUrl.href;send(metadata.slice(0,1),200,{link:`<${next}>; rel="next", <${next}>; rel="last"`});return;}
   send(options.paginate&&page===2?metadata.slice(1):metadata);return;
  }
  if(req.url?.match(/^\/repos\/owner\/repo\/rulesets\/\d+\?/)){const id=Number(req.url.split('/rulesets/')[1].split('?')[0]),s=getSets().find(s=>s.id===id);send(s??{},s?200:404);return;}
  if(req.url?.startsWith('/repos/owner/repo/rules/branches/')){
   let rows=getSets().filter(s=>s.enforcement==='active'&&s.target==='branch').flatMap(s=>s.rules.map(rule=>({...rule,ruleset_source_type:s.source_type,ruleset_source:s.source,ruleset_id:s.id})));
   if(Object.hasOwn(options,'effectiveUnattributed'))rows=rows.map(r=>r.type==='pull_request'?{...r,parameters:{...r.parameters,require_extra_approval_for_unattributed_changes:options.effectiveUnattributed}}:r);
   if(options.omitRule)rows=rows.slice(1);if(options.duplicateEffective&&rows.length)rows.push(rows[0]);if(options.effectiveExtra&&rows.length)rows[0].future_semantic=true;send(rows);return;
  }
  if(req.url?.endsWith('/protection')){send(options.classicMatch?{enforce_admins:{enabled:true}}:{message:'Not Found'},options.classicMatch?200:404);return;}
  if(req.url==='/graphql'){
   const body=JSON.parse(raw);assert.ok(body.query.startsWith('query '));assert.equal(body.query.includes('mutation '),false);
   if(options.graphqlError){send({data:{},errors:[{message:'visibility unknown'}]});return;}
   const branchName=body.variables.qualifiedName?.slice('refs/heads/'.length)??'main';const target=ref(branchName);if(options.normalNative){target.branchProtectionRule=options.directMismatch?{id:'FOREIGN'}:options.classicMatch?{id:'CR1'}:null;}
   if(body.query.includes('query GitjigClassicInventory')){const nodes=options.classicMatch?[{__typename:'BranchProtectionRule',id:'CR1',pattern:'main',repository:{id:'R9'}}]:[];send({data:{repository:{__typename:'Repository',id:'R9',nameWithOwner:'owner/repo',...(options.normalNative?{viewerCanAdminister:options.missingAdmin?undefined:options.noAdmin?false:true}:{}),ref:target,branchProtectionRules:{nodes,totalCount:nodes.length,pageInfo:{hasNextPage:false,endCursor:null}}}}});return;}
   send({data:{node:{__typename:'BranchProtectionRule',id:'CR1',pattern:'main',repository:{id:'R9',...(options.normalNative?{viewerCanAdminister:!options.noAdmin}:{}),ref:target},matchingRefs:{nodes:[target],totalCount:1,pageInfo:{hasNextPage:false,endCursor:null}}}}});return;
  }
  send({},404);
 }catch{res.destroy();}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 return {requests,origin,entered,closed,reader:(limits={})=>createOwnedPolicyFixture({origin,token:'fixture-policy-only',limits:{requestTimeoutMs:500,...limits}}),async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
