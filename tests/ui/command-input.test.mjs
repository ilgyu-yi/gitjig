import test from 'node:test';
import assert from 'node:assert/strict';
import {initTheme} from '@earendil-works/pi-coding-agent';
import {CommandMenu} from '../../dist/ui/command-menu.js';
import {commandNameKeys,matchesCommandLetter,matchesHostKey,normalizeHostKeyEvent} from '../../dist/ui/command-input.js';
import {matchesKey,isKeyRelease,isKeyRepeat} from '@earendil-works/pi-tui';
import {HostCommands} from '../../dist/ui/host-commands.js';
initTheme('dark',false);
test('command menu accepts public physical-key sequences and Dubeolsik jamo, without treating composed text as one shortcut',()=>{
    for(const [input,want]of [['j','j'],['ㅓ','j'],['ᅥ','j'],['ㅔ','p'],['ㅊ','c'],['\x1b[12628::106;1u','j']]) {
        let selected;new CommandMenu(k=>selected=k,()=>{}).handleInput(input);assert.equal(selected,want,input);
    }
    assert.equal(matchesCommandLetter('ㄲ','r'),false);assert.equal(matchesCommandLetter('R','r'),false);assert.equal(matchesCommandLetter('한글','j'),false);assert.equal(matchesCommandLetter('\x1bj','j'),false);
});
test('Korean command names execute and complete; arguments, unknown tokens and literal messages keep their meaning',async()=>{
    let argument;const registry=new HostCommands([{name:'project',argumentHint:'[id]',run:async value=>{argument=value;}}]);
    const token='ㅔ개ㅓㄷㅊㅅ';assert.equal(commandNameKeys(token),'project');
    await registry.execute('/'+token+' 한글/경로', 'target');assert.equal(argument,'한글/경로');
    assert.equal(await registry.execute('한글 본문', 'target'),'not-command');assert.equal(await registry.execute('//'+token,'target'),'not-command');
    await assert.rejects(registry.execute('/한국어', 'target'),/Unknown command/);
    const text='/ㅔ개', found=await registry.autocomplete.getSuggestions([text],0,text.length,{signal:new AbortController().signal});
    assert.equal(found.items[0].value,'project');assert.equal(found.prefix,text);
    const completed=registry.autocomplete.applyCompletion([text],0,text.length,found.items[0],found.prefix);
    assert.equal(completed.lines[0],'/project ');
});

const csi=(character,modifier=1,event='',base='')=>`\x1b[${character.codePointAt(0)}${base?`::${base.codePointAt(0)}`:''};${modifier}${event?`:${event}`:''}u`;
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
