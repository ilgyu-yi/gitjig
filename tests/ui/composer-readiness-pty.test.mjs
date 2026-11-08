import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const paste = text => '\x1b[200~' + text + '\x1b[201~';
const cli = [
    process.execPath,
    ...(process.env.GITJIG_UI_MODULE_GUARD ? ['--import', path.resolve(process.env.GITJIG_UI_MODULE_GUARD)] : []),
    '--import', path.resolve('tests/ui/composer-readiness-observer.mjs'),
    process.env.GITJIG_TEST_CLI_ENTRY ?? path.resolve('dist/cli/entry.js'),
];
const cases = [
    {
        locale: 'en_US.UTF-8',
        request: '  Fix the failing test · preserve my exact request  ',
        setupBlocked: 'Setup needed · use the command menu to inspect',
        needed: 'Setup needed · Enter for options · request kept',
        ready: 'Ready · Enter send',
        repair: 'Request not sent · your text is kept',
        back: '\x1b',
        setup: 'Open setup',
        overview: 'Setup and next actions',
        hiddenSetup: ['Future application default', 'Reply language', 'Active bridge', 'Next-launch bridge'],
        menu: 'Commands · Ctrl+G',
        leave: 'Ctrl+G q leave',
    },
    {
        locale: 'ko_KR.UTF-8',
        request: '  한국어 요청을 그대로 보존하고 고쳐 주세요  ',
        setupBlocked: '설정 필요 · 명령 메뉴에서 확인하세요',
        needed: '설정 필요 · Enter로 선택 · 요청 보존',
        ready: '입력 대기 · Enter 전송',
        repair: '요청을 보내지 않았습니다 · 작성한 내용은 보존됩니다',
        back: '요청으로 돌아가기\r',
        setup: '설정 열기',
        overview: '설정과 다음 동작',
        hiddenSetup: ['새 대화의 기본 모델', '대화 언어', '현재 브리지', '다음 실행 시 사용할 브리지'],
        menu: '명령 · Ctrl+G',
        leave: 'Ctrl+G q 종료',
    },
];

for (const scenario of cases) {
    test(`blocked ${scenario.locale} composer repairs setup without losing or sending its request`, { timeout: 20000 }, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-composer-readiness-')));
        const home = path.join(root, 'home'), observation = path.join(root, 'current.json');
        const file = path.join(root, 'terminal.json'), output = path.join(root, 'terminal.output');
        let passed = false;
        t.after(async () => {
            if (passed) await fs.rm(root, { recursive: true, force: true });
            else t.diagnostic('Retained composer readiness terminal ' + root);
        });
        const request = scenario.request, suffix = ' INPUT_OWNER_PROBE';
        const composer = (draft, send) => ({
            editorFocused: true, draft, contains: [scenario.needed, scenario.leave], absent: [scenario.ready], send,
        });
        const emptyComposer = (draft, send) => ({
            editorFocused: true, draft, contains: [scenario.setupBlocked, scenario.leave], absent: [scenario.ready, scenario.needed, scenario.repair], send,
        });
        const steps = [
            emptyComposer('', '\r'),
            emptyComposer('', paste('   ')),
            emptyComposer('   ', '\r'),
            emptyComposer('   ', '\x15' + paste(request)),
            composer(request, '\r'),
            { editorFocused: false, draft: request, contains: [scenario.repair, scenario.setup], send: scenario.back },
            composer(request, paste(suffix)),
            composer(request + suffix, '\x15' + paste(request)),
            composer(request, '\r'),
            { editorFocused: false, draft: request, contains: [scenario.repair, scenario.setup], send: scenario.setup + '\r' },
            { editorFocused: false, draft: request, contains: [scenario.overview], absent: scenario.hiddenSetup, send: '\x1b' },
            composer(request, paste(suffix)),
            composer(request + suffix, '\x15'),
            emptyComposer('', paste(request)),
            composer(request, '\x07'),
            { editorFocused: false, draft: request, contains: [scenario.menu], send: 'q' },
        ];
        await fs.writeFile(file, JSON.stringify({
            command: cli,
            env: {
                PATH: path.dirname(process.execPath), HOME: root, GITJIG_HOME: home, TMPDIR: root,
                GITJIG_COMPOSER_OBSERVATION: observation, LANG: scenario.locale, LC_ALL: scenario.locale,
                TERM: 'xterm-256color', NODE_OPTIONS: '', NODE_PATH: '',
            },
            observation, output, steps, database: path.join(home, 'state/controller.sqlite'), expectedFinalDraft: request,
        }), { mode: 0o600 });
        const result = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/composer-readiness-pty.py', file], {
            timeout: 17000, maxBuffer: 2 ** 20,
        })).stdout);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stages, steps.length);
        assert.equal(result.terminalRestored, true);
        assert.equal(result.retainedDraft, request);
        const frames = JSON.parse(await fs.readFile(output + '.frames.json', 'utf8'));
        assert.equal(frames.error, null);
        assert.equal(frames.snapshots.length, steps.length);
        passed = true;
    });
}

for (const scenario of cases) {
    test(`project draft opens its sole runtime repair directly in ${scenario.locale}`, {timeout:20000}, async t => {
        const {openController}=await import('../../dist/controller/index.js');
        const {ApplicationAccounts}=await import('../../dist/app/accounts.js');
        const {ApplicationModels}=await import('../../dist/app/models.js');
        const {translator}=await import('../../dist/ui/i18n.js');
        const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-project-draft-runtime-')));
        const home=path.join(root,'home'),project=path.join(root,'project'),observation=path.join(root,'current.json'),output=path.join(root,'terminal');
        let passed=false;
        t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained project draft runtime terminal '+root);});
        await fs.mkdir(project,{mode:0o700});
        const c=await openController({installationHome:home});
        let cid;
        try {
            await c.registerProject({id:'p',sourceRoot:project});
            await ApplicationAccounts.open(c).configure({providers:{'draft-fixture':{api:'openai-completions',apiKey:'DUMMY_DRAFT_FIXTURE',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
            const models=new ApplicationModels(c);
            cid=(await models.newConversation({projectId:'p',choice:await models.choice('draft-fixture','fixture')})).conversationId;
        } finally {await c.close();}
        const request=scenario.request,en=scenario.locale.startsWith('en'),tr=translator(en?'en':'ko');
        const repair=en?'Configure execution runtime':'실행 환경 설정';
        const state=(editorFocused,draft,contains,send,absent=[])=>({editorFocused,draft,contains,send,absent});
        const dialog=(contains,send,absent)=>state(false,request,contains,send,absent);
        const image='sha256:'+'a'.repeat(64);
        const heldEnter='\x1b[13;1:2u', releasedEnter='\x1b[13;1:3u';
        const heldCancel='\x1b['+'ㅊ'.codePointAt(0)+';5:2u';
        const steps=[
            state(true,'',[scenario.setupBlocked],paste(request)),
            state(true,request,[scenario.needed],'\r'),
            dialog([scenario.repair,repair],scenario.back,[scenario.setup]),
            state(true,request,[scenario.needed],'\r'),
            dialog([scenario.repair,repair],repair+'\r',[scenario.setup]),
            dialog([tr('runtime.title')],tr('runtime.edit')+'\r',[scenario.overview]),
            dialog([tr('runtime.dockerField')],heldEnter),
            dialog([tr('runtime.dockerField')],'/usr/bin/falsX\x1b[127;1:2ue\r'),
            dialog([tr('runtime.contextField')],'DRAFT_RUNTIME\r'),
            dialog([tr('runtime.imageField')],image+'\r'),
            dialog([tr('runtime.configField')],'\r'),
            dialog([tr('runtime.title'),'DRAFT_RUNTIME'],tr('runtime.review')+'\r'),
            dialog([tr('common.openSettingsConfirmation')],heldEnter+releasedEnter+heldCancel),
            dialog([tr('common.openSettingsConfirmation')],'\r'),
            dialog([tr('runtime.saveTitle')],'\x1b[1;1:2B'),
            dialog([tr('runtime.saveTitle'),'→ '+tr('runtime.save')],heldEnter+releasedEnter),
            dialog([tr('runtime.saveTitle'),'→ '+tr('runtime.save')],'\r'),
            state(true,request,[scenario.ready,tr('runtime.saved'),tr('requestSetup.submitKept',{submit:'Enter'})],'\x07',[scenario.overview,scenario.needed]),
            dialog([scenario.menu],'q'),
        ];
        const file=path.join(root,'terminal.json');
        await fs.writeFile(file,JSON.stringify({
            command:[...cli,'conversation','ui','--conversation',cid],
            env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TMPDIR:root,GITJIG_COMPOSER_OBSERVATION:observation,LANG:scenario.locale,LC_ALL:scenario.locale,TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},
            observation,output,steps,database:path.join(home,'state/controller.sqlite'),expectedFinalDraft:request,
        }),{mode:0o600});
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/composer-readiness-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
        assert.equal(result.exitCode,0);
        assert.equal(result.stages,steps.length);
        assert.equal(result.terminalRestored,true);
        assert.equal(result.retainedDraft,request);
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(home,'config/startup.json'),'utf8')).runtime,{
            dockerBinary:'/usr/bin/false',dockerContext:'DRAFT_RUNTIME',image,
        });
        passed=true;
    });
}

for (const projectScoped of [false,true]) {
    test(`composer preserves its unsent draft after model selection; runtime still needed=${projectScoped}`, {timeout:20000}, async t=>{
        const {openController}=await import('../../dist/controller/index.js');
        const {ApplicationAccounts}=await import('../../dist/app/accounts.js');
        const {ApplicationKeybindings}=await import('../../dist/app/keybindings.js');
        const {translator}=await import('../../dist/ui/i18n.js');
        const tr=translator('en'), root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-draft-model-return-')));
        const home=path.join(root,'home'), observation=path.join(root,'current.json'), output=path.join(root,'terminal');
        const request='  Keep this unsent request 한국어  ', model='draft-fixture/fixture';
        let passed=false;
        t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained draft model return '+root);});
        const c=await openController({installationHome:home});
        let cid;
        try {
            if(projectScoped){
                const source=path.join(root,'source');
                await fs.mkdir(source,{mode:0o700});
                await c.registerProject({id:'p',sourceRoot:source});
            }
            await ApplicationAccounts.open(c).configure({providers:{'draft-fixture':{api:'openai-completions',apiKey:'DUMMY_DRAFT_FIXTURE',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
            const keys = new ApplicationKeybindings(c).file;
            await fs.mkdir(path.dirname(keys),{recursive:true,mode:0o700});
            await fs.writeFile(keys,JSON.stringify({'tui.input.submit':'ctrl+t'}),{mode:0o600});
            cid=c.createConversation(projectScoped?{projectId:'p'}:undefined).conversationId;
        } finally {await c.close();}
        const setup='Setup needed · ctrl+t for options · request kept', returned=tr('requestSetup.submitKept',{submit:'ctrl+t'});
        const steps=[
            {editorFocused:true,draft:'',contains:[cases[0].setupBlocked],send:paste(request)},
            {editorFocused:true,draft:request,contains:[setup],absent:['Enter for options'],send:'\x14'},
            {editorFocused:false,draft:request,contains:[cases[0].repair,cases[0].setup],send:cases[0].setup+'\r'},
            {editorFocused:false,draft:request,contains:[tr('ready.modelNext')],send:tr('ready.modelNext')+'\r'},
            {editorFocused:false,draft:request,contains:[tr('model.title'),model],send:model+'\r'},
            {editorFocused:false,draft:request,contains:[tr(projectScoped?'ready.runtimeNext':'request.chatDraftNext')],send:tr(projectScoped?'ready.returnRequest':'request.chatDraftNext')+'\r'},
            {editorFocused:true,draft:request,contains:[tr('model.selected'),projectScoped?setup:returned],absent:projectScoped?[returned]:[setup],send:'\x07'},
            {editorFocused:false,draft:request,contains:[cases[0].menu],send:'q'},
        ];
        const file=path.join(root,'terminal.json');
        await fs.writeFile(file,JSON.stringify({
            command:[...cli,'conversation','ui','--conversation',cid],
            env:{PATH:path.dirname(process.execPath),HOME:root,GITJIG_HOME:home,TMPDIR:root,GITJIG_COMPOSER_OBSERVATION:observation,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''},
            observation,output,steps,database:path.join(home,'state/controller.sqlite'),expectedFinalDraft:request,
        }),{mode:0o600});
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/ui/composer-readiness-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
        assert.equal(result.exitCode,0);assert.equal(result.stages,steps.length);assert.equal(result.terminalRestored,true);
        const frames=JSON.parse(await fs.readFile(output+'.frames.json','utf8')).snapshots;
        assert.equal(frames[1].modelChoice.kind,'unbound');
        assert.equal(frames[6].modelChoice.kind,'managed');
        assert.equal(frames[6].modelChoice.provider,'draft-fixture');
        passed=true;
    });
}

test('Korean composer explains how to reopen its original external model profile and returns to the exact draft', {timeout:20000}, async t => {
    const {openController} = await import('../../dist/controller/index.js');
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-readiness-external-')));
    const home = path.join(root, 'home'), observation = path.join(root, 'current.json');
    const output = path.join(root, 'terminal'), file = path.join(root, 'terminal.json');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive:true,force:true});
        else t.diagnostic('Retained external-profile recovery terminal ' + root);
    });
    const controller = await openController({installationHome:home});
    let cid;
    try {
        const view = controller.createConversation();
        cid = view.conversationId;
        await controller.setConversationModelChoice({
            conversationId:cid, expectedGeneration:view.generation, expectedRevision:controller.getConversationModelChoice(cid).revision,
            choice:{kind:'legacy-external', provider:'original-provider', modelId:'original-model'},
        });
    } finally { await controller.close(); }

    const {request, needed, repair, setup, menu} = cases[1];
    const next = '다음 단계 · 기존 외부 모델 프로필로 다시 열기';
    const steps = [
        {editorFocused:true, draft:'', contains:[cases[1].setupBlocked, '모델: original-model · original-provider · 외부 프로필 필요'], send:paste(request)},
        {editorFocused:true, draft:request, contains:[needed], send:'\r'},
        {editorFocused:false, draft:request, contains:[repair, setup], send:setup+'\r'},
        {editorFocused:false, draft:request, contains:[next, 'original-provider/original-model · 지정된 프로필 사용'], send:'\r'},
        {editorFocused:false, draft:request, contains:['같은 앱 홈과 대화', '--model-profile', cid], send:'\x1b'},
        {editorFocused:false, draft:request, contains:[next, 'original-provider/original-model'], send:'\x1b'},
        {editorFocused:true, draft:request, contains:[needed], send:'\x07'},
        {editorFocused:false, draft:request, contains:[menu], send:'q'},
    ];
    await fs.writeFile(file, JSON.stringify({
        command:[...cli,'conversation','ui','--conversation',cid],
        env:{PATH:path.dirname(process.execPath), HOME:root, GITJIG_HOME:home, TMPDIR:root,
            GITJIG_COMPOSER_OBSERVATION:observation, LANG:'ko_KR.UTF-8', LC_ALL:'ko_KR.UTF-8', TERM:'xterm-256color', NODE_OPTIONS:'', NODE_PATH:''},
        observation, output, steps, database:path.join(home,'state/controller.sqlite'), expectedFinalDraft:request,
    }), {mode:0o600});
    const result = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/composer-readiness-pty.py',file], {timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(result.exitCode,0);
    assert.equal(result.stages,steps.length);
    assert.equal(result.terminalRestored,true);
    assert.equal(result.retainedDraft,request);
    const reopened = await openController({installationHome:home});
    try {
        const choice = reopened.getConversationModelChoice(cid);
        assert.equal(choice.kind,'legacy-external');
        assert.equal(choice.provider,'original-provider');
        assert.equal(choice.modelId,'original-model');
    } finally { await reopened.close(); }
    passed = true;
});
