import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleWidth, stripTerminalSequences} from '@earendil-works/pi-tui';
import {uiText,uiCatalogues,hostUiLanguage,resolveUiLanguage} from '../../dist/ui/i18n.js';
import {initTheme} from '@earendil-works/pi-coding-agent';
import {HostPicker} from '../../dist/ui/host-picker.js';
import {ConversationActivity} from '../../dist/ui/conversation-activity.js';
import {createNativeEditorFactory} from '../../dist/ui/native-editor.js';

test('UI catalogues have complete keys and matching parameters; opaque values are substituted only once',()=>{
 assert.deepEqual(Object.keys(uiCatalogues.ko).sort(),Object.keys(uiCatalogues.en).sort());
 const fields=text=>[...new Set([...text.matchAll(/\{(\w+)\}/gu)].map(m=>m[1]))].sort();
 for(const [id,text] of Object.entries(uiCatalogues.en))assert.deepEqual(fields(uiCatalogues.ko[id]),fields(text),id);
 const opaque='{seconds} 한국어 /change start';
 assert.equal(uiText('ko','activity.elapsed',{label:opaque,seconds:3}),opaque+' · 3초');
 assert.throws(()=>uiText('ko','activity.elapsed',{label:'request'}),/Missing UI message argument/);
});
test('explicit reply languages, regional tags, unsupported languages and auto host fallback stay distinct',()=>{
 assert.deepEqual(resolveUiLanguage('ko-KR','en-US'),{locale:'ko',source:'conversation',requested:'ko-KR'});
 assert.equal(resolveUiLanguage('en-GB','ko-KR').locale,'en');
 assert.deepEqual(resolveUiLanguage('ja','ko-KR'),{locale:'en',source:'fallback',requested:'ja'});
 assert.equal(resolveUiLanguage(null,'ko-KR').source,'system');
 assert.equal(resolveUiLanguage(null,'C').locale,'en');
 assert.equal(resolveUiLanguage(null,'POSIX').source,'system');
 assert.equal(hostUiLanguage({LC_ALL:'C.UTF-8',LC_MESSAGES:'ko_KR.UTF-8',LANG:'ko_KR.UTF-8'}),'C');
 assert.equal(hostUiLanguage({LC_ALL:'',LC_MESSAGES:'ko_KR.UTF-8@modifier',LANG:'en_US.UTF-8'}),'ko-KR');
});
test('Korean picker filters displayed text and selects stable values even with duplicate or truncated labels',()=>{
 initTheme('dark',false);createNativeEditorFactory();let selected;
 const picker=new HostPicker('선택',[{value:'prompt',label:'같은 표시'},{value:'managed',label:'같은 표시'}],v=>selected=v,()=>{},()=>8,'ko');
 assert.ok(picker.render(24).join('\n').includes('검색:'));
 picker.handleInput('\x1b[B');picker.handleInput('\r');assert.equal(selected,'managed');picker.dispose();
 const filtered=new HostPicker('프로젝트',[{value:'register',label:'프로젝트 등록'},{value:'keep',label:'돌아가기'}],v=>selected=v,()=>{},()=>8,'ko');
 filtered.handleInput('등록');assert.ok(filtered.render(24).join('\n').includes('1/2개 항목'));
 filtered.handleInput('\r');assert.equal(selected,'register');
 for(const line of filtered.render(12))assert.ok(visibleWidth(line)<=12);
 assert.throws(()=>new HostPicker('bad',[{value:'same',label:'A'},{value:'same',label:'B'}],()=>{},()=>{},()=>8),/Duplicate picker value/);
});
test('split activity locales never leak and a changed preference updates phase text without altering tool data',()=>{
 const ko=new ConversationActivity(()=>{}),en=new ConversationActivity(()=>{});
 try{
  ko.update('RUNNING',{locale:'ko'});en.update('RUNNING',{locale:'en'});
  ko.observe({type:'tool_execution_start',toolName:'literal_tool_name'});
  const text=c=>c.render(100).map(stripTerminalSequences).join('\n');
  assert.match(text(ko),/도구 실행 중: literal_tool_name/);assert.match(text(en),/Waiting for model response/);
  ko.update('RUNNING',{locale:'en'});assert.match(text(ko),/Running tool: literal_tool_name/);
  assert.match(text(en),/Waiting for model response/);
 }finally{ko.dispose();en.dispose();}
});

import {chooseUiItem} from '../../dist/ui/choices.js';
test('typed choice transport retains stable values with duplicate labels and exact cancellation', async () => {
    const items = [{value: 'prompt', label: '같은 표시'}, {value: 'managed', label: '같은 표시'}];
    const host = {choose: async () => assert.fail('Typed choices used label transport')};
    assert.equal(await chooseUiItem({...host, chooseItems: async () => 'managed'}, '선택', items), 'managed');
    assert.equal(await chooseUiItem({...host, chooseItems: async () => undefined}, '선택', items), undefined);
    await assert.rejects(chooseUiItem({...host, chooseItems: async () => 'stale'}, '선택', items), /Unknown UI choice value/);
});
test('legacy choice transport refuses unknown and ambiguous labels but preserves unique selections', async () => {
    const items = [{value: 'A', label: '같은 표시'}, {value: 'B', label: '같은 표시'}, {value: 'C', label: 'literal /path {value}'}];
    assert.equal(await chooseUiItem({choose: async () => undefined}, '선택', items), undefined);
    assert.equal(await chooseUiItem({choose: async () => items[2].label}, '선택', items), 'C');
    await assert.rejects(chooseUiItem({choose: async () => '같은 표시'}, '선택', items), /Ambiguous UI choice label/);
    await assert.rejects(chooseUiItem({choose: async () => 'UNKNOWN'}, '선택', items), /Unknown UI choice label/);
    await assert.rejects(chooseUiItem({choose: async () => ' '+items[2].label}, '선택', items), /Unknown UI choice label/);
});
test('choice values are unique before callbacks and callback failure is not converted into cancellation', async () => {
    const host = {choose: async () => assert.fail('Duplicate values entered the picker')};
    await assert.rejects(chooseUiItem(host, 'bad', [{value: 'same', label: 'A'}, {value: 'same', label: 'B'}]), /Duplicate UI choice value/);
    const error = Error('Original source failure');
    await assert.rejects(chooseUiItem({choose: async () => {throw error;}}, 'valid', [{value: 'A', label: 'A'}]), value => value === error);
});

test('a typed callback cannot replace the original action-value snapshot', async () => {
    const host = {
        choose: async () => assert.fail('Typed callback fell back to labels'),
        chooseItems: async (_title, items) => {items[0].value = 'INVENTED'; return 'INVENTED';},
    };
    await assert.rejects(chooseUiItem(host, 'original', [{value: 'A', label: 'A'}]), /Unknown UI choice value/);
});
