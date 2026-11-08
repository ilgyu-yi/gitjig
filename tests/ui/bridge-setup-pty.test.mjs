import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {openController} from '../../dist/controller/index.js';
import {ApplicationStartup} from '../../dist/app/startup.js';
import {translator} from '../../dist/ui/i18n.js';

const execute = promisify(execFile);
const packageRoot = path.resolve(process.env.GITJIG_TEST_PACKAGE_ROOT ?? '.');
const cliEntry = process.env.GITJIG_TEST_CLI_ENTRY ?? path.join(packageRoot, 'dist/cli/entry.js');

for (const unknown of [false,true]) test(`Korean bridge check Escape ${unknown?'reports uncertain cleanup':'joins and returns to the original login'}`, {timeout:18000}, async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-bridge-check-stop-')));
    const home=path.join(root,'application'),operator=path.join(root,'operator'),bin=path.join(root,'bin');
    for(const dir of [operator,path.join(operator,'.claude'),bin])await fs.mkdir(dir,{mode:0o700});
    const client=path.join(bin,'claude'),calls=path.join(root,'calls'),held=path.join(root,'held'),ready=path.join(root,'ready');
    const worker=path.join(root,'client.mjs');
    await fs.writeFile(client,`#!/bin/sh\nexec '${process.execPath}' '${worker}' "$@"\n`,{mode:0o700});
    await fs.writeFile(worker,`
import fs from 'node:fs';import {spawn} from 'node:child_process';
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='--version'){fs.writeSync(1,'2.1.0 (Claude Code)\\n');process.exit(0);}
if(!args.includes('status'))process.exit(93);
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
fs.writeFileSync(${JSON.stringify(held)},JSON.stringify([process.pid,child.pid]));
fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`,{mode:0o700});
    const c=await openController({installationHome:home}),cid=c.createConversation().conversationId;
    c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:'ko'});
    await c.close();
    const guard=path.join(root,'guard.mjs'), file=path.join(root,'terminal.json'),output=file+'.terminal';
    await fs.writeFile(guard,`
import ${JSON.stringify(pathToFileURL(path.resolve('tests/cli/account-ui-no-network.mjs')).href)};
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const original=cp.spawn, kill=process.kill.bind(process);let group;
cp.spawn=(file,args,options)=>{if(file!==${JSON.stringify(client)})throw Error('Only original Claude status client allowed');const child=original(file,args,options);if(args.includes('status'))group=child.pid;return child;};
if(${unknown})process.kill=(pid,signal)=>{if(pid===-group)throw Object.assign(Error('Controlled group refusal'),{code:'EPERM'});return kill(pid,signal);};
syncBuiltinESMExports();`,{mode:0o600});
    const tr=translator('ko'), draft='/bridge', centre={assertDraft:draft,expectedSelected:cid,queries:['conversation_inputs','works','runs'].map(table=>({sql:`SELECT COUNT(*) FROM ${table}`,rows:[[0]]}))};
    const steps=[{wait:tr('footer.setup'),send:draft+'\r'},
        {wait:tr('bridge.discover'),...centre,send:tr('bridge.discover')+'\r'},
        {wait:tr('bridge.check'),...centre,send:tr('bridge.check')+'\r'},
        {wait:tr('bridge.checkProgress'),waitFiles:[{path:ready,value:'ready'}],...centre,send:'\x1b'},
        ...(unknown?[
            {wait:'CLAUDE_SETUP_CLEANUP_UNKNOWN',...centre,send:'\x07e'},
            {wait:tr('error.details'),...centre,send:tr('error.details')+'\r'},
            {wait:'recorded native process group',...centre,send:'\x1b'},
            {wait:tr('error.details'),...centre,send:'\x1b'},
            {wait:'CLAUDE_SETUP_CLEANUP_UNKNOWN',...centre,send:'\x07q'},
        ]:[
            {wait:'로그인 확인 취소 · 선택한 로그인 유지',...centre,send:'\x1b'},
            {wait:tr('interaction.commandCancelled',{submit:''}).split(' · ').slice(0,2).join(' · '),...centre,send:'\x07q'},
        ]),
    ];
    const entry=[process.execPath,'--import',guard,cliEntry];
    await fs.writeFile(file,JSON.stringify({command:[...entry,'conversation','ui','--home',home,'--conversation',cid],
        env:{HOME:operator,PATH:bin+':/usr/bin:/bin',GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,database:path.join(home,'state/controller.sqlite'),output,timeoutSeconds:9,rows:45,columns:150,gracefulShutdownSeconds:3}));
    try {
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:14500})).stdout);
        assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[unknown?2:0,steps.length,true]);
        const ids=JSON.parse(await fs.readFile(held,'utf8'));
        if(unknown) assert.match(await fs.readFile(output,'utf8'),new RegExp('process group '+ids[0]));
        else for(const pid of ids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
        assert.equal((await fs.readFile(calls,'utf8')).trim().split('\n').length,2);
        await assert.rejects(fs.access(path.join(home,'config/startup.json')),{code:'ENOENT'});
    } catch(error) { t.diagnostic((await fs.readFile(output,'utf8').catch(()=> '')).slice(-6500)); throw error; }
    finally {
        const ids=await fs.readFile(held,'utf8').then(JSON.parse,()=>[]);
        if(ids.length) {
            try{process.kill(-ids[0],'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
            const deadline=Date.now()+2400;
            while(Date.now()<deadline) {
                try{process.kill(-ids[0],0);}catch(error){if(error.code==='ESRCH')break;throw error;}
                await new Promise(resolve=>setTimeout(resolve,20));
            }
            assert.throws(()=>process.kill(-ids[0],0),{code:'ESRCH'});
        }
        await fs.rm(root,{recursive:true,force:true});
    }
});

for (const [scope,locale] of [['saved','en'],['current','ko']]) test(`actual /bridge opens the ${scope} runtime prerequisite before native login`,{timeout:18000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-bridge-runtime-')));
    const home=path.join(root,'application'),config=path.join(root,'docker-config'),file=path.join(root,'terminal.json');
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    await fs.mkdir(config,{mode:0o700});
    const runtime={dockerBinary:'/usr/bin/false',dockerContext:'saved-route',image:'sha256:'+'1'.repeat(64)};
    const current={...runtime,dockerContext:'invocation-route'};
    const c=await openController({installationHome:home});
    const cid=c.createConversation().conversationId;
    c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:0,replyLanguage:locale});
    await ApplicationStartup.open(c).save({version:1,runtime:{...runtime,...scope==='current'?{dockerConfigDirectory:config}:{}}});
    await c.close();
    const startup=path.join(home,'config/startup.json'),saved=await fs.readFile(startup,'utf8'), tr=translator(locale);
    const noWork=['conversation_inputs','works','runs'].map(table=>({sql:`SELECT COUNT(*) FROM ${table}`,rows:[[0]]}));
    const unchanged={assertDraft:'/bridge',textFiles:[{path:startup,value:saved}],queries:noWork};
    const title=locale==='en'?'Saved runtime needs a Docker configuration directory':'현재 실행 환경에 Docker 설정 디렉터리 필요';
    const action=locale==='en'?'Edit saved runtime settings':'현재 실행 환경 편집';
    const seeded=tr('runtime.stagedContext',{value:JSON.stringify(scope==='saved'?runtime.dockerContext:current.dockerContext)});
    const steps=[
        {wait:tr('footer.setup'),send:'/bridge\r'},
        {wait:title,...unchanged,send:action+'\r'},
        {wait:seeded,...unchanged,send:'\x1b'},
        {wait:title,...unchanged,send:scope==='saved'?action+'\r':'\x1b'},
        ...(scope==='saved'?[
            {wait:seeded,...unchanged,send:tr('runtime.edit')+'\r'},
            {wait:tr('runtime.dockerField'),...unchanged,send:'\r'},
            {wait:tr('runtime.contextField'),...unchanged,send:'\r'},
            {wait:tr('runtime.imageField'),...unchanged,send:'\r'},
            {wait:tr('runtime.configField'),...unchanged,send:config+'\r'},
            {wait:seeded,...unchanged,send:tr('runtime.review')+'\r'},
            {wait:tr('common.openSettingsConfirmation'),...unchanged,send:'\r'},
            {wait:tr('runtime.saveTitle'),...unchanged,send:tr('runtime.save')+'\r'},
            {wait:'Runtime settings saved · reopen /bridge to continue',queries:noWork,send:'\x15/bridge\r'},
            {wait:tr('bridge.discover'),queries:noWork,send:'\x1b'},
            {wait:tr('interaction.commandCancelled',{submit:''}).split(' · ').slice(0,2).join(' · '),queries:noWork,send:'\x07q'},
        ]:[{wait:tr('interaction.commandCancelled',{submit:''}).split(' · ').slice(0,2).join(' · '),...unchanged,send:'\x07q'}]),
    ];
    const entry=[process.execPath,'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),cliEntry];
    const override=scope==='current'?['--docker-binary',current.dockerBinary,'--docker-context',current.dockerContext,'--image',current.image]:[];
    await fs.writeFile(file,JSON.stringify({command:[...entry,'conversation','ui','--home',home,'--conversation',cid,...override],
        env:{HOME:root,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',GITJIG_HOME:home,TMPDIR:root,TERM:'xterm-256color',LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''},
        steps,database:path.join(home,'state/controller.sqlite'),output:file+'.terminal',timeoutSeconds:10,rows:42,columns:156,gracefulShutdownSeconds:3}));
    try {
        const result=JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:15000})).stdout);
        assert.deepEqual([result.exitCode,result.stages,result.terminalRestored],[0,steps.length,true]);
        if(scope==='saved') {
            const terminal=await fs.readFile(file+'.terminal','utf8');
            const returned=terminal.slice(terminal.lastIndexOf('Runtime settings saved · reopen /bridge to continue'));
            assert.ok(returned.includes(tr('bridge.discover'))&&!returned.includes(title));
        }
    } catch(error) { t.diagnostic((await fs.readFile(file+'.terminal','utf8').catch(()=> '')).slice(-4000)); throw error; }
    const after=await fs.readFile(startup,'utf8');
    if(scope==='saved') assert.deepEqual(JSON.parse(after),{version:1,runtime:{...runtime,dockerConfigDirectory:config}});
    else assert.equal(after,saved);
    await assert.rejects(fs.access(path.join(home,'config/claude-bridge')),{code:'ENOENT'});
});

for (const locale of ['en','ko']) test('owned Claude profile refusal restores its connection recovery after reopen in '+locale, {timeout:26000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-bridge-refusal-')));
    const home = path.join(root,'application'), agentDir = path.join(root,'agent'), cwd = path.join(root,'native-cwd');
    const executable = path.join(root,'claude'), worker = path.join(root,'protocol.mjs'), calls = path.join(root,'native-calls');
    const account = path.join(root,'account'), operator = path.join(root,'operator');
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained bridge rejection terminal '+root);
    });
    for (const directory of [agentDir,path.join(agentDir,'home'),cwd,account,operator])
        await fs.mkdir(directory,{mode:0o700});
    await fs.writeFile(path.join(agentDir,'claude-bridge.json'),
        '{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}',{mode:0o600});
    await fs.writeFile(worker, [
        "import readline from 'node:readline';",
        "import {appendFileSync} from 'node:fs';",
        "if (process.argv[2] === '--version') { console.log('2.1.0 (Claude Code)'); process.exit(0); }",
        "const write = body => console.log(JSON.stringify(body));",
        "for await (const line of readline.createInterface({input:process.stdin})) {",
        "    const frame = JSON.parse(line);",
        "    if (frame.type === 'control_request') write({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:{commands:[],models:[],output_style:'default',available_output_styles:[]}}});",
        "    if (frame.type !== 'user') continue;",
        "    appendFileSync("+JSON.stringify(calls)+",'query\\n',{mode:0o600});",
        "    write({type:'system',subtype:'init',session_id:'owned-incompatible-init',model:'claude-opus-5-5',tools:['unexpected-fixture-tool'],plugins:[],mcp_servers:[],cwd:process.cwd()});",
        "    break;",
        "}",
    ].join('\n'),{mode:0o600});
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const wrapper = '#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(worker)+' "$@"\n';
    await fs.writeFile(executable,wrapper,{mode:0o700});
    const env = {HOME:operator,TMPDIR:path.join(home,'artifacts'),GITJIG_HOME:home,TERM:'xterm-256color',USER:'fixture',
        PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',NODE_OPTIONS:'',NODE_PATH:''};
    const c = await openController({installationHome:home});
    let cid;
    try {
        await ApplicationStartup.open(c).save({version:1,bridge:{profile:{kind:'installed-claude-bridge',cwd,agentDir,
            executable:{file:executable,sha256:createHash('sha256').update(wrapper).digest('hex')}},nativeAccountDirectory:account}});
        const view = c.createConversation();
        cid = view.conversationId;
        c.setConversationView({selectedId:cid});
    } finally { await c.close(); }
    const startup = path.join(home,'config/startup.json'), saved = await fs.readFile(startup,'utf8');
    const tr = translator(locale), original = 'Original Claude request', draft = 'Unsent draft · 한글';
    const unboundAccounts = tr('ready.accounts', {accounts: tr('value.noneAccounts'), action: tr('ready.chooseAccountSource')});
    const bridgeAccount = tr('ready.accounts', {accounts: tr('model.route.claudeAccount'), action: tr('ready.manageBridge')});
    const diagnostic = 'BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: tools';
    const unchanged = [
        {sql:'SELECT state,text FROM conversation_inputs',rows:[['CONSUMED',original]]},
        {sql:"SELECT phase,json_extract(data,'$.outcome') FROM runs",rows:[['SETTLED','unavailable']]},
        {sql:"SELECT json_extract(data,'$.result.bridgeProfileMismatch') FROM conversation_results",rows:[['tools']]},
    ];
    async function launch(name, steps) {
        const file = path.join(root,name+'.json'), output = file+'.terminal';
        await fs.writeFile(file,JSON.stringify({command:[process.execPath,'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),cliEntry,
            'conversation','ui','--home',home,'--conversation',cid],env,steps,output,timeoutSeconds:8,gracefulShutdownSeconds:3,
            database:path.join(home,'state/controller.sqlite')}));
        const result = JSON.parse((await execute('/usr/bin/python3',['tests/cli/fork-ui-pty.py',file],{timeout:12500,maxBuffer:2**20})).stdout);
        assert.equal(result.exitCode,0);
        assert.equal(result.stages,steps.length);
        assert.equal(result.terminalRestored,true);
        return fs.readFile(output,'utf8');
    }
    await launch('live',[
        {wait:tr('footer.setup'),send:'\x07t'},
        {wait:tr('ready.title'),send:unboundAccounts+'\r'},
        {wait:tr('bridge.accountChoice'),send:tr('bridge.nativeAccount')+'\r'},
        {wait:tr('bridge.discover'),send:'\x1b'},
        {wait:tr('ready.title'),send:'\x1b'},
        {wait:tr('footer.setup'),send:'/model claude-bridge/claude-opus-5-5\x1b\r'},
        {wait:tr('model.selected'),send:original+'\x1b\r'},
        {wait:tr('error.bridgeProfile'),queries:unchanged,waitIdle:true,send:draft+'\x07e'},
        {wait:tr('error.bridgeSettings'),queries:unchanged,assertDraft:draft,expectedInputs:1,send:'\x1b'},
        {wait:tr('footer.setup'),queries:unchanged,assertDraft:draft,expectedInputs:1,send:'\x07q'},
    ]);
    if (locale === 'en') {
        const reopened = await openController({installationHome:home});
        const store = reopened.store, rollback = Error('Discard changed bridge evidence');
        try {
            const originalFailure = reopened.inspectConversationResponseFailure(cid);
            assert.equal(originalFailure?.bridgeProfileMismatch,'tools');
            const terminalObservation = "json_extract(data,'$.kind')='native-terminal-unavailable'";
            const controls = [
                ['changed original provider', () => store.run("UPDATE runs SET data=json_set(data,'$.ordinaryRoleBinding.mode.baseline.choice.provider','other-provider')")],
                ['missing terminal observation', () => store.run('DELETE FROM observations WHERE '+terminalObservation)],
                ['duplicate terminal observation', () => store.run("INSERT INTO observations SELECT 'conflicting-observation',run,data FROM observations WHERE "+terminalObservation)],
                ['different terminal reason', () => store.run("UPDATE observations SET data=json_set(data,'$.errorMessage','other native refusal') WHERE "+terminalObservation)],
                ['quoted error resembles a marker', () => {
                    const published = JSON.parse(store.one('SELECT data FROM conversation_results').data);
                    published.result.failure = 'Provider quoted '+diagnostic;
                    published.publicationHash = createHash('sha256').update(JSON.stringify(published.result)).digest('hex');
                    store.run('UPDATE conversation_results SET data=?',JSON.stringify(published));
                }],
            ];
            for (const [label,change] of controls) assert.throws(() => store.tx(() => {
                change();
                const failure = reopened.inspectConversationResponseFailure(cid);
                assert.ok(failure?.failure.includes(diagnostic),label);
                assert.equal(failure.bridgeProfileMismatch,undefined,label);
                throw rollback;
            }), error => error === rollback);
            assert.deepEqual(reopened.inspectConversationResponseFailure(cid),originalFailure);
        } finally { await reopened.close(); }
    }
    const output = await launch('reopen',[
        {wait:tr('footer.setup'),queries:unchanged,assertDraft:draft,expectedInputs:1,send:'\x07e'},
        {wait:tr('error.bridgeModel'),send:tr('error.details')+'\r'},
        {wait:tr('error.detailsTitle'),send:'\x1b'},
        {wait:tr('error.bridgeSettings'),send:tr('error.bridgeSettings')+'\r'},
        {wait:tr('bridge.details'),queries:unchanged,assertDraft:draft,expectedInputs:1,send:tr('bridge.details')+'\r'},
        {wait:tr('bridge.scope').split('. ')[0],queries:unchanged,send:'\x1b'},
        {wait:tr('bridge.model'),queries:unchanged,assertDraft:draft,expectedInputs:1,send:tr('bridge.model')+'\r'},
        {wait:tr('model.title'),queries:unchanged,send:'\x1b'},
        {wait:tr('bridge.model'),queries:unchanged,assertDraft:draft,expectedInputs:1,send:'\x1b'},
        {wait:tr('error.bridgeModel'),send:tr('error.bridgeModel')+'\r'},
        {wait:tr('model.title'),queries:unchanged,send:'\x1b'},
        {wait:tr('error.bridgeSettings'),send:'\x1b'},
        {wait:tr('footer.setup'),assertDraft:draft,expectedInputs:1,queries:unchanged,send:'\x07t'},
        {wait:tr('ready.title'),queries:unchanged,send:bridgeAccount+'\r'},
        {wait:tr('bridge.discover'),queries:unchanged,send:'\x1b'},
        {wait:tr('ready.title'),queries:unchanged,send:'\x1b'},
        {wait:tr('footer.setup'),assertDraft:draft,expectedInputs:1,queries:unchanged,send:'\x07q'},
    ]);
    assert.ok(output.includes(diagnostic));
    assert.equal(await fs.readFile(startup,'utf8'),saved);
    assert.equal(await fs.readFile(calls,'utf8'),'query\n');
    passed = true;
});

const locales = {
    en: {
        setup: 'Startup settings · choose an action', inspect: 'Startup configuration',
        guided: 'Connect an existing Claude Code login', advanced: 'Edit advanced Claude bridge fields',
        discover: 'Find native Claude Code clients',
        changeRoute: 'Choose another login source', check: 'Check native login',
        account: 'Native login check', review: 'Review connection',
        reviewTitle: 'Review Claude Code connection', connect: 'Connect · save for next launch',
        openConfirmation: 'Open settings confirmation', repair: 'Review private-permission repair',
        openRepair: 'Open permission repair confirmation', repairConfirm: 'Protect these listed paths',
        next: 'Connection saved · next action', restart: 'Show close and relaunch instructions',
        close: 'Return to conversation',
    },
    ko: {
        setup: '시작 설정 · 동작 선택', inspect: '시작 설정',
        guided: '기존 Claude Code 로그인 연결', advanced: 'Claude 브리지 고급 항목 편집',
        discover: 'Claude Code 클라이언트 찾기',
        changeRoute: '다른 로그인 경로 선택', check: '네이티브 로그인 확인',
        account: '네이티브 로그인 확인 결과', review: '연결 내용 검토',
        reviewTitle: 'Claude Code 연결 검토', connect: '연결 · 다음 실행 설정 저장',
        openConfirmation: '설정 확인 화면 열기', repair: '비공개 접근 권한 수정 검토',
        openRepair: '권한 수정 확인 화면 열기', repairConfirm: '표시된 경로를 비공개로 보호',
        next: '연결 저장됨 · 다음 단계', restart: '종료 후 다시 실행하는 방법 보기',
        close: '대화로 돌아가기',
    },
};

for (const [locale, copy, invalidatePolicy] of [...Object.entries(locales), ['en', locales.en, true]]) {
    const scenario = invalidatePolicy ? 'post-save policy loss asks for repair' : 'startup menu connects using pre-projection operator HOME';
    test('original ' + locale + ' ' + scenario, {timeout: 25000}, async t => {
        const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-guided-bridge-ui-')));
        const home = path.join(root, 'application'), operator = path.join(root, 'operator');
        const executable = path.join(root, 'bin/claude'), nativeLog = path.join(root, 'native.jsonl');
        const profile = path.join(root, 'terminal.json'), output = profile + '.terminal';
        let passed = false;
        t.after(async () => {
            if (passed) await fs.rm(root, {recursive: true, force: true});
            else t.diagnostic('Retained guided bridge terminal ' + root);
        });
        for (const name of ['bin', 'operator', 'operator/.claude', 'old-host', 'old-agent', 'old-agent/home', 'old-account'])
            await fs.mkdir(path.join(root, name), {mode: 0o700});
        await fs.chmod(path.join(operator, '.claude'), 0o755);
        const secret = 'PRIVATE_NATIVE_ACCOUNT_CONTENT_MUST_NOT_APPEAR';
        await fs.writeFile(path.join(operator, '.claude/private-token'), secret, {mode: 0o600});
        const authArguments = ['--setting-sources', '', '--settings', JSON.stringify({
            disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false,
            enabledPlugins: {'agents-md@builtin': false, 'plugin-authoring@builtin': false},
        }), 'auth', 'status', '--json'];
        const account = {loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'fixture@example.invalid', orgId: 'org_fixture', orgName: 'Fixture Org', subscriptionType: 'team'};
        const nativeWorker = path.join(root, 'native-fixture.cjs');
        await fs.writeFile(nativeWorker,
            'const fs=require("node:fs");const args=process.argv.slice(2);' +
            'fs.appendFileSync(' + JSON.stringify(nativeLog) + ',JSON.stringify({args,home:process.env.HOME,config:process.env.CLAUDE_CONFIG_DIR})+"\\n",{mode:0o600});' +
            'if(args.length===1&&args[0]==="--version")console.log("2.1.0 (Claude Code)");' +
            'else if(JSON.stringify(args)===' + JSON.stringify(JSON.stringify(authArguments)) + ')console.log(' + JSON.stringify(JSON.stringify(account)) + ');' +
            'else process.exitCode=81;\n', {mode: 0o700});
        const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
        await fs.writeFile(executable, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(nativeWorker) + ' "$@"\n', {mode: 0o700});
        const policy = '{"askClaude":{"enabled":false},"provider":{"strictMcpConfig":true,"autoMemoryEnabled":false}}';
        await fs.writeFile(path.join(root, 'old-agent/claude-bridge.json'), policy, {mode: 0o600});
        const controller = await openController({installationHome: home});
        try {
            await ApplicationStartup.open(controller).save({version: 1, bridge: {
                profile: {kind: 'installed-claude-bridge', cwd: path.join(root, 'old-host'), agentDir: path.join(root, 'old-agent'), executable: {file: executable, sha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex')}},
                nativeAccountDirectory: path.join(root, 'old-account'),
            }});
        }
        finally { await controller.close(); }
        const startupFile = path.join(home, 'config/startup.json');
        const before = [{path: startupFile, value: await fs.readFile(startupFile, 'utf8')}];
        // Deny all native commands except this owned finite fixture, and deny network.
        const boundary = path.join(root, 'native-boundary.mjs');
        await fs.writeFile(boundary, 'import ' + JSON.stringify(pathToFileURL(path.resolve('tests/cli/account-ui-no-network.mjs')).href) + ';\n' +
            'import cp from "node:child_process";import {syncBuiltinESMExports} from "node:module";\n' +
            'const original=cp.spawn;let denied=0;const deny=()=>{denied++;throw Error("Unexpected native command during guided connection");};\n' +
            'cp.spawn=(file,args,options)=>file===' + JSON.stringify(executable) + '?original(file,args,options):deny();\n' +
            'for(const name of ["spawnSync","exec","execSync","execFile","execFileSync","fork"])cp[name]=deny;syncBuiltinESMExports();process.on("exit",()=>{if(denied)process.exitCode=82;});\n', {mode: 0o600});
        if (invalidatePolicy)
            await fs.appendFile(boundary, `import fs from 'node:fs';import promises from 'node:fs/promises';import path from 'node:path';
                const realpath = promises.realpath; let removed = false;
                promises.realpath = async function(file, ...args) {
                    const agent = JSON.parse(fs.readFileSync(${JSON.stringify(startupFile)}, 'utf8')).bridge.profile.agentDir;
                    if (!removed && agent !== ${JSON.stringify(path.join(root, 'old-agent'))} && file === path.join(agent, 'claude-bridge.json')) {
                        fs.unlinkSync(file);
                        removed = true;
                    }
                    return realpath.call(this, file, ...args);
                };
                syncBuiltinESMExports();`);
        const empty = [{sql: 'SELECT COUNT(*) FROM works', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM runs', rows: [[0]]}, {sql: 'SELECT COUNT(*) FROM conversation_inputs', rows: [[0]]}];
        const steps = [
            {wait: '/ready', send: '/setup\x1b\r'},
            {wait: copy.setup, waitFiles: before, queries: empty, send: '\r'},
            {wait: ' · {"runtime":"none","bridge":"saved"}', waitFiles: before, queries: empty, send: '\x1b'},
            {wait: '/ready', waitFiles: before, queries: empty, assertDraft: '', send: '/setup\x1b\r'},
            {wait: copy.setup, waitFiles: before, queries: empty, send: copy.guided + '\r'},
            {wait: copy.discover, send: copy.discover + '\r'},
            {wait: copy.changeRoute, send: copy.changeRoute + '\r'},
            {wait: 'Current operator home', send: 'Current operator home\r'},
            {wait: copy.check, send: copy.check + '\r'},
            {wait: copy.repair, send: '\x1b'},
            {wait: copy.check, send: copy.repair + '\r'},
            {wait: copy.openRepair, waitFiles: before, send: '\x1b'},
            {wait: copy.check, send: copy.repair + '\r'},
            {wait: copy.openRepair, waitFiles: before, send: '\r'},
            {wait: copy.repairConfirm, queries: empty, send: copy.repairConfirm + '\r'},
            {wait: copy.check, send: copy.check + '\r'},
            {wait: copy.account, send: '\x1b'},
            {wait: copy.review, send: copy.review + '\r'},
            {wait: copy.openConfirmation, waitFiles: before, send: '\x1b'},
            {wait: copy.review, send: copy.review + '\r'},
            {wait: copy.openConfirmation, waitFiles: before, send: '\r'},
            {wait: copy.connect, waitFiles: before, queries: empty, send: copy.connect + '\r'},
            ...(invalidatePolicy ? [
                {wait: 'Saved startup setup requires repair', send: copy.close + '\r'},
            ] : [
                {wait: copy.next, queries: empty, send: translator(locale)('bridge.ready') + '\r'},
                {wait: translator(locale)('ready.title'), queries: empty, send: '\x1b'},
                {wait: copy.next, send: copy.restart + '\r'},
                {wait: '--conversation', queries: empty, send: '\x1b'},
                {wait: copy.next, send: copy.close + '\r'},
            ]),
            {wait: '/ready', queries: empty, assertDraft: '', send: '/quit\x1b\r'},
        ];
        await fs.writeFile(profile, JSON.stringify({command: [process.execPath, '--import', boundary, cliEntry],
            env: {PATH: path.dirname(executable) + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: operator, USER: 'gitjig-fixture', LOGNAME: 'gitjig-fixture', GITJIG_HOME: home, TMPDIR: root, TERM: 'xterm-256color', LANG: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', LC_ALL: locale === 'ko' ? 'ko_KR.UTF-8' : 'en_US.UTF-8', SHELL: '/bin/sh', NODE_OPTIONS: '', NODE_PATH: ''},
            steps, timeoutSeconds: 15, expectedInputs: 0, database: path.join(home, 'state/controller.sqlite'), output, gracefulShutdownSeconds: 3}));
        try {
            const result = JSON.parse((await execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', profile], {timeout: 20000, maxBuffer: 2 ** 20})).stdout);
            assert.equal(result.exitCode, 0);
            assert.equal(result.stages, steps.length);
            assert.equal(result.terminalRestored, true);
            const terminal = await fs.readFile(output, 'utf8');
            assert.doesNotMatch(terminal, new RegExp(secret));
            assert.match(terminal, /fixture@example\.invalid/u);
            assert.ok(terminal.includes(copy.advanced));
            assert.ok(terminal.includes(copy.inspect));
            assert.ok(terminal.includes(copy.reviewTitle));
            assert.ok(terminal.includes(locale === 'ko' ? '여기서는 계정 상태만 확인합니다.' : 'This checks account status only.'));
            const startup = JSON.parse(await fs.readFile(path.join(home, 'config/startup.json'), 'utf8'));
            assert.equal(startup.bridge.nativeAccountHome, operator);
            assert.equal(startup.bridge.nativeAccountDirectory, path.join(operator, '.claude'));
            assert.notEqual(startup.bridge.profile.agentDir, path.join(root, 'old-agent'));
            const postSave = terminal.slice(terminal.indexOf(copy.next));
            assert.ok(postSave.includes(locale === 'ko' ? '현재 세션에서 사용할 모델 선택' : 'Choose a model for this session'));
            if (invalidatePolicy) {
                assert.match(postSave, /Saved for next launch: saved setup requires repair/);
                assert.doesNotMatch(postSave, /Saved for next launch: Configured|Show close and relaunch instructions/);
                await assert.rejects(fs.access(path.join(startup.bridge.profile.agentDir, 'claude-bridge.json')), {code: 'ENOENT'});
            }
            const native = (await fs.readFile(nativeLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
            const auth = native.filter(row => row.args.includes('auth'));
            assert.ok(auth.every(row => JSON.stringify(row.args) === JSON.stringify(authArguments)));
            assert.equal(auth.length, 2, 'Check and reviewed Connect each recheck the exact native account');
            assert.ok(auth.every(row => row.home === operator && row.config === undefined));
            assert.equal(await fs.readFile(path.join(operator, '.claude/private-token'), 'utf8'), secret);
            assert.equal((await fs.stat(path.join(operator, '.claude'))).mode & 0o777, 0o700);
            passed = true;
        }
        catch (error) {
            t.diagnostic((await fs.readFile(output, 'utf8').catch(() => '')).slice(-9000));
            throw error;
        }
    });
}
