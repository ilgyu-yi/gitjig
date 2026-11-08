import {contributionServer} from '../contributions/native-server.mjs';
/** Synthetic native service; contains no product imports or application-state writes. */
export async function publicationNative(tls){
 const native=await contributionServer({tls}),listener=native.server.listeners('request')[0],requests=[],posts=[],comments=[];let hold;
 native.server.removeListener('request',listener);native.server.on('request',async(req,res)=>{
  requests.push({method:req.method,path:req.url,authorization:req.headers.authorization});res.setHeader('x-oauth-scopes',req.headers.authorization==='Bearer fixture-weak'?'':'repo');const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url==='/repos/owner/repo')return send({id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},private:false,visibility:'public',permissions:{admin:true},archived:false,disabled:false,has_issues:true,fork:false});
  if(req.method==='POST'&&req.url==='/repos/owner/repo/issues/8/comments'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks),payload=JSON.parse(bytes),id=900+posts.length,row={id,node_id:'IC'+id,user:{id:7},body:payload.body,issue_url:'https://api.github.com/repos/owner/repo/issues/8',url:'https://api.github.com/repos/owner/repo/issues/comments/'+id,html_url:'https://github.com/owner/repo/issues/8#issuecomment-'+id};posts.push({bytes,body:payload.body});comments.push(row);
   if(hold){const current=hold;hold=null;current.enter();await current.wait;return req.socket.destroy();}return send(row,201);
  }
  if(req.url.startsWith('/repos/owner/repo/issues/8/comments?'))return send(comments);
  const detail=req.url.match(/^\/repos\/owner\/repo\/issues\/comments\/(\d+)$/);if(detail){const row=comments.find(row=>row.id===Number(detail[1]));return send(row??{},row?200:404);}
  return listener(req,res);
 });
 return {...native,requests,posts,comments,async close(){native.server.closeAllConnections();await native.close();},holdAcceptedPost(){let enter,release;const entered=new Promise(resolve=>enter=resolve),wait=new Promise(resolve=>release=resolve);hold={enter,wait};return {entered,release};}};
}
