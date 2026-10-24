import test from 'node:test';
import assert from 'node:assert/strict';
import {initTheme} from '@earendil-works/pi-coding-agent';
import {TuiAltScreen,Text,stripTerminalSequences} from '@earendil-works/pi-tui';
import {NativeDialogs} from '../../dist/ui/native-dialogs.js';
import {createNativeEditorFactory} from '../../dist/ui/native-editor.js';

test('held native dialog factory is visibly pending, cancels without Enter approval and disposes a late component once',async()=>{
 initTheme('dark',false);
 const terminal={columns:80,rows:24,kittyProtocolActive:false,start(){},stop(){},async drainInput(){},write(){},moveBy(){},hideCursor(){},showCursor(){},clearLine(){},clearFromCursor(){},clearScreen(){},setTitle(){},setProgress(){},setProgramStatus(){}};
 const screen=new TuiAltScreen(terminal,true),editors=createNativeEditorFactory(),editor=editors(screen);
 let disposed=0,release;
 const dialogs=new NativeDialogs(screen,editors.bindings,()=>{}),context=dialogs.context({theme:{}},editor,()=>{},()=>()=>{});
 try{
  const pending=context.custom(async()=>await new Promise(resolve=>release=resolve));
  assert.match(stripTerminalSequences(dialogs.component.render(80).join('\n')),/Opening dialog/);
  assert.equal(dialogs.requestIds.length,1);
  dialogs.component.handleInput('\r');assert.equal(dialogs.requestIds.length,1,'Enter must not approve an opening dialog');
  editor.setText('Preserved unsent draft');dialogs.component.handleInput('unrelated text');assert.equal(editor.getText(),'Preserved unsent draft');
  await Promise.resolve();assert.equal(typeof release,'function');
  dialogs.component.handleInput('\x1b');assert.equal(await pending,undefined);assert.equal(dialogs.requestIds.length,0);
  const late=new Text('Late native component');late.dispose=()=>disposed++;release(late);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(disposed,1);assert.equal(dialogs.component,undefined);
  const next=context.select('Next actual request',['One','Two']);await new Promise(resolve=>setImmediate(resolve));
  assert.doesNotMatch(stripTerminalSequences(dialogs.component.render(80).join('\n')),/Opening dialog/);
  dialogs.component.handleInput('\r');assert.equal(await next,'One');assert.equal(dialogs.requestIds.length,0);
 }finally{dialogs.dispose();}
});
