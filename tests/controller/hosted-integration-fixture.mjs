import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),git='/opt/homebrew/bin/git',token='fixture-native-secret-abc123';
const env=root=>({PATH:'/opt/homebrew/bin:/usr/bin:/bin',HOME:root,LANG:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'f@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'f@example.invalid'});
async function command(root,repo,args,input){return new Promise((resolve,reject)=>{const p=spawn(git,[`--git-dir=${repo}`,...args],{env:env(root),stdio:['pipe','pipe','pipe']});const out=[],err=[];p.stdout.on('data',b=>out.push(b));p.stderr.on('data',b=>err.push(b));p.on('error',reject);p.on('close',c=>c===0?resolve(Buffer.concat(out)):reject(Error(Buffer.concat(err).toString())));p.stdin.end(input);});}
async function commit(root,repo,parent,label){const blob=(await command(root,repo,['hash-object','-w','--stdin'],Buffer.from(label))).toString().trim();const tree=(await command(root,repo,['mktree'],Buffer.from(`100644 blob ${blob}\tfile.txt\n`))).toString().trim();return(await command(root,repo,['commit-tree',tree,...(parent?['-p',parent]:[])],Buffer.from(label))).toString().trim();}
export async function fixture(options={}){
 const parent=options.fixtureRoot??path.resolve('.runtime-fixtures');await fs.mkdir(parent,{recursive:true});const root=await fs.realpath(await fs.mkdtemp(path.join(parent,'native-https-')));await fs.chmod(root,0o700);await fs.mkdir(path.join(root,'owner'),{mode:0o700});
 const receiver=path.join(root,'owner/repo.git');await exec(git,['init','--bare','--template=',receiver],{env:env(root)});await command(root,receiver,['config','http.receivepack','true']);const files=options.files??{'file.txt':'base'};let rows='';for(const [name,value]of Object.entries(files)){const blob=(await command(root,receiver,['hash-object','-w','--stdin'],Buffer.from(value))).toString().trim();rows+=`100644 blob ${blob}\t${name}\n`;}const tree=(await command(root,receiver,['mktree'],Buffer.from(rows))).toString().trim();const B=(await command(root,receiver,['commit-tree',tree],Buffer.from('K'))).toString().trim();await command(root,receiver,['update-ref','refs/heads/main',B]);
 const key=path.join(root,'key.pem'),ca=path.join(root,'ca.pem');await exec('/usr/bin/openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',key,'-out',ca,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1']);await fs.chmod(key,0o600);await fs.chmod(ca,0o600);
 const execPath=(await exec(git,['--exec-path'])).stdout.trim(),requests=[],sockets=new Set(),backends=new Map();let origin,receiveHold;
 const holdReceive=()=>{let enter,release;const entered=new Promise(r=>enter=r),barrier=new Promise(r=>release=r);receiveHold={enter,barrier};return{entered,release};};
 const server=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(ca),maxVersion:'TLSv1.2'},async(req,res)=>{
  requests.push({path:req.url,authorized:req.headers.authorization==='Basic '+Buffer.from('x-access-token:'+token).toString('base64')});
  if(options.redirect){res.writeHead(302,{location:options.redirect});res.end();return;}
  if(options.stall){return;}
  const good=req.headers.authorization==='Basic '+Buffer.from('x-access-token:'+token).toString('base64');if(!good){res.writeHead(401,{'www-authenticate':'Basic realm="fixture"'});res.end();return;}
  if(options.readOnly&&req.url.includes('git-receive-pack')){res.writeHead(403);res.end('read only');return;}
  if(receiveHold&&req.url.endsWith('/git-receive-pack')){const h=receiveHold;receiveHold=null;h.enter();await h.barrier;}
  const url=new URL(req.url,origin);const p=spawn(path.join(execPath,'git-http-backend'),[],{env:{...env(root),GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),REQUEST_METHOD:req.method,CONTENT_TYPE:req.headers['content-type']??'',CONTENT_LENGTH:req.headers['content-length']??'',REMOTE_USER:'fixture-user'},stdio:['pipe','pipe','pipe'],detached:true});backends.set(p,new Promise(resolve=>{p.once('close',()=>{backends.delete(p);resolve();});p.once('error',()=>{backends.delete(p);resolve();});}));const out=[];p.stdout.on('data',b=>out.push(b));p.stderr.resume();p.on('close',()=>{const data=Buffer.concat(out),end=data.indexOf('\r\n\r\n');if(end<0){res.writeHead(500);res.end();return;}const headers={};let status=200;for(const line of data.subarray(0,end).toString().split('\r\n')){const i=line.indexOf(':');if(i<0)continue;const name=line.slice(0,i),value=line.slice(i+1).trim();if(name.toLowerCase()==='status')status=Number(value.split(' ')[0]);else headers[name]=value;}if(options.dropAfterReceive&&url.pathname.endsWith('/git-receive-pack'))return;res.writeHead(status,headers);res.end(data.subarray(end+4));});req.pipe(p.stdin);p.stdin.on('error',()=>{});
 });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='https://127.0.0.1:'+server.address().port;
 const target={host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',ref:'refs/heads/main'};
 const open=async(patch={},name='client')=>{const profile={gitBinary:git,ownedClientRoot:path.join(root,name),commandTimeoutMs:2000},capture=structuredClone({origin,caFile:ca,token,credentialSessionId:'fixture-native-session',execPath,...patch});const {createOwnedHttpsGitFixture}=await import('../../dist/effects/index.js');return createOwnedHttpsGitFixture(profile,capture);};
 return {root,receiver,B,target,requests,origin,ca,execPath,open,token,holdReceive,command:(args,input)=>command(root,receiver,args,input),async close(){for(const s of sockets)s.destroy();const pending=[...backends.values()];for(const child of backends.keys())if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}await Promise.all(pending);await new Promise(r=>server.close(r));}};
}

export async function policyFixture(native, options={}) {
 const sockets=new Set(),requests=[],repo={id:9,node_id:'R9',name:'repo',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},visibility:'public',private:false,permissions:{admin:true},archived:false,disabled:false,has_issues:true,fork:false,allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:false};
 let ruleHold,readHold,partialPut=false;
 const holdRead=(route='/user')=>{let enter,release;const entered=new Promise(r=>enter=r),barrier=new Promise(r=>release=r);readHold={route,enter,barrier};return{entered,release};};
 const holdRuleset=()=>{let enter,release;const entered=new Promise(r=>enter=r),barrier=new Promise(r=>release=r);ruleHold={enter,barrier};return{entered,release};};
 const server=http.createServer(async(req,res)=>{try {
  const chunks=[];for await(const b of req)chunks.push(b);const raw=Buffer.concat(chunks);requests.push({method:req.method,path:req.url,authorized:req.headers.authorization==='Bearer '+native.token});
  const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','x-oauth-scopes':options.noGrant?'':'repo'});res.end(JSON.stringify(value));};
  const selectedRef=options.ref??'refs/heads/main',branchName=selectedRef.slice('refs/heads/'.length),B=(await native.command(['rev-parse',selectedRef])).toString().trim();
  const ref={__typename:'Ref',id:'REF-'+branchName,name:branchName,prefix:'refs/heads/',target:{__typename:'Commit',oid:B}};
  if(req.headers.authorization!=='Bearer '+native.token){send({},401);return;}
  if(readHold&&req.url===readHold.route){const h=readHold;readHold=null;h.enter();await h.barrier;}
  if(req.url==='/user'){send({id:7,type:'User',login:'owner'});return;}
  if(req.url==='/repos/owner/repo'&&req.method==='GET'){send({...repo,...options.repoPatch});return;}
  if(req.url==='/repos/owner/repo'&&req.method==='PATCH'){Object.assign(repo,JSON.parse(raw));send(repo);return;}
  if(req.url.startsWith('/repos/owner/repo/git/ref/heads/')){send({ref:selectedRef,node_id:'REF-'+branchName,url:'https://api.github.com/repos/owner/repo/git/refs/heads/'+branchName,object:{type:'commit',sha:B}});return;}
  const sets=options.sets??=[];
  if(req.url==='/repos/owner/repo/rulesets'&&req.method==='POST'){if(ruleHold){const h=ruleHold;ruleHold=null;h.enter();await h.barrier;}const payload=JSON.parse(raw),id=40+sets.length,row={...payload,id,node_id:'RS'+id,source_type:'Repository',source:'owner/repo',current_user_can_bypass:'never'};sets.push(row);send(row,201);return;}
  const write=req.url.match(/^\/repos\/owner\/repo\/rulesets\/(\d+)$/);if(write&&req.method==='PUT'){if(ruleHold){const h=ruleHold;ruleHold=null;h.enter();await h.barrier;}const row=sets.find(s=>s.id===Number(write[1]));if(!row){send({},404);return;}const payload=JSON.parse(raw);if(partialPut){partialPut=false;row.enforcement=payload.enforcement;}else Object.assign(row,payload);send(row);return;}

  if(req.url.startsWith('/repos/owner/repo/rulesets?')){send(sets.map(s=>({id:s.id,node_id:s.node_id,source_type:s.source_type,source:s.source,enforcement:s.enforcement})));return;}
  const match=req.url.match(/^\/repos\/owner\/repo\/rulesets\/(\d+)\?/);if(match){send(sets.find(s=>s.id===Number(match[1])));return;}
  if(req.url.startsWith('/repos/owner/repo/rules/branches/')){send(sets.filter(s=>s.enforcement==='active').flatMap(s=>s.rules.map(r=>({...r,ruleset_source_type:s.source_type,ruleset_source:s.source,ruleset_id:s.id}))));return;}
  if(req.url.endsWith('/protection')){send({},404);return;}
  if(req.url==='/graphql'){if(options.missingVisibility){send({data:{},errors:[{message:'fixture inventory unavailable'}]});return;}send({data:{repository:{__typename:'Repository',id:'R9',nameWithOwner:'owner/repo',...(options.normalNative?{viewerCanAdminister:true}:{}),ref:options.normalNative?{...ref,branchProtectionRule:null}:ref,branchProtectionRules:{nodes:[],totalCount:0,pageInfo:{hasNextPage:false,endCursor:null}}}}});return;}
  send({},404);
 }catch(e){res.destroy(e);}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {origin:'http://127.0.0.1:'+server.address().port,requests,holdRuleset,holdRead,partialNextPut(){partialPut=true;},async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
export function overrideSet(id=1){return{id,node_id:'RS'+id,source_type:'Repository',source:'owner/repo',target:'branch',enforcement:'active',rules:[{type:'pull_request',parameters:{dismiss_stale_reviews_on_push:true,require_code_owner_review:false,require_last_push_approval:true,required_review_thread_resolution:true,required_approving_review_count:0}}],current_user_can_bypass:'always',bypass_actors:[{actor_type:'User',actor_id:7,bypass_mode:'always'}],conditions:{ref_name:{include:['~ALL'],exclude:[]}}};}
