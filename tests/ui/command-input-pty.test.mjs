import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openController} from '../../dist/controller/index.js';
import {seedForkUI} from './fork-fixture.mjs';

const execute=promisify(execFile);

test('Escape dismisses a pending slash completion before it is drawn', {timeout:15000}, async t => {
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-pending-completion-')));
    let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained pending completion terminal '+root);});
    const home=path.join(root,'home'),file=path.join(root,'terminal.json'),gate=path.join(root,'completion'),guard=path.join(root,'guard.mjs');
    const controller=await openController({installationHome:home});
    const cid=controller.createConversation().conversationId;await controller.close();
    const packageRoot=process.env.GITJIG_TEST_PACKAGE_ROOT??path.resolve('.');
    await fs.writeFile(guard, `
import fs from 'node:fs/promises';
import {HostCommands} from ${JSON.stringify(pathToFileURL(path.join(packageRoot,'dist/ui/host-commands.js')).href)};
const original=HostCommands.prototype.autocompleteFor, gate=${JSON.stringify(gate)};
let held=false;
HostCommands.prototype.autocompleteFor=function(...args){
    const provider=original.apply(this,args),suggest=provider.getSuggestions.bind(provider);
    provider.getSuggestions=async(lines,line,column,options)=>{
        if(!held&&lines[line]?.slice(0,column)==='/mo'){
            held=true;
            const result=await suggest(lines,line,column,options);
            if(!result?.items.length)throw Error('Expected original slash candidates');
            await fs.writeFile(gate+'.entered','entered');
            while(!await fs.access(gate+'.release').then(()=>true,()=>false))await new Promise(resolve=>setTimeout(resolve,5));
            await fs.writeFile(gate+'.settled',String(options.signal.aborted));
            return result;
        }
        return suggest(lines,line,column,options);
    };
    return provider;
};
`);
    const observation=file+'.current',output=file+'.terminal';
    const retained={editorFocused:true,draft:'/mo',autocomplete:false,unchanged:true};
    await fs.writeFile(file,JSON.stringify({cid,observation,output,timeoutSeconds:7,steps:[
        {editorFocused:true,draft:'',baseline:true,send:'/mo'},
        {...retained,waitFiles:[{path:gate+'.entered'}],send:'\x1b[27u'},
        {...retained,releaseFile:gate+'.release',send:''},
        {...retained,waitFiles:[{path:gate+'.settled'}],send:'\x07q'},
    ],command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
        '--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',guard,'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid],
    env:{...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,GITJIG_RESULT_OBSERVATION:observation,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:13500,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,4);assert.equal(receipt.terminalRestored,true);
    assert.equal(await fs.readFile(gate+'.settled','utf8'),'true');
    passed=true;
});

for (const locale of ['en', 'ko']) test(`transcript search accepts Dubeolsik control keys in ${locale}`, {timeout:18000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-transcript-keys-')));
    const home = path.join(root, 'home'), file = path.join(root, 'terminal.json');
    const observation = file + '.current', output = file + '.terminal';
    let passed = false;
    t.after(async () => {
        if (passed) await fs.rm(root, {recursive:true, force:true});
        else t.diagnostic('Retained transcript key terminal ' + root);
    });
    const controller = await openController({installationHome:home});
    const {source, file:history} = await seedForkUI(controller, root, home);
    const cid = source.conversationId, historyBefore = await fs.readFile(history);
    controller.setConversationView({selectedId:cid, secondId:null});
    await controller.close();
    const ko = locale === 'ko', language = ko ? 'ko_KR.UTF-8' : 'en_US.UTF-8';
    const draft = '보존할 한글 초안', query = 'ㅎ 한글 검색';
    const searchTitle = 'Find in transcript', menuTitle = ko ? '명령 · Ctrl+G 다음에 문자 입력' : 'Commands · Ctrl+G, then a letter';
    const completion = ko ? 'Esc 자동완성 닫기' : 'Esc closes suggestions';
    const help = ko ? '/ㅗㄷㅣㅔ' : '/help', helpTitle = ko ? 'gitjig 명령 검색' : 'Gitjig commands · search';
    const prefix=help.slice(0,-1), edited=prefix+'x';
    const chord = (key, modifiers, event = '') => `\x1b[${key.codePointAt(0)};${modifiers}${event}u`;
    const editor = {editorFocused:true, draft, unchanged:true, absent:[searchTitle]};
    const search = {editorFocused:false, draft, unchanged:true,
        absent:[menuTitle,ko?'요청을 보내지 않았습니다':'Request not sent']};
    const steps = [
        {editorFocused:true, draft:'', baseline:true, send:draft},
        {...editor, send:chord('f', 6)},
        {...search, contains:[searchTitle], send:'\x1b[13;3u'},
        {...search, contains:[searchTitle], send:'\x1b\r'},
        {...search, contains:[searchTitle], send:'\x1b'},
        {...editor, absent:[], send:chord('ㄹ', 6, ':3')},
        {...editor, send:chord('ㄹ', 6)},
        {...search, contains:[searchTitle], send:'\x1b[200~'+query+'\x1b[201~'},
        {...search, contains:[query,'No matches'], send:'\x15CONTEXT'},
        {...search, contains:['1/2'], send:chord('ㅎ', 5)},
        {...search, contains:['2/2'], send:chord('ㅎ', 6)},
        {...search, contains:['1/2'], send:'\x1b'},
        {...editor, absent:[], send:'\x15'+prefix},
        {...editor, draft:prefix, autocomplete:true, contains:[completion], send:'x\x1b[13u'},
        {...editor, draft:edited, autocomplete:false, send:'\x15'+prefix},
        {...editor, draft:prefix, autocomplete:true, contains:[completion], send:help.at(-1)+'\x1b[13u'},
        {...editor, draft:help, autocomplete:false, send:'\x1b[13u'},
        {...editor, editorFocused:false, draft:help, contains:[helpTitle], send:'\x1b'},
        {...editor, draft:help, autocomplete:false, send:'\x15'+help},
        {...editor, draft:help, autocomplete:true, contains:[completion], send:'\x1b[13;3u'},
        {...editor, draft:help, autocomplete:true, contains:[completion], send:'\x1b\r'},
        {...editor, draft:help, autocomplete:true, contains:[completion], send:'\x1b[27u\x1b[13u'},
        {...editor, editorFocused:false, draft:help, contains:[helpTitle], send:'\x1b'},
        {...editor, draft:help, autocomplete:false, send:'\x15'+draft},
        {...editor, send:chord('ㅎ', 5)},
        {editorFocused:false, draft, unchanged:true, contains:[menuTitle], send:'ㅂ'},
    ];
    const command = [process.execPath,
        ...(process.env.GITJIG_UI_MODULE_GUARD ? ['--import', process.env.GITJIG_UI_MODULE_GUARD] : []),
        '--import', path.resolve('tests/ui/readiness-no-execution.mjs'),
        '--import', path.resolve('tests/ui/inspection-pty-observer.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY ?? path.resolve('dist/cli/entry.js'),
        'conversation','ui','--home',home,'--conversation',cid];
    const env = {...process.env, HOME:root, GITJIG_HOME:home, TMPDIR:root, LANG:language, LC_ALL:language,
        TERM:'xterm-256color', NODE_OPTIONS:'', NODE_PATH:'', GITJIG_RESULT_OBSERVATION:observation};
    await fs.writeFile(file, JSON.stringify({cid, command, env, output, observation, steps, columns:90, timeoutSeconds:9}));
    const receipt = JSON.parse((await execute('/usr/bin/python3', ['tests/ui/inspection-pty.py', file], {timeout:15000, maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.stages, steps.length);
    assert.equal(receipt.terminalRestored, true);
    const reopened = await openController({installationHome:home});
    try {
        assert.equal(reopened.inspectConversation(cid).draft.text, draft);
        assert.deepEqual(await fs.readFile(history), historyBefore);
    }
    finally { await reopened.close(); }
    passed = true;
});

for(const [key,character]of [['g','ㅎ'],['q','ㅂ'],['p','ㅔ']])for(const locale of ['en','ko'])
test(`actual terminal preserves Korean drafts and accepts Korean Ctrl+${key.toUpperCase()} in ${locale} UI`,{timeout:20000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-command-input-'))),home=path.join(root,'home');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained command input terminal '+root);});
    const controller=await openController({installationHome:home});
    const cid=controller.createConversation().conversationId;await controller.close();
    const file=path.join(root,'terminal.json'),observation=file+'.current',output=file+'.terminal';
    const draft='ㅎ한글 본문',title=locale==='ko'?'명령 ·':'Commands ·',chord=`\x1b[${character.codePointAt(0)};5u`;
    const chordRepeat=chord.replace('5u','5:2u'),chordRelease=chord.replace('5u','5:3u');
    const step=(editorFocused,text,send,extra={})=>({editorFocused,draft:text,contains:editorFocused?[]:[title],send,...extra});
    const steps=[
        step(true,'','ㅎ',{baseline:true}),
        step(true,'ㅎ','\x1b[200~한글 본문\x1b[201~',{unchanged:true}),
        step(true,draft,chordRelease,{unchanged:true}),
        step(true,draft,chordRepeat,{unchanged:true}),
        step(true,draft,'\x1b[13;3:2u',{unchanged:true}),
        step(true,draft,'\x1b[13;3:3u',{unchanged:true}),
        step(true,draft,`\x1b[${'ㅁ'.codePointAt(0)};5u`,{unchanged:true}),
        step(true,draft,`\x1b[${'ㅏ'.codePointAt(0)};5u`,{unchanged:true}),
        step(true,'',`\x1b[${'ㅛ'.codePointAt(0)};5u`,{unchanged:true}),
        step(true,draft,chord,{unchanged:true}),
        step(false,draft,chordRepeat,{unchanged:true}),
        step(false,draft,chordRelease,{unchanged:true}),
        step(false,draft,'\x1b[12627;1:2u',{unchanged:true}),
        step(false,draft,chord,{unchanged:true}),
        step(true,draft,String.fromCharCode(key.charCodeAt(0)-96),{unchanged:true}),
        step(false,draft,'ㅂ',{unchanged:true}),
    ];
    await fs.writeFile(file,JSON.stringify({cid,observation,output,steps,timeoutSeconds:12,
        command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),'--import',path.resolve('tests/cli/account-ui-no-network.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),
            'conversation','ui','--home',home,'--conversation',cid,'--command-key',`ctrl+${key}`],
        env:{...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,GITJIG_RESULT_OBSERVATION:observation,
            LANG:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
    const reopened=await openController({installationHome:home});
    try{assert.equal(reopened.inspectConversation(cid).draft.text,draft);assert.equal(reopened.inspectConversation(cid).workId,null);}
    finally{await reopened.close();}
    passed=true;
});

for(const locale of ['en','ko'])test(`invalid slash input in ${locale} keeps its draft and the previous operation error`,{timeout:20000},async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-slash-repair-'))),home=path.join(root,'home');let passed=false;
    t.after(async()=>{if(passed)await fs.rm(root,{recursive:true,force:true});else t.diagnostic('Retained slash input terminal '+root);});
    const controller=await openController({installationHome:home});
    const cid=controller.createConversation().conversationId;await controller.close();
    const file=path.join(root,'terminal.json'),observation=file+'.current',output=file+'.terminal';
    const ko=locale==='ko', key=ko?'p':'g', chord=ko?'\x10':'\x07', label=ko?'Ctrl+P':'Ctrl+G';
    const missingProject='/project missing-project', typo='/mdoel PRIVATE_ARGUMENT', invalidArgs='/help unexpected', multiline='/help\nsecond line';
    const original='Unknown registered project', search=ko?'gitjig 명령 검색':'Gitjig commands · search';
    const currentError=ko?'오류 복구 · 다음 동작 선택':'Error recovery · choose a next step';
    const previousError=ko?'이전 오류 · 다음 동작 선택':'Previous error · choose a next step';
    const previousDetail=ko?'이전 오류 상세 · 읽기 전용':'Previous error details · inspection only';
    const step=(editorFocused,draft,contains,send,extra={})=>({editorFocused,draft,contains,send,...extra});
    const errors=[
        ['/setup runtime unexpected', '/setup [inspect|runtime [current]|bridge|combined|save [JSON]|clear]'],
        ['/model PRIVATE_ARGUMENT', '/model [provider/model]'],
        ['/model-default PRIVATE_ARGUMENT', '/model-default [provider/model]'],
        ['/thinking turbo', '/thinking [off|minimal|low|medium|high|xhigh|max]'],
        ['/change replan', '/change [start [REQUEST]'],
        ['/result first second', '/result [WORK_ID]'],
        ['/login synthetic unknown-method', '/login [provider [api_key|oauth]]'],
        ['/logout synthetic extra', '/logout [provider]'],
    ];
    const submit=value=>'\x15'+value+'\x1b[27u\x1b[13u';
    const steps=[
        step(true,'',[],submit(missingProject),{baseline:true}),
        step(true,missingProject,[original],chord+'e',{unchanged:true}),
        step(false,missingProject,[currentError,original],'\x1b',{unchanged:true}),
        step(true,missingProject,[original],submit(typo),{unchanged:true}),
        step(true,typo,[ko?'/model을 확인':'Try /model',label+' /'],chord+'/',{unchanged:true,absent:['Working · Command','/error · Unknown command']}),
        step(false,typo,[search],'\x1b',{unchanged:true}),
        step(true,typo,[],chord+'e',{unchanged:true}),
        step(false,typo,[previousError,original],(ko?'오류 상세 확인':'Error details · inspect')+'\r',{unchanged:true}),
        step(false,typo,[previousDetail,original],'\x1b',{unchanged:true}),
        step(false,typo,[previousError,original],'\x1b',{unchanged:true}),
        step(true,typo,[],submit(invalidArgs),{unchanged:true}),
        step(true,invalidArgs,[ko?'/help에는 인수를':'/help does not accept arguments'],submit('\x1b[200~'+multiline+'\x1b[201~'),{unchanged:true}),
        step(true,multiline,[ko?'슬래시 명령은 한 줄':'Slash commands take one line'],'\x15\x7f'+submit(errors[0][0]),{unchanged:true}),
        ...errors.map(([draft,syntax],i)=>step(true,draft,[ko?'입력 형식':'Use',syntax,label+' /'],
            errors[i+1]?submit(errors[i+1][0]):chord+'e',{unchanged:true,absent:['/error · Use /setup','/error · Invalid thinking level']})),
        step(false,errors.at(-1)[0],[previousError,original],(ko?'오류 상세 확인':'Error details · inspect')+'\r',{unchanged:true}),
        step(false,errors.at(-1)[0],[original],'\x1b',{unchanged:true}),
        step(false,errors.at(-1)[0],[previousError,original],'\x1b',{unchanged:true}),
        step(true,errors.at(-1)[0],[],chord+'q',{unchanged:true}),
    ];
    await fs.writeFile(file,JSON.stringify({cid,observation,output,steps,columns:80,timeoutSeconds:12,
        command:[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),'--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),
            'conversation','ui','--home',home,'--conversation',cid,'--command-key',`ctrl+${key}`],
        env:{...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,GITJIG_RESULT_OBSERVATION:observation,
            LANG:ko?'ko_KR.UTF-8':'en_US.UTF-8',LC_ALL:ko?'ko_KR.UTF-8':'en_US.UTF-8',TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:''}}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:17000,maxBuffer:2**20})).stdout);
    assert.equal(receipt.exitCode,0);assert.equal(receipt.stages,steps.length);assert.equal(receipt.terminalRestored,true);
    passed=true;
});

for (const locale of ['en','ko']) test('reported function keys preserve draft and act only on an unmodified press in '+locale, {timeout:18000}, async t=>{
    const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-function-input-')));
    const home=path.join(root,'home'), file=path.join(root,'terminal.json');
    const output=file+'.terminal', observation=file+'.current';
    let passed=false;
    t.after(async()=>{
        if (passed) await fs.rm(root,{recursive:true,force:true});
        else t.diagnostic('Retained function key terminal '+root);
    });
    const controller=await openController({installationHome:home});
    const cid=controller.createConversation().conversationId;
    await controller.close();
    const draft='한글 ㅎㅊㅍ keeps its characters';
    const empty=locale==='ko'?'읽지 않은 대화 알림이 없습니다.':'No unread conversation notices.';
    const navigator=locale==='ko'?['대화 목록','ID 또는 프로젝트']:['Conversations','name, ID or project'];
    const unchanged={editorFocused:true,draft,unchanged:true,absent:[empty,...navigator]};
    const steps=[
        {editorFocused:true,draft:'',baseline:true,send:'\x1b[200~'+draft+'\x1b[201~'},
        {...unchanged,send:'\x1b[13;1:2~'},
        {...unchanged,send:'\x1b[13;1:3~'},
        {...unchanged,send:'\x1b[15;1:2~'},
        {...unchanged,send:'\x1b[15;1:3~'},
        {...unchanged,send:'\x1b[15;5:1~'},
        {...unchanged,send:'\x1b[15;65:1~'},
        {editorFocused:true,draft,unchanged:true,contains:[empty],send:'\x1b[1;1:1Q'},
        {editorFocused:false,draft,unchanged:true,contains:navigator,send:'\x1b'},
        {editorFocused:true,draft,unchanged:true,send:'\x1bOQ'},
        {editorFocused:false,draft,unchanged:true,contains:navigator,send:'\x1b'},
        {editorFocused:true,draft,unchanged:true,send:'\x07q'},
    ];
    const command=[process.execPath,...(process.env.GITJIG_UI_MODULE_GUARD?['--import',process.env.GITJIG_UI_MODULE_GUARD]:[]),
        '--import',path.resolve('tests/ui/readiness-no-execution.mjs'),'--import',path.resolve('tests/ui/inspection-pty-observer.mjs'),
        process.env.GITJIG_TEST_CLI_ENTRY??path.resolve('dist/cli/entry.js'),'conversation','ui','--home',home,'--conversation',cid];
    const language=locale==='ko'?'ko_KR.UTF-8':'en_US.UTF-8';
    const env={...process.env,HOME:root,GITJIG_HOME:home,TMPDIR:root,LANG:language,LC_ALL:language,
        TERM:'xterm-256color',NODE_OPTIONS:'',NODE_PATH:'',GITJIG_RESULT_OBSERVATION:observation};
    await fs.writeFile(file,JSON.stringify({cid,command,env,output,observation,steps,columns:80,timeoutSeconds:9}));
    const receipt=JSON.parse((await execute('/usr/bin/python3',['tests/ui/inspection-pty.py',file],{timeout:15000})).stdout);
    assert.equal(receipt.exitCode,0);
    assert.equal(receipt.stages,steps.length);
    assert.equal(receipt.terminalRestored,true);
    const reopened=await openController({installationHome:home});
    try {
        assert.equal(reopened.listConversations().length,1);
        assert.equal(reopened.inspectConversation(cid).draft.text,draft);
    } finally { await reopened.close(); }
    passed=true;
});
