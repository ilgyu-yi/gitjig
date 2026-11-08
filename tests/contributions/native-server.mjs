import http from 'node:http';
import https from 'node:https';
const repo={id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',visibility:'public',private:false};
/** Owned synthetic native service only; no product imports, app state or credential discovery. */
export async function contributionServer(options={}){
 let calls=0, checks503=false, reviewWait=null, reviewEntered=null, replaced=false, badEnum=false, checkConclusion='success', checkId=501, checkHistory=[]; const merged=new Set(),requests=[];
 const server=(options.tls?https:http).createServer(options.tls??{},async(req,res)=>{calls++;requests.push({method:req.method,path:req.url,authorization:req.headers.authorization}); const u=new URL(req.url,'http://fixture');let value,status=200;
 if(u.pathname==='/user')value={id:7,login:'owner',type:'User'};
 else if(u.pathname==='/repos/owner/repo') value=repo;
 else if(/^\/repos\/owner\/repo\/issues\/[1-9][0-9]*$/.test(u.pathname)){const n=Number(u.pathname.split('/').at(-1));value={id:200+n,node_id:'I'+n,number:n,title:'Group'+n,body:'Owner selected destination',updated_at:'2026-10-17T00:00:00Z',repository_url:'https://api.github.com/repos/owner/repo'};}
 else if(/^\/repos\/owner\/repo\/pulls\/[12]$/.test(u.pathname)){const n=Number(u.pathname.split('/').at(-1));value={id:(replaced?999:100+n),node_id:(replaced?'REPLACED':'P'+n),number:n,title:'Human change'+n,body:'Preserve meaning '+n,updated_at:'2026-10-17T00:00:00Z',head:{sha:String(n).repeat(40),repo:{id:99,node_id:'FORK'}},base:{sha:'b'.repeat(40),repo},merged:merged.has(n),merge_commit_sha:merged.has(n)?String(n+2).repeat(40):null,merged_at:merged.has(n)?'2026-10-17T01:00:00Z':null,merged_by:merged.has(n)?{id:7,login:'human'}:null};}
 else if(/\/reviews$/.test(u.pathname)){reviewEntered?.();if(reviewWait)await reviewWait;const n=Number(u.pathname.split('/').at(-2));value=[{id:400+n,node_id:'REV'+n,user:{id:8},state:'APPROVED',commit_id:String(n).repeat(40),submitted_at:'2026-10-17T00:30:00Z'}];}
 else if(/\/check-runs$/.test(u.pathname)){if(checks503){status=503;value={message:'temporary'};}else{const sha=u.pathname.split('/').at(-2);value={check_runs:[...checkHistory.map(r=>({...r,head_sha:sha})),{id:checkId,name:'actual fixture CI',head_sha:sha,status:'completed',conclusion:checkConclusion,started_at:'2026-10-17T00:20:00Z',completed_at:'2026-10-17T00:25:00Z'},...(badEnum?[{id:502,name:'malformed sibling',head_sha:sha,status:['completed'],conclusion:'success'}]:[])]};}}
 else if(/\/statuses$/.test(u.pathname))value=[{id:601,context:'fixture',state:'success'}];else {status=404;value={message:'Not found'};}
 res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=(options.tls?'https':'http')+'://127.0.0.1:'+server.address().port;
 return{merged,requests,setBad(v){checks503=v;},setWait(v){reviewWait=v;},onReview(v){reviewEntered=v;},replace(){replaced=true;},staleOpen(n){merged.delete(n);},setBadEnum(v){badEnum=v;},setConclusion(v){checkHistory.push({id:checkId,name:'actual fixture CI',status:'completed',conclusion:checkConclusion,started_at:'2026-10-17T00:20:00Z',completed_at:'2026-10-17T00:25:00Z'});checkConclusion=v;checkId++;},server,origin,get calls(){return calls;},async close(){await new Promise(r=>server.close(r));}};
}
