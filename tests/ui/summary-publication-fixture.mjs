import fs from 'node:fs/promises';
import path from 'node:path';
import {shared,target} from '../contributions/publication-fixture.mjs';
import {resource,repository} from '../contributions/fixture.mjs';
import {configureOwnedPublicationFixture} from '../../.qualification/controller-testing.js';
export async function summaryPublicationFixture(t,{withTarget=true}={}){
 const f=await shared();let passed=false,gate;const releases=[];t.after(async()=>{for(const release of releases)release();await f.close({preserve:!passed});});
 const child=await f.c.trackRepositoryResource(resource(1)),other=await f.c.trackRepositoryResource(resource(2)),parent=await f.c.trackRepositoryResource({repository,kind:'issue',number:8});await f.c.setResourceSummaryParent({childId:child.resourceId,parentId:parent.resourceId,expectedRevision:0});await f.c.setResourceSummaryParent({childId:other.resourceId,parentId:parent.resourceId,expectedRevision:0});f.merged.add(1);await f.c.refreshContributions({resourceIds:[child.resourceId]});
 const summary=f.c.prepareContributionSummary({resourceId:parent.resourceId}),targetId=withTarget?f.c.registerPublicationTarget({target,visibility:'public'}).targetId:undefined;
 const configured=f.c.registerRepositoryConfigurationTarget({target:{...target,visibility:'public'}}),source=f.c.createConversation().conversationId,credential=path.join(f.root,'credential');await fs.writeFile(credential,'{"token":"fixture-original"}',{mode:0o600});f.c.configurePublicationCredential=options=>configureOwnedPublicationFixture(f.c,{...options,origin:f.origin});
 const listener=f.server.listeners('request')[0],requests=[];f.server.removeListener('request',listener);f.server.on('request',async(req,res)=>{
  requests.push({method:req.method,path:req.url});if(req.url==='/repos/owner/repo'){res.setHeader('x-oauth-scopes','repo');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:9,node_id:'R9',full_name:'owner/repo',url:'https://api.github.com/repos/owner/repo',owner:{id:7,type:'User',login:'owner'},private:false,visibility:'public',permissions:{admin:true},archived:false,disabled:false,has_issues:true,fork:false}));return;}
  if(req.url==='/user'&&gate){const pending=gate;gate=null;pending.enter();await Promise.race([pending.wait,new Promise(resolve=>res.once('close',resolve))]);}return listener(req,res);
 });
 return {...f,child,other,parent,summary,targetId,configured,source,credential,requests,pass(){passed=true;},holdPreflight(){let enter,release;const entered=new Promise(resolve=>enter=resolve),wait=new Promise(resolve=>release=resolve);gate={enter,wait};releases.push(release);return {entered,release};}};
}
