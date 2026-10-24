// Copied outside checkout; no seed conversation turn or procedure-standing override.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const [payload,home,targetId,git,output,mode='create']=process.argv.slice(2),load=file=>import(pathToFileURL(path.join(payload,'dist',file)).href);
const {initializeApplicationEnvironment}=await load('app/environment.js');initializeApplicationEnvironment();
const {openController}=await load('controller/index.js'),{ApplicationModels}=await load('app/models.js');
const runtimeProfile=JSON.parse(await fs.readFile(path.join(home,'config/startup.json'),'utf8')).runtime;
const c=await openController({installationHome:home,...(mode.startsWith('run')?{runtimeProfile}:{}),effectsProfile:{gitBinary:git},interactionDelegation:{projectIds:['P'],maxAssignments:2},effectDelegations:[{projectId:'P',targetId,operationLimit:1}]});
try{
    const models=new ApplicationModels(c);models.install();
    if(mode.startsWith('run')){
        const saved=JSON.parse(await fs.readFile(output,'utf8')),abort=new AbortController();let commandError;
        const commands=mode==='run-stale'?(async()=>{
            while(!abort.signal.aborted){
                let command;
                try{command=JSON.parse(await fs.readFile(output+'.command','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
                if(command){
                    const assignment=c.store.one('SELECT * FROM conversation_assignments WHERE id=?',command.assignmentId);
                    assert.equal(assignment.source_conversation,saved.conversation.conversationId);assert.equal(assignment.state,'COMPLETE');
                    const view=c.inspectConversation(assignment.target),parent=c.inspectConversation(saved.conversation.conversationId),goal=c.inspectGoal(saved.goal.goalId);
                    assert.equal(goal.state,'REVIEWING');assert.equal(view.workId,assignment.work);
                    const before=c.store.all('SELECT * FROM effect_operations ORDER BY rowid'),budgets=c.store.all('SELECT * FROM budgets ORDER BY rowid');
                    const receipt=await c.queueConversationInput({conversationId:view.conversationId,expectedGeneration:view.generation,text:'Owner changes the original child criterion while goal completion review is pending; retain this direction explicitly',mode:'idle'});
                    assert.deepEqual(c.store.all('SELECT * FROM effect_operations ORDER BY rowid'),before);assert.deepEqual(c.store.all('SELECT * FROM budgets ORDER BY rowid'),budgets);
                    assert.equal(c.inspectConversation(parent.conversationId).directionRevision,parent.directionRevision);
                    await fs.writeFile(output+'.command-receipt',JSON.stringify({receipt,parent,child:view,before,budgets,goalState:goal.state,pid:process.pid}),{mode:0o600});return;
                }
                await delay(20,undefined,{signal:abort.signal});
            }
        })().catch(error=>{if(error.name!=='AbortError'){commandError=error;void c.interruptGoal(saved.goal.goalId);}}):Promise.resolve();
        try{
            c.startGoal({goalId:saved.goal.goalId,expectedRevision:saved.goal.revision,...models.conversationOperation(saved.conversation.conversationId)});
            const done=await c.waitGoal(saved.goal.goalId);console.log(JSON.stringify(done));if(done.state!==(mode==='run-stale'?'BLOCKED':'COMPLETED'))process.exitCode=2;
        }finally{abort.abort();await commands;}
        if(commandError)throw commandError;
    }else{
    const conversation=await models.newConversation({projectId:null,choice:{kind:'managed',provider:'installed-managed',modelId:'original',thinkingLevel:'off'}});
    const goal=c.createGoal({conversationId:conversation.conversationId,objective:'Make consumer export3 through actual governed procedures and integrate only reviewed agent delta',criteria:['Exactly one current reviewed candidate is confirmed on registered local target '+targetId,'The source project and user local edit remain unchanged; the native receiver contains only the reviewed export3 delta'],turnLimit:4});
    assert.equal(goal.state,'READY');assert.equal(goal.startedAttempts,0);assert.equal(c.store.one('SELECT COUNT(*) n FROM runs').n,0);assert.equal(c.store.one('SELECT COUNT(*) n FROM effect_delegations').n,0);
    await fs.writeFile(output,JSON.stringify({conversation,goal,pid:process.pid,node:process.execPath},null,2),{mode:0o600});
    }
}finally{await c.close();}
