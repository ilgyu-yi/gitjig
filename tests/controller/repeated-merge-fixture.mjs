import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {policyFixture} from './hosted-integration-fixture.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/compat';
import {mergeFixture} from '../platform/merge-fixture.mjs';
import {scripted} from './effect-fixture.mjs';
const execute = promisify(execFile);

// Distinct retained PR identities over one actual native receiver. Policy inventory
// comes from the existing owned fixture. This adds neither real-host qualification
// nor controller procedure standing; every success below performs actual Git work.
export async function repeatedMergeFixture(t, receiver, sets) {
    const pulls = new Map(), ci = [], outcomes = [];
    let fixture;
    fixture = await mergeFixture(t, {nativeRepository:{bare:receiver}, intercept:async({req,raw,send,options})=>{
        const url = new URL(req.url,'https://api.github.com'), route = url.pathname;
        if(route.startsWith('/repos/owner/repo/git/ref/heads/')){const name=decodeURIComponent(route.split('/heads/')[1]);const sha=await fixture.native('--git-dir='+receiver,'rev-parse','refs/heads/'+name);send({ref:'refs/heads/'+name,node_id:'REF-'+name,url:'https://api.github.com/repos/owner/repo/git/refs/heads/'+name,object:{type:'commit',sha}});return true;}
        if(route.startsWith('/repos/owner/repo/rules/branches/')){const ref='refs/heads/'+decodeURIComponent(route.split('/branches/')[1]);send(matchingSets(options.sets,ref).flatMap(set=>set.rules.map(rule=>({...rule,ruleset_source_type:set.source_type,ruleset_source:set.source,ruleset_id:set.id}))));return true;}
        const match = /^\/repos\/owner\/repo\/pulls\/(\d+)(?:\/(reviews|merge))?$/u.exec(route);
        if (match) {
            const number = Number(match[1]), pull = pulls.get(number);
            if (!pull) {send({},404);return true;}
            const base = await fixture.native('--git-dir='+receiver,'rev-parse','refs/heads/main');
            const head = await fixture.native('--git-dir='+receiver,'rev-parse','refs/heads/'+pull.headRef);
            if (match[2] === 'reviews') {
                send(Number(url.searchParams.get('page')??1)>1?[]:[{id:300+number,node_id:'REVIEW'+number,user:{id:22},state:'APPROVED',commit_id:head,submitted_at:'2026-10-30T00:00:00Z'}]);
            } else if (match[2] === 'merge' && req.method === 'PUT') {
                const request=JSON.parse(raw), destination='refs/heads/main';
                assert.equal(request.sha,head);
                assert.equal(pull.merged,null,'A merged PR cannot be replayed');
                assert.ok(options.sets.some(s=>s.enforcement==='active'&&s.current_user_can_bypass==='never'&&s.conditions.ref_name.include.includes('~ALL')&&s.conditions.ref_name.exclude.length===1&&s.conditions.ref_name.exclude[0]===destination&&s.rules.some(r=>r.type==='creation')&&s.rules.some(r=>r.type==='update')),'Exact original all-other-refs fence must be active at acceptance');
                await fixture.native('--git-dir='+receiver,'merge-base','--is-ancestor',base,head);
                const tree=(await fixture.native('--git-dir='+receiver,'merge-tree','--write-tree',base,head)).split('\n')[0];
                const merged=await fixture.native('--git-dir='+receiver,'commit-tree',tree,'-p',base,'-p',head,'-m',request.commit_title);
                await fixture.native('--git-dir='+receiver,'update-ref',destination,merged,base);
                pull.merged=merged;
                outcomes.push({number,request,base,head,tree,merged});
                send({message:'Owned native PR was merged.',sha:merged,merged:true});
            } else {
                send({id:number*10,node_id:'PR'+number*10,number,state:pull.merged?'closed':'open',merged:!!pull.merged,draft:false,stack:null,mergeable:true,mergeable_state:'clean',merge_commit_sha:pull.merged,updated_at:'2026-10-30T00:00:00Z',title:'Export '+pull.expected,body:'Distinct original reviewed cycle',user:{id:7},base:{ref:'main',sha:base,repo:{id:9,node_id:'R9',full_name:'owner/repo'}},head:{ref:pull.headRef,sha:head,repo:{id:9,node_id:'R9',full_name:'owner/repo'}}});
            }
            return true;
        }
        const check = /^\/repos\/owner\/repo\/commits\/([a-f0-9]{40})\/check-runs$/u.exec(route);
        if (check) {
            const sha=check[1];let pull;
            for(const value of pulls.values())if(await fixture.native('--git-dir='+receiver,'rev-parse','refs/heads/'+value.headRef)===sha)pull=value;
            assert.ok(pull,'CI must correspond to an actual retained PR head');
            const source=await fixture.native('--git-dir='+receiver,'show',sha+':consumer.cjs');
            const file=path.join(fixture.root,'native-ci-'+sha+'.cjs');
            await fs.writeFile(file,source+'\nrequire("node:assert/strict").equal(module.exports,'+pull.expected+');\n');
            const result=await execute(process.execPath,[file],{timeout:10000}).then(()=>({exitCode:0}),error=>({exitCode:error.code}));
            ci.push({head:sha,number:pull.number,expected:pull.expected,...result});
            send({total_count:1,check_runs:[{id:400+pull.number,name:'native-ci',head_sha:sha,app:{id:23},status:'completed',conclusion:result.exitCode===0?'success':'failure'}]});
            return true;
        }
        return false;
    }});
    const mergeRules=structuredClone(fixture.options.sets);
    // Review/CI protect the destination; the separate original fence protects
    // every other ref. Never add a source exception to the fence.
    mergeRules.find(set=>set.rules.some(rule=>rule.type==='pull_request')).conditions.ref_name={include:['refs/heads/main'],exclude:[]};
    fixture.options.sets=sets;
    return {...fixture,mergeRules,ci,outcomes,addPull(number,headRef,expected){assert.ok(!pulls.has(number));pulls.set(number,{number,headRef,expected,merged:null});},puts:()=>outcomes.length};
}

function matchingSets(sets,ref){return sets.filter(set=>set.enforcement==='active'&&set.target==='branch'&&(set.conditions.ref_name.include.includes('~ALL')||set.conditions.ref_name.include.includes(ref))&&!set.conditions.ref_name.exclude.includes(ref));}

// The legacy publication fixture exposes one selected ref and assumes all rules
// apply to it. Keep its owned identity/inventory transport while supplying exact
// native effective rows for the base-only policy plus unchanged all-other fence.
export async function cyclePublicationFixture(native,sets,ref){
    const upstream=await policyFixture(native,{normalNative:true,sets,ref});
    const sockets=new Set();
    const server=http.createServer((req,res)=>{
        const url=new URL(req.url,upstream.origin);
        if(url.pathname.startsWith('/repos/owner/repo/rules/branches/')){
            assert.equal(req.headers.authorization,'Bearer '+native.token);
            const selected='refs/heads/'+decodeURIComponent(url.pathname.split('/branches/')[1]);
            const rows=matchingSets(sets,selected).flatMap(set=>set.rules.map(rule=>({...rule,ruleset_source_type:set.source_type,ruleset_source:set.source,ruleset_id:set.id})));
            res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(rows));return;
        }
        const request=http.request(url,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
        request.on('error',()=>res.destroy());req.pipe(request);
    });
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    return {origin:'http://127.0.0.1:'+server.address().port,async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await upstream.close();}};
}

// A deterministic model authoring the distinct second request, not a synthetic
// acceptance receipt. The actual runtime executes authored code/checks, and the
// original controller separately selects/adjudicates independent role outputs.
export function cycleModel(value, ordinary) {
    const model=scripted(ordinary), original=model.definition.streamSimple;
    if(value===3)return model;
    assert.equal(value,4);
    return {...model,definition:{...model.definition,streamSimple(m,context,options){
        const user=context.messages.find(message=>message.role==='user');
        const text=user.content.filter(part=>part.type==='text').map(part=>part.text).join('');
        const role=text.match(/assigned (\w+) task/)?.[1];
        if(!role)return original.call(model.definition,m,context,options);
        const stream=createAssistantMessageEventStream();
        void(async()=>{try{
            const message=await original.call(model.definition,m,context,options).result();
            const call=message.content.find(part=>part.type==='toolCall');
            if((role==='implementer'||role==='repairer')&&call?.name==='write')call.arguments.content=call.arguments.content.replace(/exports=\d+/u,'exports=4');
            if((role==='implementer'||role==='repairer')&&!call){
                const completed=context.messages.some(message=>message.role==='toolResult'&&message.toolName==='write');
                const wroteCheck=context.messages.some(message=>message.role==='assistant'&&message.content.some(part=>part.type==='toolCall'&&part.name==='write'&&part.arguments.path==='check.cjs'));
                if(completed&&!wroteCheck){
                    const source=[...text.matchAll(/\nSOURCE ([^\n]+)\n([\s\S]*?)\nEND SOURCE\n/gu)].map(match=>({metadata:JSON.parse(match[1]),content:match[2]})).find(source=>source.metadata.path==='check.cjs');
                    assert.ok(source,'Actual captured check source is required');
                    message.content=[{type:'toolCall',id:'write-second-cycle-check',name:'write',arguments:{path:'check.cjs',content:source.content.replaceAll('three','four').replace('===3','===4')}}];message.stopReason='toolUse';
                }
            }
            if(role==='planner'){
                const part=message.content.find(part=>part.type==='text'), result=JSON.parse(part.text), plan=result.plan;
                plan.intent='Export4 using the existing consumer after the first merged cycle';
                plan.requirements[0].text='Consumer exports4';
                for(const check of plan.verification.checks){const previousId=check.id;check.id='value4';if(Array.isArray(plan.verification.strategies))for(const strategy of plan.verification.strategies)if(strategy?.kind==='consumer-cases'&&Array.isArray(strategy.checkIds))strategy.checkIds=strategy.checkIds.map(id=>id===previousId?check.id:id);check.assertions=['four'];check.cases=[
                    {id:'value4-healthy',kind:'healthy',guaranteeIds:['R1'],derivation:'Second owner requires actual consumer value4',consumerPaths:['consumer.cjs'],input:{literalUtf8:'4',fixturePaths:[]},expected:{kind:'return',value:'4'}},
                    {id:'value4-adverse',kind:'adverse',guaranteeIds:['R1'],derivation:'Contradictory first-cycle value3 must be rejected',consumerPaths:['consumer.cjs'],input:{literalUtf8:'3',fixturePaths:[]},expected:{kind:'rejection',value:'4'}}
                ];}
                part.text=JSON.stringify(result);
            }
            stream.push({type:'done',reason:message.stopReason,message});stream.end(message);
        }catch(error){const message={role:'assistant',content:[],api:m.api,provider:m.provider,model:m.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'error',errorMessage:String(error),timestamp:Date.now()};stream.push({type:'error',reason:'error',error:message});stream.end(message);}})();
        return stream;
    }}};
}
