import test from 'node:test';
import assert from 'node:assert/strict';
import {localCheckCommands} from '../../dist/ui/local-check-commands.js';
import {localCheckResultText,localCheckReviewText} from '../../dist/ui/local-check-result.js';

// UI boundary fixture: retained execution facts are controlled, not a real engine qualification.
function fixture(overrides={}) {
    const result={workId:'W',runId:'R',kind:'command-observation',status:'succeeded',exitCode:0,captureRef:'capture',actualCwd:'/work',scratchInput:'mutable-or-unknown',cleanup:'removed',limitations:['Adequacy unknown'],stdout:'original stdout',stderr:'original stderr',...overrides};
    let view={workId:'W',projectId:'P',state:'DELIVERED',cwd:'work',command:'node check.cjs',epoch:1,generation:1,unsettled:false,allowance:{execution:{limit:8,consumed:1,reserved:0}},
        latestRun:{runId:'R',resultId:'result',phase:'SETTLED',reservation:'consumed',cleanup:'removed',command:'node check.cjs',runtime:{image:'captured'}},
        result:{resultId:'result',runId:'R',status:result.status,exitCode:result.exitCode,cleanup:result.cleanup,actualCwd:result.actualCwd}};
    const choices=['/work · captured project, read only','Run new independent check'],shown=[],evidence=[];let calls=0,current=true;
    const c={options:{runtimeProfile:{image:'active'}},inspectLocalCheck:id=>{assert.equal(id,'W');return structuredClone(view);},startOwnerLocalCheck:async()=>{calls++;return result;}};
    const host={controller:c,projectId:'P',signal:new AbortController().signal,guard:()=>{if(!current)throw Error('Source changed');},input:async()=> 'node check.cjs',choose:async(_title,rows)=>{const action=choices.shift();assert.ok(action===undefined||rows.includes(action),JSON.stringify(rows));return action;},show:async(title,value,primary)=>{shown.push({title,value});await primary?.run();},notice(){},track:task=>task,evidence:async(original,action)=>{evidence.push({original,action});return action==='record';}};
    host.hasSource=()=>true;
    host.guardSource=()=>host.guard();
    c.listLocalChecks=()=>({checks:[{state:'RETAINED',workId:'W',recordedState:view.state,cwd:view.cwd,commandPreview:view.command}],nextCursor:null});
    return {result,c,host,choices,shown,evidence,get view(){return view;},set view(value){view=value;},get calls(){return calls;},stale(){current=false;},run:()=>localCheckCommands(host).newCheck()};
}

test('successful new check proceeds directly to exact original candidate review once and keeps the raw receipt',async()=>{
    const f=fixture();f.choices.push('Inspect original receipt','Record exact commit candidate');
    assert.equal(await f.run(),true);assert.equal(f.calls,1);assert.equal(f.evidence.length,1);
    assert.deepEqual(f.evidence[0],{original:f.view,action:'record'});
    assert.deepEqual(f.shown.find(x=>x.title.startsWith('Original local check receipt')).value,f.result);
    assert.match(f.shown[1].value,/command finished successfully/);assert.match(f.shown[1].value,/Before recording.*current project and staged files/s);
    f.choices.push('DELIVERED · /work · node check.cjs · W','Inspect current check correspondence','Back','Back');
    await localCheckCommands(f.host).browse();
    assert.deepEqual(f.evidence[1],{original:f.view,action:'inspect'});
    assert.equal(f.calls,1);
});

test('a failed result opens the exact original retry review and Back spends no attempt',async()=>{
    const f=fixture({status:'failed',exitCode:7});
    f.c.listLocalChecks=()=>assert.fail('The result already identifies the original check');
    f.c.resumeOwnerLocalCheck=async()=>assert.fail('Back must not retry the check');
    f.choices.push('Review another attempt of this check','Resume original check','Back without resuming','Back');
    assert.equal(await f.run(),true);
    assert.equal(f.calls,1);
    assert.match(f.shown.find(item=>item.title==='Review original local check continuation').value,/Original work: "W"/);
});

test('a cleanup hold leaves the original receipt and recovery without a retry route',async()=>{
    const f=fixture({status:'failed',exitCode:7,cleanup:'unknown'});
    f.view={...f.view,state:'UNKNOWN',unsettled:true};
    const choose=f.host.choose;
    f.host.choose=async(title,rows)=>{
        if(title!=='Next step for this check')return choose(title,rows);
        assert.ok(!rows.includes('Review another attempt of this check'));
        assert.ok(rows.includes('Inspect original receipt'));
        return rows[0];
    };
    assert.equal(await f.run(),true);
    assert.equal(f.calls,1);
});

test('a prior failed result cannot offer a retry after a newer attempt exists',async()=>{
    const f=fixture({status:'failed',exitCode:7});
    f.view={...f.view,latestRun:{...f.view.latestRun,runId:'newer-attempt'}};
    const choose=f.host.choose;
    f.host.choose=async(title,rows)=>{
        if(title!=='Next step for this check')return choose(title,rows);
        assert.ok(!rows.includes('Review another attempt of this check'));
        return rows[0];
    };
    assert.equal(await f.run(),true);
    assert.equal(f.calls,1);
});

for (const captureRef of [null,'captured-snapshot']) test('unallocated local check explains its recorded stopping point and offers exact follow-up',async()=>{
    const f=fixture({status:'unavailable',exitCode:null,captureRef,cleanup:'not-allocated',stdout:'long evidence '.repeat(300),stderr:'original setup diagnostic'});
    f.choices.push('Review another attempt of this check','Back');
    assert.equal(await f.run(),true);
    assert.equal(f.calls,1);
    const text=f.shown.find(item=>item.title==='Local check result').value;
    const heading=captureRef===null?'The check stopped before recording a project snapshot.':'The project snapshot was recorded. The check stopped before allocating the execution environment.';
    assert.ok(text.startsWith(heading));
    assert.ok(text.indexOf('before another attempt')<text.indexOf('original setup diagnostic'));
    assert.ok(text.indexOf('original setup diagnostic')<text.indexOf('long evidence'));
    const korean=localCheckResultText(f.result,'node check.cjs','ko');
    assert.ok(korean.startsWith(captureRef===null?'프로젝트 스냅샷이 기록되기 전에':'프로젝트 스냅샷을 기록했습니다.'));
});

test('uncertain cleanup and missing exit facts do not imply a recorded execution stage',()=>{
    const unavailable=fixture({status:'unavailable',exitCode:null,captureRef:'captured-snapshot',cleanup:'unknown'});
    assert.match(localCheckResultText(unavailable.result,'node check.cjs'),/^The check needs cleanup review/);
    const incomplete=fixture({status:'unavailable',exitCode:null,captureRef:undefined,cleanup:'not-allocated'});
    assert.match(localCheckResultText(incomplete.result,'node check.cjs'),/^The check did not produce a usable successful result/);
    const noExit=fixture({status:'failed',exitCode:null});
    assert.match(localCheckResultText(noExit.result,'node check.cjs'),/^The check did not produce a usable successful result/);
});

for (const drift of ['work','source']) test('setup return protects the exact original check from '+drift+' drift',async()=>{
    const f=fixture({status:'unavailable',exitCode:null,captureRef:'original-capture',cleanup:'not-allocated'});
    f.view={...f.view,latestRun:{...f.view.latestRun,captureDigest:'original-capture',cleanup:'not-allocated'}};
    f.host.navigate=async command=>{
        assert.equal(command,'/setup runtime current');
        f.c.options.runtimeProfile={image:'replacement'};
        if(drift==='work') f.view.epoch++;
        if(drift==='source') f.stale();
        return 'completed';
    };
    f.choices.push('Review another attempt of this check','Review execution setup');
    await assert.rejects(f.run(),/changed/);
    assert.equal(f.calls,1);
    assert.ok(!f.shown.some(item=>item.title.startsWith('Review original local check continuation')));
});

test('cancelling setup keeps the original check visible even if the active runtime changed',async()=>{
    const f=fixture({status:'unavailable',exitCode:null,captureRef:'original-capture',cleanup:'not-allocated'});
    f.view={...f.view,latestRun:{...f.view.latestRun,captureDigest:'original-capture',cleanup:'not-allocated'}};
    f.host.navigate=async command=>{
        assert.equal(command,'/setup runtime current');
        f.c.options.runtimeProfile={image:'replacement'};
        return 'cancelled';
    };
    f.choices.push('Review another attempt of this check','Review execution setup','Inspect original check and allowance','Back');
    assert.equal(await f.run(),true);
    const history=f.shown.find(item=>item.title.startsWith('Original command observation')).value;
    assert.match(history,/Active runtime for a future attempt: "replacement"/);
    assert.match(history,/"image": "captured"/);
    assert.equal(f.calls,1);
});

test('cancelling local check progress before admission creates no attempt',async()=>{
    const f=fixture(),notices=[];
    f.host.runCheck=task=>task(AbortSignal.abort());
    f.host.notice=text=>notices.push(text);
    assert.equal(await f.run(),false);
    assert.equal(f.calls,0);
    assert.equal(f.shown.length,1);
    assert.equal(notices.at(-1),'Local check cancelled before starting');
});

test('an admitted cancellation shows the retained outcome only after progress closes',async()=>{
    const f=fixture({status:'cancelled',exitCode:null,cleanup:'removed'}),abort=new AbortController();
    let progress=false,calls=0;
    f.host.runCheck=async task=>{progress=true;try{return await task(abort.signal);}finally{progress=false;}};
    f.c.startOwnerLocalCheck=async(options,guard)=>{
        guard();
        calls++;
        abort.abort();
        assert.ok(options.signal.aborted);
        return f.result;
    };
    const show=f.host.show;
    f.host.show=async(title,text,primary)=>{assert.equal(progress,false);return show(title,text,primary);};
    assert.equal(await f.run(),true);
    assert.equal(calls,1);
    assert.match(f.shown[1].value,/The check was cancelled/);
    assert.match(f.shown[1].value,/Original work: W/);
});

for(const locale of ['en','ko'])test('closing a check result returns directly to local tools in '+locale,async()=>{
    const f=fixture({cleanup:locale==='ko'?'quarantined-cleanup':'removed'});
    f.host.locale=locale;
    if(locale==='ko')f.choices[0]='/work · 캡처한 프로젝트 · 읽기 전용';
    const show=f.host.show,choose=f.host.choose;
    const resultTitle=locale==='ko'?'로컬 검사 결과':'Local check result';
    const actionsTitle=locale==='ko'?'이 검사의 다음 동작':'Next step for this check';
    let resultAction;
    f.host.show=async(title,text,primary)=>{
        if(title===resultTitle)
            resultAction=primary?.label;
        await show(title,text,title===resultTitle?undefined:primary);
    };
    f.host.choose=async(title,rows)=>{
        assert.notEqual(title,actionsTitle);
        return choose(title,rows);
    };
    assert.equal(await f.run(),true);
    assert.equal(resultAction,locale==='ko'?'검사 후속 동작 열기':'Open check actions');
    assert.equal(f.calls,1);
    assert.equal(f.evidence.length,0);
});

test('asking for actions from a stale result refuses before opening the actions menu',async()=>{
    const f=fixture(),show=f.host.show,choose=f.host.choose;
    f.host.show=async(title,text,primary)=>{
        await show(title,text,primary);
        if(title==='Local check result')f.view.latestRun.runId='newer-run';
    };
    f.host.choose=async(title,rows)=>{
        assert.notEqual(title,'Next step for this check');
        return choose(title,rows);
    };
    await assert.rejects(f.run(),error=>error.workId==='W'&&/Original local check changed/.test(error.message));
    assert.equal(f.calls,1);
    assert.equal(f.evidence.length,0);
});

for(const cancel of [undefined,'Return to local tools'])test('returning from result does not inspect or record evidence: '+String(cancel),async()=>{
    const f=fixture();f.choices.push(cancel);assert.equal(await f.run(),true);assert.equal(f.evidence.length,0);assert.equal(f.calls,1);
});

for(const kind of ['failed','scratch','unknown-cleanup','unsettled','older-result','wrong-command'])test('result does not offer candidate recording for '+kind,async()=>{
    const f=fixture(kind==='failed'?{status:'failed',exitCode:1}:kind==='scratch'?{actualCwd:'/scratch'}:kind==='unknown-cleanup'?{cleanup:'unknown'}:{});
    if(kind==='scratch')f.view.cwd='scratch';
    if(kind==='unsettled')f.view.unsettled=true;
    if(kind==='older-result')f.view.latestRun.runId='NEW-RUN';
    if(kind==='wrong-command')f.view.latestRun.command='different later command';
    const choose=f.host.choose;f.host.choose=async(title,rows)=>{if(title==='Next step for this check'){assert.ok(!rows.some(row=>row.includes('commit candidate')));assert.ok(!rows.includes('Inspect current check correspondence'));return rows[0];}return choose(title,rows);};
    assert.equal(await f.run(),true);assert.equal(f.evidence.length,0);assert.equal(f.calls,1);
    assert.ok(f.shown[1].value.includes('node check.cjs'));assert.ok(!f.shown[1].value.includes('different later command'));
    if(kind==='unknown-cleanup')assert.match(f.shown[1].value,/^The check needs cleanup review/);
    if(kind==='failed')assert.doesNotMatch(f.shown[1].value,/Before recording a commit candidate/);
    let listed=false;
    f.host.choose=async(title,rows)=>{
        if(title.startsWith('Retained local checks')){if(listed)return'Back';listed=true;return rows[0];}
        assert.match(title,/^Original local check/);
        assert.ok(rows.includes('Inspect original check and allowance'));
        assert.ok(rows.includes('Inspect original result and output'));
        assert.ok(!rows.includes('Inspect current check correspondence'));
        assert.ok(!rows.includes('Record exact commit candidate'));
        return 'Back';
    };
    await localCheckCommands(f.host).browse();
    assert.equal(f.evidence.length,0);assert.equal(f.calls,1);
});

for(const drift of ['run','source'])test('changed '+drift+' cannot replace reviewed result at evidence handoff',async()=>{
    const f=fixture(),choose=f.host.choose;f.host.choose=async(title,rows)=>{
        if(title!=='Next step for this check')return choose(title,rows);
        if(drift==='run')f.view.latestRun.runId='NEW-RUN';else f.stale();
        return 'Record exact commit candidate';
    };
    await assert.rejects(f.run(),error=>error.workId==='W'&&/changed/i.test(error.message));assert.equal(f.evidence.length,0);assert.equal(f.calls,1);
});

test('a changed active runtime leaves evidence bound to the completed check',async()=>{
    const f=fixture(),choose=f.host.choose;
    f.host.choose=async(title,rows)=>{
        if(title!=='Next step for this check')return choose(title,rows);
        f.c.options.runtimeProfile={image:'replacement'};
        return 'Record exact commit candidate';
    };
    assert.equal(await f.run(),true);
    assert.deepEqual(f.evidence,[{original:f.view,action:'record'}]);
    assert.equal(f.calls,1);
});

test('scope and control-bearing command remain explicit without interpreting scratch success as verification',()=>{
    const f=fixture({actualCwd:'/scratch'}),text=localCheckResultText(f.result,'printf "\u009b"');
    assert.ok(text.includes('\\u009b'));assert.ok(!text.includes('\u009b'));assert.match(text,/scratch-directory result does not establish/);assert.match(text,/does not establish test adequacy/);
});
test('large escaped command cannot hide result scope, cleanup or original identity',()=>{
    const f=fixture(),text=localCheckResultText(f.result,'\u009b'.repeat(16000));
    assert.ok(text.length<65536);assert.match(text,/Command preview shortened/);
    for(const value of ['cleanup: removed','Original work: W','Result run: R','does not establish test adequacy'])assert.ok(text.includes(value));
    assert.ok(text.indexOf('Original work: W')<text.indexOf('Requested command'));
    assert.ok(!text.includes('Full stdout'));
});

test('Korean result puts original work and run before long failing output',()=>{
    const f=fixture({status:'failed',exitCode:7,stderr:'first failure\n'+'긴 출력 '.repeat(800),stdout:'normal output'});
    const text=localCheckResultText(f.result,'node check.cjs','ko');
    assert.match(text,/^검사 명령이 실패했습니다\./);
    assert.ok(text.includes('원래 작업: W\n결과 실행: R'));
    assert.ok(text.indexOf('결과 실행: R')<text.indexOf('first failure'));
    assert.ok(text.indexOf('first failure')<text.indexOf('normal output'));
    const held=localCheckResultText({...f.result,cleanup:'unknown'},'node check.cjs','ko');
    assert.match(held,/^검사 정리 상태를 확인해야 합니다\./);
    assert.match(held,/원래 작업의 복구 화면/);
});

test('check review makes exact command, runtime and retained spend readable before confirmation',()=>{
    const active={dockerBinary:'/trusted/docker',dockerContext:'current',image:'sha256:current'},previous={...active,dockerContext:'historical',image:'sha256:previous'};
    const review=localCheckReviewText({workId:'W',projectId:'P',command:'printf "\u009b"',cwd:'/scratch',state:'CANCELLED',allowance:{execution:{limit:8,consumed:3,reserved:0}},previousRuntime:previous,nextAttemptRuntime:active,scope:'Same original work and command.'});
    const body=review.split('\n\nOriginal observation')[0];
    assert.match(body,/^Run another attempt/);assert.match(body,/3 used · 0 reserved · 8 total/);assert.match(body,/This cannot establish staged-source correspondence/);
    assert.ok(body.includes('Exact command: "printf \\"\\u009b\\""'));assert.doesNotMatch(body,/\u009b/);
    assert.ok(body.indexOf('Active runtime for the next attempt')<body.indexOf('"current"'));
    assert.ok(body.indexOf('Previous attempt runtime · historical only')<body.indexOf('"historical"'));
    assert.match(body,/Back starts no new attempt/);
});

test('unreviewably large escaped command refuses before confirmation or work admission',async()=>{
    const f=fixture();f.host.input=async()=> '\\'.repeat(32768);
    await assert.rejects(f.run(),/exceed the terminal review limit/);
    assert.equal(f.calls,0);assert.equal(f.shown.length,0);assert.equal(f.choices.length,1);
});

test('check output preview is readable and explicitly bounded without changing outcome scope',()=>{
    const f=fixture({stdout:'Answer is 3\n',stderr:'warning\u009b'}),text=localCheckResultText(f.result,'node check.cjs');
    assert.ok(text.includes('Output: "Answer is 3\\n"'));assert.ok(text.includes('Error output: "warning\\u009b"'));assert.doesNotMatch(text,/\u009b/);
    const long=localCheckResultText({...f.result,stdout:'x'.repeat(20000)},'node check.cjs');
    assert.match(long,/Output preview shortened/);assert.match(long,/Original work: W/);assert.match(long,/does not establish test adequacy/);assert.ok(long.length<10000);
});

test('result offers no source correspondence guidance when the worktree is unavailable',async()=>{
    const f=fixture(),choose=f.host.choose;
    f.host.hasSource=()=>false;
    f.host.choose=async(title,rows)=>{
        if(title!=='Next step for this check')return choose(title,rows);
        assert.ok(!rows.includes('Inspect current check correspondence'));
        assert.ok(!rows.includes('Record exact commit candidate'));
        return 'Return to local tools';
    };
    assert.equal(await f.run(),true);
    assert.doesNotMatch(f.shown[1].value,/Before recording/);
    assert.deepEqual(f.evidence,[]);
});
