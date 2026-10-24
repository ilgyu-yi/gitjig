import test from 'node:test';
import assert from 'node:assert/strict';
import {initTheme} from '@earendil-works/pi-coding-agent';
import {TuiAltScreen} from '@earendil-works/pi-tui';
import {productInput} from '../../dist/ui/product-input.js';
import {createNativeEditorFactory} from '../../dist/ui/native-editor.js';
const terminal={columns:100,rows:32,kittyProtocolActive:false,start(){},stop(){},async drainInput(){},write(){},moveBy(){},hideCursor(){},showCursor(){},clearLine(){},clearFromCursor(){},clearScreen(){},setTitle(){},setProgress(){},setProgramStatus(){}};
test('product form defaults append at end, replace with CtrlU, submit literally and cancel without a value',()=>{
    initTheme('dark',false);createNativeEditorFactory();const screen=new TuiAltScreen(terminal,true),values=[];let cancelled=0;
    const form=()=>productInput('Literal path','/한글 작업',value=>values.push(value),()=>cancelled++,screen,'Use an existing directory. Example: /home/alice/.docker.');
    const rendered=form().render(60).join('\n');assert.match(rendered,/Use an existing directory/);assert.match(rendered,/\/home\/alice\/\.docker/);
    let input=form();input.handleInput(' appended');input.handleInput('\r');assert.equal(values.at(-1),'/한글 작업 appended');
    input=form();input.handleInput('\x15');input.handleInput('/다른 폴더');input.handleInput('\r');assert.equal(values.at(-1),'/다른 폴더');
    input=form();input.handleInput('\r');assert.equal(values.at(-1),'/한글 작업');
    input=form();input.handleInput('\x1b');assert.equal(cancelled,1);assert.equal(values.length,3);
});
test('initialization cannot trigger remapped End/CtrlE controls or reinterpret control-bearing defaults',t=>{
    initTheme('dark',false);createNativeEditorFactory({'tui.editor.cursorLineEnd':'ctrl+t','tui.editor.deleteToLineEnd':'end','tui.editor.deleteToLineStart':'ctrl+e'});
    t.after(()=>createNativeEditorFactory());const screen=new TuiAltScreen(terminal,true),values=[];
    const input=productInput('Default','value',value=>values.push(value),()=>assert.fail('Initialization cancelled'),screen);
    assert.deepEqual(values,[]);input.handleInput('x');input.handleInput('\r');assert.deepEqual(values,['valuex']);
    for(const value of ['line\nbreak','tab\tvalue','\x1b[201~\r','value\u2028more','\u0085'])assert.throws(()=>productInput('Rejected',value,()=>assert.fail('Submitted'),()=>{},screen),/single-line form/);
});
