import http from 'node:http';
export const target={host:'github.com',repositoryId:9,repositoryNodeId:'R9',owner:'owner',repository:'repo',actorUserId:7};
export const carrierPolicy={version:'normal-test/v1',allowedMentions:[],knownPrivateLiterals:['fixture-private'],maxTitleBytes:1024,maxBodyBytes:131072};
export const H='a'.repeat(40);
export async function publicServer({drop=false,weakAdminFalse=false}={}){
 const requests=[],rows=[],sockets=new Set(),repo={...target,id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},private:false,visibility:'public',permissions:{admin:true},archived:false,disabled:false,fork:false,has_issues:true};let hold;
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const bytes=Buffer.concat(chunks),strong=req.headers.authorization==='Bearer fixture-original';requests.push({method:req.method,path:req.url,bytes,auth:req.headers.authorization});res.setHeader('content-type','application/json');res.setHeader('x-oauth-scopes',strong?'public_repo':'');const send=(x,status=200)=>{res.statusCode=status;res.end(JSON.stringify(x));};
 if(req.url==='/user'){if(hold){const h=hold;hold=null;h.enter();await h.barrier;}return send({id:7,type:'User',login:'owner'});}
 if(req.url==='/repos/owner/repo')return send(!strong&&weakAdminFalse?{...repo,permissions:{admin:false}}:repo);
 if(req.url.startsWith('/repos/owner/repo/git/ref/heads/')){const name=decodeURIComponent(req.url.split('/heads/')[1]);return send({ref:'refs/heads/'+name,object:{type:'commit',sha:name==='feature'?H:'b'.repeat(40)}});}
 if(req.method==='POST'){
  if(!strong)return send({message:'insufficient'},403);const payload=JSON.parse(bytes),n=rows.length+1,kind=req.url.endsWith('/comments')?'comment':req.url.endsWith('/pulls')?'draft':'issue',id=100+n;
  const r={id,node_id:'N'+n,user:{id:7},body:payload.body,...(kind==='comment'?{issue_url:'https://api.github.com/repos/owner/repo/issues/4',url:'https://api.github.com/repos/owner/repo/issues/comments/'+id,html_url:'https://github.com/owner/repo/issues/4#issuecomment-'+id}:{number:n,title:payload.title,url:'https://api.github.com/repos/owner/repo/'+(kind==='draft'?'pulls':'issues')+'/'+n,html_url:'https://github.com/owner/repo/'+(kind==='draft'?'pull':'issues')+'/'+n,...(kind==='draft'?{draft:true,head:{repo:{id:9,node_id:'R9',full_name:'owner/repo'},ref:'feature',sha:H},base:{repo:{id:9,node_id:'R9',full_name:'owner/repo'},ref:'main'}}:{repository_url:'https://api.github.com/repos/owner/repo'})})};rows.push(r);if(drop)return req.socket.destroy();return send(r,201);
 }
 if(req.url==='/repos/owner/repo/issues/4')return send({number:4,node_id:'I4',repository_url:'https://api.github.com/repos/owner/repo'});
 if(req.url.includes('?'))return send(rows);
 const r=rows.find(r=>new URL(r.url).pathname===req.url);return send(r??{},r?200:404);
 });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));return{origin:'http://127.0.0.1:'+server.address().port,requests,rows,repo,holdUser(){let enter,release;const entered=new Promise(r=>enter=r),barrier=new Promise(r=>release=r);hold={enter,barrier};return{entered,release};},async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
