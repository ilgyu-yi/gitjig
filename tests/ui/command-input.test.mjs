import test from 'node:test';
import assert from 'node:assert/strict';
import {initTheme} from '@earendil-works/pi-coding-agent';
import {CommandMenu} from '../../dist/ui/command-menu.js';
import {acceptsDialogKeyEvent,commandNameKeys,hostFunctionKey,matchesCommandLetter,matchesHostKey,normalizeHostKeyEvent} from '../../dist/ui/command-input.js';
import {getKeybindings,setKeybindings,KeybindingsManager,TUI_KEYBINDINGS,matchesKey,isKeyRelease,isKeyRepeat} from '@earendil-works/pi-tui';
import {HostCommands} from '../../dist/ui/host-commands.js';
import {uiText} from '../../dist/ui/i18n.js';
import {recommendedDelegatedRecovery} from '../../dist/ui/recorded-delegated-result.js';
initTheme('dark',false);
test('command menu accepts public physical-key sequences and Dubeolsik jamo, without treating composed text as one shortcut',()=>{
    for(const [input,want]of [['j','j'],['ㅓ','j'],['ᅥ','j'],['ㅔ','p'],['ㅊ','c'],['\x1b[12628::106;1u','j']]) {
        let selected;new CommandMenu(k=>selected=k,()=>{}).handleInput(input);assert.equal(selected,want,input);
    }
    assert.equal(matchesCommandLetter('ㄲ','r'),false);assert.equal(matchesCommandLetter('R','r'),false);assert.equal(matchesCommandLetter('한글','j'),false);assert.equal(matchesCommandLetter('\x1bj','j'),false);
});
test('the parent recommendation requires a complete view and one corresponding stop',()=>{
    const first={assignmentId:'child',conversationId:'child-view',workId:'child-work',resultId:'child-result',limit:3};
    const view={entries:[],requestFailures:[first],unavailable:false,omitted:false};
    const direct={assignmentId:first.assignmentId,conversationId:first.conversationId,workId:first.workId,resultId:first.resultId,state:'UNAVAILABLE'};
    assert.equal(recommendedDelegatedRecovery(view,[direct]),first);
    assert.equal(recommendedDelegatedRecovery(view,[{...direct,workId:'different-work'}]),undefined);
    assert.equal(recommendedDelegatedRecovery(view,[{...direct,resultId:undefined}]),undefined);
    assert.equal(recommendedDelegatedRecovery(view,[direct,{...direct,assignmentId:'sibling',cleanupUnconfirmed:true}]),undefined);
    assert.equal(recommendedDelegatedRecovery({...view,omitted:true},[direct]),undefined);
    assert.equal(recommendedDelegatedRecovery({...view,unavailable:true},[direct]),undefined);
    assert.equal(recommendedDelegatedRecovery({...view,waitReviewUnavailable:true},[direct]),undefined);
    const nested=[first,{...first,resultId:'other-result',assignmentId:'other-child'}].map(entry=>({...entry,waitAssignmentId:'first-hop',currentWait:true}));
    const firstHop=[{...direct,assignmentId:'first-hop',state:'WAITING'}];
    assert.equal(recommendedDelegatedRecovery({...view,requestFailures:nested},firstHop),undefined);
    assert.equal(recommendedDelegatedRecovery({...view,requestFailures:[nested[0]]},firstHop),nested[0]);
    assert.equal(recommendedDelegatedRecovery({...view,requestFailures:[nested[0]],
        descendantWaitStops:[{...direct,assignmentId:'another-descendant',resultId:undefined}]},firstHop),undefined);
    assert.equal(recommendedDelegatedRecovery({...view,requestFailures:[{...nested[0],currentWait:undefined}]},firstHop),undefined);
});
test('Korean command names execute and complete; arguments, unknown tokens and literal messages keep their meaning',async()=>{
    let argument;const registry=new HostCommands([{name:'project',descriptionId:'command.description.project',argumentHint:'[id]',run:async value=>{argument=value;}}]);
    const token='ㅔ개ㅓㄷㅊㅅ';assert.equal(commandNameKeys(token),'project');
    assert.equal(registry.commandName('/'+token+' 한글/경로'),'project');assert.equal(argument,undefined);
    await registry.execute('/'+token+' 한글/경로', 'target');assert.equal(argument,'한글/경로');
    assert.equal(await registry.execute('한글 본문', 'target'),'not-command');assert.equal(await registry.execute('//'+token,'target'),'not-command');
    await assert.rejects(registry.execute('/한국어', 'target'),/Unknown command/);
    const text='/ㅔ개', found=await registry.autocomplete.getSuggestions([text],0,text.length,{signal:new AbortController().signal});
    assert.equal(found.items[0].value,'project');assert.equal(found.prefix,text);
    const completed=registry.autocomplete.applyCompletion([text],0,text.length,found.items[0],found.prefix);
    assert.equal(completed.lines[0],'/project ');
});

const csi=(character,modifier=1,event='',base='')=>`\x1b[${character.codePointAt(0)}${base?`::${base.codePointAt(0)}`:''};${modifier}${event?`:${event}`:''}u`;

test('direct function keys preserve unmodified press, repeat and release across legacy and Kitty reports',()=>{
    const reports=[['12','~','f2'],['1','Q','f2'],['13','~','f3'],['14','~','f4'],['1','S','f4'],
        ['15','~','f5'],['17','~','f6'],['18','~','f7'],['19','~','f8']];
    for(const [code,suffix,key] of reports){
        for(const modifier of [1,65,129,193])for(const event of ['',':1',':2',':3'])
            assert.deepEqual(hostFunctionKey(`\x1b[${code};${modifier}${event}${suffix}`),{key,press:event===''||event===':1'});
        for(const modifier of [2,3,5,6,9,66,133,999])
            assert.equal(hostFunctionKey(`\x1b[${code};${modifier}:1${suffix}`),undefined);
    }
    for(const [data,key] of [['\x1bOQ','f2'],['\x1bOR','f3'],['\x1bOS','f4'],['\x1b[15~','f5'],['\x1b[17~','f6'],['\x1b[18~','f7'],['\x1b[19~','f8']])
        assert.deepEqual(hostFunctionKey(data),{key,press:true});
    for(const data of ['\x1b[1;1R','\x1b[1;1:1R','\x1b[15;1:4~','\x1b[15;1:1~\n','\x1b[15;1:1~\x1b[13~',
        '\x1b[200~\x1b[15;1:1~\x1b[201~','한글',csi('ㅎ',5)])
        assert.equal(hostFunctionKey(data),undefined,JSON.stringify(data));
});
test('reported dialog repeats follow the current action bindings and keep editing input', () => {
    const before = getKeybindings();
    try {
        setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS, {
            'tui.select.confirm': 'ctrl+r', 'tui.select.cancel': 'ctrl+b', 'tui.input.submit': 'alt+s',
        }));
        for (const [character, modifier] of [['ㄱ',5],['ㅠ',5],['ㄴ',3]]) {
            assert.equal(acceptsDialogKeyEvent(normalizeHostKeyEvent(csi(character,modifier,1))),true);
            assert.equal(acceptsDialogKeyEvent(normalizeHostKeyEvent(csi(character,modifier,2))),false);
            assert.equal(acceptsDialogKeyEvent(normalizeHostKeyEvent(csi(character,modifier,3))),false);
        }
        for (const data of [csi('\r',1,2), csi('\x7f',1,2), '\x1b[1;1:2B', csi('ㅎ',1,2), '\n', '한글'])
            assert.equal(acceptsDialogKeyEvent(data),true,JSON.stringify(data));
    } finally {
        setKeybindings(before);
    }
});
test('reported menu repeats can move the selection but cannot invoke commands',()=>{
    for(const locale of ['en','ko']) {
        const selected=[];
        let closed=0;
        const menu=new CommandMenu(key=>selected.push(key),()=>closed++,'ctrl+g',locale);
        for(const key of [csi('ㅎ',5,2),csi('ㅎ',5,3),csi('ㅓ',1,2),csi('/',1,2),csi('?',1,2),csi('\r',1,2),csi('\x1b',1,2)])
            menu.handleInput(key);
        assert.deepEqual(selected,[]);
        assert.equal(closed,0);
        menu.handleInput('\x1b[1;1:3B');
        menu.handleInput('\x1b[1;1:2B');
        menu.handleInput('\r');
        assert.deepEqual(selected,['j']);
        menu.handleInput(csi('/'));
        assert.deepEqual(selected,['j','/']);
        menu.handleInput('\x1b[47:63;2u');
        const help=uiText(locale,'command.help',{key:'Ctrl+G'});
        assert.ok(menu.render(120).join(' ').includes(help.slice(0,20)));
        menu.handleInput(csi('ㅎ',5));
        assert.equal(closed,1);
    }
});
test('English and Korean menu choices work in either interface locale, including encoded jamo without a base key',()=>{
    for(const locale of ['en','ko'])for(const [character,key]of [['ㅊ','c'],['ㅓ','j'],['ㅔ','p'],['ㅇ','d'],['ㄴ','s'],['ㅈ','w'],['ㅜ','n'],['ㄱ','r'],['ㅗ','h'],['ㅡ','m'],['ㅣ','l'],['ㄷ','e'],['ㅅ','t'],['ㅂ','q']]) {
        for(const input of [character,csi(character),`\x1b[27;1;${character.codePointAt(0)}~`,key]) {
            let selected;new CommandMenu(k=>selected=k,()=>{},'ctrl+g',locale).handleInput(input);
            assert.equal(selected,key,`${locale} ${JSON.stringify(input)}`);
        }
    }
});
test('host control chords and custom menu profiles accept Korean encoded keys while preserving Pi event semantics',()=>{
    assert.equal(matchesHostKey(csi('ᄒ',5),'ctrl+g'),true);
    assert.equal(matchesHostKey(csi('ᅦ',5),'ctrl+p'),true);
    for(const [character,key]of [['ㅎ','g'],['ㅂ','q'],['ㅔ','p'],['ㅇ','d']]) {
        for(const modifier of [1,2,3,5,6,7,9,65,69,133])for(const event of ['',1,2,3]) {
            const input=csi(character,modifier,event),english=csi(key,modifier,event);
            for(const binding of [`ctrl+${key}`,`alt+${key}`,`super+${key}`,`ctrl+shift+${key}`,`ctrl+alt+${key}`])
                assert.equal(matchesHostKey(input,binding),matchesKey(english,binding),`${JSON.stringify(input)} ${binding}`);
            assert.equal(isKeyRelease(input),isKeyRelease(english));assert.equal(isKeyRepeat(input),isKeyRepeat(english));
        }
        assert.equal(matchesHostKey(`\x1b[27;5;${character.codePointAt(0)}~`,`ctrl+${key}`),true);
        if(key!=='d')for(const locale of ['en','ko']) {
            let cancelled=0,selected;new CommandMenu(k=>selected=k,()=>cancelled++,`ctrl+${key}`,locale).handleInput(csi(character,5));
            assert.equal(cancelled,1);assert.equal(selected,undefined);
        }
    }
});
test('Korean composer text, paste, extra modifiers and reported physical layout cannot become an unrelated host chord',()=>{
    for(const input of ['ㅎ','ㅂ','ㅔ','ᄒ','ᅦ','한글 입력','\x1b[200~ㅎㅂㅔ\x1b[201~',csi('ㅎ'),csi('ㅎ',2),csi('ㅎ',7),csi('ㅎ',5,'','q'),'\x1b[999999999999999999999;5u']) {
        assert.equal(matchesHostKey(input,'ctrl+g'),false,JSON.stringify(input));
        assert.equal(matchesHostKey(input,'g'),false,JSON.stringify(input));
    }
    assert.equal(matchesHostKey(csi('ㅎ',5,'','q'),'ctrl+q'),true);
    assert.equal(matchesCommandLetter(csi('ㅎ',1,'','q'),'g'),false);
    assert.equal(matchesCommandLetter(csi('ㅎ',1,'','q'),'q'),true);
    for(const character of ['ㄲ','ㅃ','ㅉ','ㅒ','ㅖ','한','ㄳ'])assert.equal(matchesCommandLetter(csi(character),'r'),false);
    for(const input of [csi('ㅎ',3),csi('ㅎ',5),csi('ㅎ',6)])assert.equal(matchesCommandLetter(input,'g'),false);
});
test('native consumers receive only explicit modified-key normalization; raw text and unmodified events remain exact',()=>{
    for(const [character,key]of [['ㅁ','a'],['ㅊ','c'],['ㅍ','v'],['ㅏ','k'],['ㅛ','y']]) {
        for(const modifier of [3,5,6,7,9,69])for(const event of ['',1,2,3])
            assert.equal(normalizeHostKeyEvent(csi(character,modifier,event)),csi(key,modifier,event));
        for(const modifier of [1,2,65])assert.equal(normalizeHostKeyEvent(csi(character,modifier)),csi(character,modifier));
        assert.equal(normalizeHostKeyEvent(`\x1b[27;5;${character.codePointAt(0)}~`),`\x1b[27;5;${key.codePointAt(0)}~`);
    }
    for(const text of ['ㅎ','한글 본문','\x1b[200~한글 본문\x1b[201~',csi('ㅎ',5,'','q'),'\x1b[12622;5uINVALID','\x1b[999999999999999999999;5u'])
        assert.equal(normalizeHostKeyEvent(text),text);
});
