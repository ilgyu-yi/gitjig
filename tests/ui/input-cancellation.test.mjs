import test from 'node:test';
import assert from 'node:assert/strict';
import {inputCommands,reviewConversationInputs} from '../../dist/ui/input-commands.js';

for (const match of [true,false]) test(`exact interrupted review ${match?'uses only its own continuation':'refuses a different input’s continuation'}`, async()=>{
    const input={inputId:'original',fingerprint:'current',state:'RECONCILIATION_REQUIRED',eligible:false,
        workId:'W',interruptedBoundary:'sessionInput',text:'Original retained request',explanation:'Held',blockingWorkIds:[]};
    let inspected=0,retried=0,acknowledged=0;
    const outcome=await reviewConversationInputs({
        controller:{inspectConversation:()=>({projectId:'P'}),inspectConversationInputs:()=>[input],inspectInterruptedConversationInputRetry:async()=>{
            inspected++;
            return {state:'ready',inputId:match?input.inputId:'different',fingerprint:'native-proof'};
        }},isCurrent:()=>true,
        show:async(_title,text,primary)=>{
            assert.match(text,/Original retained request/);
            if(match) {
                assert.match(text,/Only one continuation is available/);
                await primary.run();
            }
        },
        choose:async(_title,rows)=>{
            assert.ok(match);
            return rows.find(row=>row==='Continue original request');
        },
        retry:async(target,row,proof)=>{assert.deepEqual([target,row,proof],['C',input,'native-proof']);retried++;},
        inspectWork:async()=>assert.fail('Original work opened without approval'),notice(){},
    },'C',{originalInput:input,context:{acknowledgeSubmission:()=>acknowledged++}});
    assert.deepEqual([outcome,inspected,retried,acknowledged],match?['started',2,1,1]:['cancelled',1,0,0]);
});

test('cancelling reviewed retry does not acknowledge or clear its command draft',async()=>{
    const input={inputId:'I',fingerprint:'current',eligible:true,text:'original',explanation:'not yet sent',blockingWorkIds:[]};
    let choice=0,acknowledged=0;
    const command=inputCommands({controller:{inspectConversationInputs:()=>[input]},isCurrent:()=>true,
        choose:async(_title,rows)=>choice++===0?rows[0]:'Retry original request',show:async(_title,_text,primary)=>primary.run(),retry:async()=>false,
        inspectWork:async()=>assert.fail('Unexpected work inspection'),notice:()=>{}})[0];
    assert.equal(await command.run('', 'C', {acknowledgeSubmission:()=>acknowledged++}), 'cancelled');
    assert.equal(acknowledged,0);
});

for (const applied of [false,true]) test('exact interrupted runtime returns to the original request after setup · '+applied,async()=>{
    const input={inputId:'I',fingerprint:'retained',eligible:false,withdrawEligible:false,workId:'W',
        interruptedBoundary:'sessionInput',state:'RECONCILIATION_REQUIRED',text:'Original',explanation:'Held',blockingWorkIds:[]};
    let observation={state:'runtime-changed',inputId:'I',witness:'original'}, reviews=0, configurations=0, retries=0;
    const original={...observation,state:'ready',fingerprint:'fresh-retry'};
    const result=await reviewConversationInputs({
        controller:{inspectConversationInputs:()=>[input],inspectInterruptedConversationInputRetry:async()=>observation,
            inspectConversationStartupFailure:()=>null,
            inspectConversation:()=>({projectId:'P'}),options:{runtimeProfile:{}}},
        isCurrent:()=>true,
        show:async(_title,text,primary)=>{
            assert.match(text,/Original/);
            reviews++;
            if(reviews===1||applied) await primary.run();
        },
        choose:async(_title,rows)=>{
            if(configurations===0){
                assert.deepEqual(rows,['Back without changes','Configure execution runtime']);
                return rows[1];
            }
            assert.equal(applied,true);
            assert.deepEqual(rows,['Back without changes','Continue original request']);
            return rows[1];
        },
        configureRuntime:async()=>{
            configurations++;
            assert.equal(retries,0);
            if(applied) observation=original;
            return applied;
        },
        inspectWork:async()=>assert.fail('Opened unrelated recovery'),
        retry:async(_target,row,token)=>{assert.equal(row,input);assert.equal(token,original.fingerprint);retries++;},
        notice(){},
    },'C',{originalInput:input});
    assert.deepEqual([result,reviews,configurations,retries],applied?['started',2,1,1]:['cancelled',2,1,0]);
});

for (const when of ['before work', 'after extension']) test('abrupt allowance recovery refuses a changed native witness '+when, async()=>{
    const input={inputId:'I',fingerprint:'retained',eligible:false,withdrawEligible:false,workId:'W',
        interruptedBoundary:'sessionInput',state:'RECONCILIATION_REQUIRED',text:'Original',explanation:'Held',blockingWorkIds:[]};
    const exhausted={state:'exhausted',inputId:'I',workId:'W',witness:'original'};
    let observation=exhausted, workReviews=0, reviews=0;
    const notices=[];
    const result=reviewConversationInputs({
        controller:{inspectConversationInputs:()=>[input],inspectInterruptedConversationInputRetry:async()=>observation},
        isCurrent:()=>true,
        show:async(_title,_text,primary)=>{ reviews++; await primary.run(); },
        choose:async(_title,rows)=>{
            assert.deepEqual(rows,['Back without changes','Review original execution allowance']);
            if(when==='before work') observation={...exhausted,witness:'changed'};
            return rows[1];
        },
        inspectWork:async()=>{
            workReviews++;
            observation={state:'ready',inputId:'I',witness:'changed',fingerprint:'new-token'};
            return 'completed';
        },
        retry:async()=>assert.fail('Changed original was retried'),
        notice:text=>notices.push(text),
    },'C',{originalInput:input});
    if(when==='before work') await assert.rejects(result,/Retained request changed/);
    else{
        assert.equal(await result,'completed');
        assert.match(notices[0],/Work action completed.*Reopen \/inputs/);
    }
    assert.equal(workReviews,when==='before work'?0:1);
    assert.equal(reviews,1);
});

for (const unavailable of ['receipt','locale']) test('allowance review preserves its completion when the original '+unavailable+' cannot be read',async()=>{
    const input={inputId:'I',fingerprint:'retained',eligible:true,retryEligible:false,
        exhaustedRetryWorkId:'W',workId:'W',text:'Original',explanation:'Held',blockingWorkIds:[]};
    let changed=false;
    const notices=[];
    const result=await reviewConversationInputs({
        controller:{inspectConversationInputs:()=>changed&&unavailable==='receipt'?[{...input,fingerprint:'another-receipt'}]:[input]},
        isCurrent:()=>true,
        locale:()=>{
            if(changed&&unavailable==='locale') throw Error('Locale unavailable');
            return 'en';
        },
        show:async(_title,_text,primary)=>primary.run(),
        choose:async()=> 'Review original execution allowance',
        inspectWork:async(_target,id)=>{assert.equal(id,'W');changed=true;return 'completed';},
        retry:async()=>assert.fail('Work completion retried a stale request'),
        notice:text=>notices.push(text),
    },'C',{originalInput:input});
    assert.equal(result,'completed');
    assert.deepEqual(notices,unavailable==='receipt'?['Work action completed. Reopen /inputs to review the current request.']:[]);
});

for (const state of ['exhausted','runtime-changed']) test('interrupted Continue refreshes a changed prerequisite · '+state,async()=>{
    const input={inputId:'I',fingerprint:'retained',eligible:false,withdrawEligible:false,workId:'W',
        interruptedBoundary:'sessionInput',state:'RECONCILIATION_REQUIRED',text:'Original',explanation:'Held',blockingWorkIds:[]};
    let observation={state:'ready',inputId:'I',witness:'original',fingerprint:'reviewed'}, reviews=0;
    const result=await reviewConversationInputs({
        controller:{inspectConversationInputs:()=>[input],inspectInterruptedConversationInputRetry:async()=>observation,
            inspectConversation:()=>({projectId:'P'}),inspectConversationStartupFailure:()=>null,options:{runtimeProfile:{}}},
        isCurrent:()=>true,
        show:async(_title,text,primary)=>{
            if(++reviews===1) return primary.run();
            assert.match(text,state==='exhausted'?/Execution allowance exhausted/:/Apply the runtime settings/);
        },
        choose:async(_title,rows)=>{
            assert.ok(rows.includes('Continue original request'));
            observation={state,inputId:'I',witness:'original',...(state==='exhausted'?{workId:'W'}:{})};
            return 'Continue original request';
        },
        configureRuntime:async()=>assert.fail('Runtime opened after a stale Continue'),
        inspectWork:async()=>assert.fail('Allowance opened after a stale Continue'),
        retry:async()=>assert.fail('Stale original request was retried'),
        notice(){},
    },'C',{originalInput:input});
    assert.equal(result,'cancelled');
    assert.equal(reviews,2);
});

for (const remaining of ['empty','list','held work']) test('ordinary withdrawal outcome survives '+remaining,async()=>{
    const anotherPending=remaining!=='empty';
    const first={inputId:'first',fingerprint:'original-proof',eligible:true,text:'original',explanation:'not sent',blockingWorkIds:[]};
    const second={...first,inputId:'second',text:'another retained request',eligible:remaining!=='held work',blockingWorkIds:remaining==='held work'?['W']:[]};
    let withdrawn=false,lists=0,heldActions=0,heldDetails=0,inspections=0;
    const notices=[];
    const [command]=inputCommands({
        controller:{
            inspectConversationInputs:()=>withdrawn ? anotherPending ? [second] : [] : anotherPending ? [first,second] : [first],
            recoverConversationInput:request=>{
                assert.deepEqual(request,{conversationId:'C',inputId:'first',expectedContext:'original-proof',action:'withdraw'});
                withdrawn=true;
            },
        },
        isCurrent:()=>true,
        choose:async(title,rows)=>{
            if (title.startsWith('Retained requests')) {
                const visit=++lists;
                if (visit===1 || (visit===2 && remaining==='held work')) return rows[0];
                return 'Back';
            }
            return withdrawn ? rows[heldActions++===0?1:0] : 'Withdraw original request';
        },
        show:async(_title,_text,primary)=>{
            if (!withdrawn || heldDetails++===0) await primary.run();
        },
        retry:async()=>assert.fail('Withdrawal retried an input'),
        inspectWork:async(target,work)=>{
            assert.equal(remaining,'held work');
            assert.equal(target,'C');
            assert.equal(work,'W');
            inspections++;
            return 'cancelled';
        },
        notice:text=>notices.push(text),
    });
    assert.equal(await command.run('','C',{acknowledgeSubmission:()=>assert.fail('Withdrawal acknowledged editor text')}),'completed');
    assert.equal(lists,remaining==='held work'?3:anotherPending?2:1);
    assert.equal(inspections,remaining==='held work'?1:0);
    assert.equal(heldActions,remaining==='held work'?2:0);
    assert.equal(heldDetails,remaining==='held work'?2:0);
    assert.equal(withdrawn,true);
    assert.equal(notices.length,1);
    assert.match(notices[0],/^Request withdrawn/);
});

for (const runtimeInitiallyAvailable of [false,true]) test('a changed runtime prerequisite reopens the original review without dispatch', async () => {
    const input = {inputId:'I',fingerprint:'current',eligible:true,text:'original',explanation:'not yet sent',blockingWorkIds:[]};
    const options = runtimeInitiallyAvailable ? {runtimeProfile:{}} : {};
    let choice = 0, reviews = 0;
    const command = inputCommands({
        controller:{inspectConversationInputs:()=>[input],inspectConversation:()=>({projectId:'P'}),inspectConversationStartupFailure:()=>null,options},
        isCurrent:()=>true,
        choose:async(title,rows)=>{
            if (choice++ === 0) return rows[0];
            if (choice === 2) {
                assert.equal(title,runtimeInitiallyAvailable?'This exact request · choose explicitly':'Execution runtime is required before retry · request kept');
                assert.deepEqual(rows,['Back without changes',runtimeInitiallyAvailable?'Retry original request':'Configure execution runtime','Withdraw original request']);
                options.runtimeProfile = runtimeInitiallyAvailable ? undefined : {};
                return rows[1];
            }
            assert.equal(title,'Retained requests · separate from model history');
        },
        show:async(_title,text,primary)=>{
            assert.match(text,/"original"/);
            if (++reviews === 1) await primary.run();
            else if (runtimeInitiallyAvailable) assert.match(text,/Configure and apply the execution runtime/);
        },
        configureRuntime:async()=>assert.fail('Stale setup choice opened editor'),
        retry:async()=>assert.fail('Stale setup choice retried input'),
        inspectWork:async()=>assert.fail('Unexpected work inspection'),
        notice:()=>{},
    })[0];
    assert.equal(await command.run('', 'C', {acknowledgeSubmission:()=>assert.fail('Draft acknowledged')}), 'cancelled');
    assert.equal(choice,3);
    assert.equal(reviews,2);
});

for(const scenario of ['applied','cancelled','saved only','changed request','changed continuation','changed continuation after cancel'])test('runtime repair preserves exact review eligibility · '+scenario,async()=>{
    const special=scenario.includes('continuation'),options={};
    const input={inputId:'I',fingerprint:'original-proof',eligible:!special,text:'  Original 한국어 request  ',
        explanation:'not yet sent',blockingWorkIds:[],...(special?{state:'RECONCILIATION_REQUIRED',workId:'W',interruptedBoundary:'sessionInput'}:{})};
    let continuation={state:'ready',inputId:'I',fingerprint:'continuation-proof'};
    let lists=0,reviews=0,configured=0;
    const notices=[];
    const [command]=inputCommands({
        controller:{inspectConversationInputs:()=>[{...input}],inspectConversation:()=>({projectId:'P'}),
            inspectInterruptedConversationInputRetry:async()=>continuation,inspectConversationStartupFailure:()=>null,options},
        isCurrent:()=>true,
        choose:async(title,rows)=>{
            if(title.startsWith('Retained requests'))return lists++===0?rows[0]:'Back';
            assert.equal(configured,0,'reopening the inspection must still precede a new action choice');
            assert.equal(title,'Execution runtime is required before retry · request kept');
            return 'Configure execution runtime';
        },
        show:async(_title,text,primary)=>{
            assert.match(text,/Original 한국어 request/);
            if(++reviews===1){
                assert.match(text,/Configure and apply the execution runtime/);
                await primary.run();
            }
        },
        configureRuntime:async target=>{
            assert.equal(target,'C');configured++;
            const cancelled=scenario==='cancelled'||scenario.endsWith('after cancel');
            if(scenario!=='saved only'&&!cancelled)options.runtimeProfile={};
            if(scenario==='changed request')input.fingerprint='changed';
            if(special)continuation={...continuation,fingerprint:'different-continuation'};
            return !cancelled;
        },
        retry:async()=>assert.fail('Setup retried the retained request'),
        inspectWork:async()=>assert.fail('Unexpected work inspection'),
        notice:text=>notices.push(text),
    });
    const result=command.run('','C',{acknowledgeSubmission:()=>assert.fail('Setup acknowledged composer text')});
    if(scenario==='changed continuation after cancel')
        await assert.rejects(result,/Retained request changed/);
    else
        assert.equal(await result,scenario==='cancelled'?'cancelled':'completed');
    if(scenario==='changed request'||scenario==='changed continuation')
        assert.match(notices[0],/settings/i);
    assert.equal(configured,1);
    assert.equal(reviews,scenario.startsWith('changed')?1:2);
    assert.equal(lists,scenario.startsWith('changed')?1:2);
});

for(const scenario of ['open','focus changes','navigation fails','acknowledgment fails','commit refuses'])test('closed role input keeps its original feedback outcome when '+scenario,async()=>{
    const input={inputId:'I',fingerprint:'current',eligible:true,retryEligible:false,withdrawEligible:true,workId:'W',text:'original',explanation:'Direction remains attached to the task for source-fit',blockingWorkIds:[]};
    let pending=true,current=true,choice=0,withdrawn=0,inspected=0,detail='';
    const cause=Error('Original work reader unavailable');
    const notices=[];
    const command=inputCommands({controller:{inspectConversation:()=>({generation:1,workId:'W'}),inspectConversationInputs:()=>pending?[input]:[],recoverConversationInput:action=>{assert.equal(action.action,'withdraw');if(scenario==='commit refuses')throw cause;withdrawn++;pending=false;return input;}},isCurrent:()=>current,
        choose:async(_title,rows)=>{if(choice++===0)return rows[0];assert.deepEqual(rows,['Back without changes','Keep feedback and inspect original task']);return rows[1];},show:async(_title,text,primary)=>{detail=text;await primary.run();},retry:async()=>assert.fail('Closed role retried'),inspectWork:async(target,work)=>{assert.equal(target,'C');assert.equal(work,'W');inspected++;if(scenario==='navigation fails')throw cause;},notice:text=>{notices.push(text);if(scenario==='focus changes')current=false;}})[0];
    const outcome=command.run('','C',{acknowledgeSubmission(){if(scenario==='acknowledgment fails')throw cause;}});
    if(scenario==='commit refuses'){
        await assert.rejects(outcome,error=>error===cause);
        assert.deepEqual(notices,[]);
        assert.equal(withdrawn,0);
        assert.equal(inspected,0);
    }else{
        if(scenario==='open')assert.equal(await outcome,'completed');
        else await assert.rejects(outcome,error=>error.workId==='W'&&/Feedback kept on task W/.test(error.message)&&
            (scenario==='focus changes'?/conversation changed/.test(error.message):error.cause===cause));
        assert.equal(withdrawn,1);
        assert.equal(inspected,scenario==='open'||scenario==='navigation fails'?1:0);
        if(scenario==='acknowledgment fails')assert.deepEqual(notices,[]);
        assert.match(detail,/Direction remains attached/);
    }
});

test('a Korean review of queued input preserves exact escaped text and stops when its locale changes between pages',async()=>{
    const original = '  {owner}\n\x1b[31m' + '가'.repeat(33000) + '  ';
    const input = {inputId:'I',fingerprint:'current',state:'QUEUED',eligible:false,text:original,explanation:'Recorded input',blockingWorkIds:[]};
    let locale = 'ko';
    const pages = [];
    const command = inputCommands({
        controller:{inspectConversationInputs:()=>[input]}, isCurrent:()=>true, locale:()=>locale,
        choose:async(title,rows)=>{
            assert.equal(title,'보관된 요청 확인');
            assert.match(rows[0],/처리 대기 중인 요청/);
            assert.doesNotMatch(rows[0],/복구|전송되지 않음/);
            return rows[0];
        },
        show:async(title,text,primary)=>{
            pages.push({title,text});
            assert.match(text,/원본 요청\n"  \{owner\}\\n\\u001b\[31m/);
            assert.doesNotMatch(text,/\x1b/);
            assert.equal(primary.label,'원본 요청 다음 페이지');
            await primary.run();
            locale = 'en';
        },
        retry:async()=>assert.fail('Queued input retried'),
        inspectWork:async()=>assert.fail('Unexpected work inspection'),notice:()=>{},
    })[0];
    await assert.rejects(command.run('', 'C'), /표시 언어가 바뀌었습니다/);
    assert.equal(pages.length,1);
    assert.match(pages[0].title,/1.*2/);
});

test('escaping an intermediate request page returns to the list without opening actions',async()=>{
    const input={inputId:'I',fingerprint:'current',eligible:true,text:'가'.repeat(67000),failure:'Failed to start',explanation:'Not yet sent',blockingWorkIds:[]};
    let lists=0,pages=0;
    const [command]=inputCommands({controller:{inspectConversationInputs:()=>[input]},isCurrent:()=>true,
        choose:async(title,rows)=>{
            assert.match(title,/Retained requests/);
            return lists++===0?rows[0]:'Back';
        },show:async(title,text,primary)=>{
            assert.match(title,new RegExp('page '+(++pages)+' of 3'));
            assert.equal(primary.label,'Next page of the original request');
            if(pages===1){
                assert.ok(text.indexOf('Recorded delivery details')<text.indexOf('Original request\n'));
                assert.ok(text.includes('Failed to start'));
                await primary.run();
            }
        },retry:async()=>assert.fail('Review exit retried the input'),inspectWork:async()=>assert.fail('Review exit opened work'),notice(){}});
    assert.equal(await command.run('','C'),'cancelled');
    assert.equal(lists,2);
    assert.equal(pages,2);
});

test('a read-only final page without a work route has no action',async()=>{
    const input={inputId:'I',fingerprint:'current',state:'RECONCILIATION_REQUIRED',eligible:false,text:'x'.repeat(32500),explanation:'Delivery unknown',blockingWorkIds:[]};
    let lists=0,pages=0;
    const [command]=inputCommands({controller:{inspectConversationInputs:()=>[input]},isCurrent:()=>true,
        choose:async(title,rows)=>{assert.match(title,/Retained requests/);return lists++===0?rows[0]:'Back';},
        show:async(_title,_text,primary)=>{
            if(++pages===1)await primary.run();
            else assert.equal(primary,undefined);
        },retry:async()=>assert.fail('Unreconciled input retried'),inspectWork:async()=>assert.fail('Unknown work opened'),notice(){}});
    assert.equal(await command.run('','C'),'cancelled');
    assert.equal(pages,2);
});

for(const status of [
    {state:'RECONCILIATION_REQUIRED',interruptedBoundary:'modelAttempt'},
    {state:'RECONCILIATION_REQUIRED',interruptedBoundary:'sessionInput'},
    {state:'RECONCILIATION_REQUIRED',interruptedBoundary:'captureChanged'},
    {state:'RECONCILIATION_REQUIRED',interruptedBoundary:'protectionChanged'},
    {state:'INITIAL_RESERVED',legacyHistory:'held'},
])test(`held original request opens its exact work without retry or withdrawal · ${status.interruptedBoundary??status.legacyHistory}`,async()=>{
    const input={inputId:'I',fingerprint:'current',...status,eligible:false,workId:'original-work',
        text:'Original request content',explanation:'Retained record',blockingWorkIds:[]};
    let lists=0,inspections=0,details=0;
    const [command]=inputCommands({
        controller:{inspectConversationInputs:()=>[input],inspectInterruptedConversationInputRetry:async()=>undefined,
            recoverConversationInput:()=>assert.fail('Inspection modified input delivery')},
        isCurrent:()=>true,
        choose:async(title,rows)=>{
            assert.match(title,/Retained requests/);
            return lists++===0?rows[0]:'Back';
        },
        show:async(_title,text,primary)=>{
            assert.match(text,/Original request content/);
            if(status.interruptedBoundary==='captureChanged') assert.match(text,/Project files changed/);
            if(status.interruptedBoundary==='protectionChanged') assert.match(text,/Project protection was updated/);
            assert.equal(primary?.label,'Inspect original work');
            if (details++===0) await primary.run();
        },
        retry:async()=>assert.fail('Inspection retried the held request'),
        inspectWork:async(target,id)=>{
            assert.equal(target,'C');
            assert.equal(id,'original-work');
            inspections++;
            return 'cancelled';
        },
        notice(){},
    });
    assert.equal(await command.run('','C',{acknowledgeSubmission:()=>assert.fail('Inspection acknowledged draft')}),'cancelled');
    assert.equal(inspections,1);
    assert.equal(details,2);
    assert.equal(lists,2);
});

test('the original work shortcut refuses if the retained request changes during review',async()=>{
    const input={inputId:'I',fingerprint:'current',state:'RECONCILIATION_REQUIRED',eligible:false,workId:'original-work',
        text:'Original request content',explanation:'Retained record',blockingWorkIds:[]};
    const [command]=inputCommands({
        controller:{inspectConversationInputs:()=>[{...input}]},isCurrent:()=>true,choose:async(_title,rows)=>rows[0],
        show:async(_title,_text,primary)=>{
            await primary.run();
            input.workId='replacement-work';
            input.fingerprint='changed';
        },
        inspectWork:async()=>assert.fail('Stale original work inspection opened'),retry:async()=>assert.fail('Held request retried'),notice(){},
    });
    await assert.rejects(command.run('','C'),/Retained request changed/);
});

for(const blockers of [['blocker'],['blocker','original-work']])test('held work choices keep each work distinct · '+blockers.join(', '),async()=>{
    const input={inputId:'I',fingerprint:'current',state:'RECONCILIATION_REQUIRED',eligible:false,workId:'original-work',
        text:'Held input',explanation:'Retained record',blockingWorkIds:blockers};
    const original=blockers.includes(input.workId)?'Inspect blocking work · original-work':'Inspect original work · original-work';
    const [command]=inputCommands({
        controller:{inspectConversationInputs:()=>[input]},isCurrent:()=>true,
        choose:async(title,rows)=>{
            if(title.startsWith('Retained requests')) return rows[0];
            assert.deepEqual(rows,['Back without changes','Inspect blocking work · blocker',original]);
            return original;
        },
        show:async(_title,_text,primary)=>{
            assert.equal(primary.label,'Open recovery actions');
            await primary.run();
        },
        inspectWork:async(target,id)=>{assert.equal(target,'C');assert.equal(id,'original-work');},
        retry:async()=>assert.fail('Held request retried'),notice(){},
    });
    assert.equal(await command.run('','C'),'completed');
});

for(const [state,issue,label] of [
    ['QUEUED','Latest route failure','Queued request · delivery needs attention'],
    ['QUEUED',undefined,'Queued request'],
    ['NATIVE_PENDING',undefined,'Awaiting response or reconciliation'],
    ['RECONCILIATION_REQUIRED',undefined,'Delivery needs reconciliation'],
])test('retained input status follows its own current delivery record: '+label,async()=>{
    const input={inputId:'I',fingerprint:'current',state,eligible:false,text:'Owner request',failure:'Earlier run failure',queuedDeliveryIssue:issue,
        explanation:'Historical record',blockingWorkIds:[]};
    let picked=false,detail='';
    const [command]=inputCommands({controller:{inspectConversationInputs:()=>[input]},isCurrent:()=>true,
        choose:async(title,rows)=>{
            assert.match(title,/Retained requests/);
            assert.equal(rows[0],`1. ${label} · Owner request`);
            if(picked)return 'Back';
            picked=true;
            return rows[0];
        },show:async(_title,text,primary)=>{assert.equal(primary,undefined);detail=text;},
        retry:async()=>assert.fail('Read-only status retried input'),inspectWork:async()=>assert.fail('Read-only status opened work'),notice(){}});
    assert.equal(await command.run('','C'),'cancelled');
    assert.ok(detail.startsWith(label));
    if(issue){
        assert.ok(detail.indexOf(issue)<detail.indexOf('Original request\n'));
        assert.match(detail,/Previous run diagnostic\n"Earlier run failure"/);
    }else{
        assert.match(detail,/Recorded delivery details\n"Earlier run failure"/);
        assert.doesNotMatch(detail,/Previous run diagnostic/);
    }
});
