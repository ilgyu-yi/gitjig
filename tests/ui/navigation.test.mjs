import test from 'node:test';
import assert from 'node:assert/strict';
import {initTheme} from '@earendil-works/pi-coding-agent';
import {TuiAltScreen, HStack, VStack, Text, matchesKey, visibleWidth} from '@earendil-works/pi-tui';
import {ConversationNavigator, conversationPath, compactConversationPath, conversationRelations} from '../../dist/ui/conversation-navigator.js';
import {CommandMenu} from '../../dist/ui/command-menu.js';
import {NativePane} from '../../dist/ui/native-pane.js';
import {createNativeEditorFactory} from '../../dist/ui/native-editor.js';
initTheme('dark',false); createNativeEditorFactory();
const view=(id,parentId=null,label=id)=>({conversationId:id,parentId,label,projectId:'project',state:'IDLE',inputNeeded:false});

test('conversation selector opens at current in its real hierarchy; search retains ancestors and uses exact IDs',()=>{
 const roster=[view('old'),view('root',null,'Same name'),view('child','root','Same name'),view('grandchild','child')];
 let selected=null,cancelled=0;
 const selector=new ConversationNavigator(roster,'child',10,id=>selected=id,()=>cancelled++);
 const before=selector.render(120).join('\n');
 assert.ok(before.indexOf('#root')<before.indexOf('CURRENT Same name #child'));
 selector.handleInput('\r');assert.equal(selected,'child','Initial Enter must not choose oldest unrelated conversation');
 selector.handleInput('grandchild');const filtered=selector.render(120).join('\n');
 assert.match(filtered,/#root/);assert.match(filtered,/#child/);assert.match(filtered,/#grandchi/);assert.doesNotMatch(filtered,/#old/);
 selector.handleInput('\r');assert.equal(selected,'grandchild','Search focuses a match, not its context-only ancestor');
 selector.handleInput('\x15');selector.handleInput('no-such-conversation');selected=null;selector.handleInput('\r');assert.equal(selected,null);
 assert.match(selector.render(120).join('\n'),/No matching conversations/);
 selector.handleInput('\x15');selector.handleInput('old');selector.handleInput('\r');assert.equal(selected,'old','Cleared search keeps unrelated conversations reachable');
 selector.handleInput('\x1b');assert.equal(cancelled,1);
});

test('tree collapse hides descendants without losing them; paths expose missing parents and cycles',()=>{
 let selected=null;
 const roster=[view('root'),view('child','root'),view('grandchild','child'),view('unrelated')];
 const selector=new ConversationNavigator(roster,'root',10,id=>selected=id,()=>{});
 selector.handleInput('\x1b[D');assert.doesNotMatch(selector.render(120).join('\n'),/#child/);
 selector.handleInput('\x1b[C');selector.handleInput('\x1b[C');selector.handleInput('\r');assert.equal(selected,'child');
 assert.equal(conversationPath(roster,'grandchild'),'root #root > child #child > grandchild #grandchi');
 assert.match(conversationPath([view('orphan','missing')],'orphan'),/unavailable #missing/);
 const cycle=[view('a','b'),view('b','a')];assert.match(conversationPath(cycle,'a'),/relationship cycle/);
 const broken=new ConversationNavigator(cycle,'a',5,()=>{},()=>{});assert.match(broken.render(80).join('\n'),/#a/);assert.match(broken.render(80).join('\n'),/#b/);
});

test('live summaries replace old input flags without changing search or selected conversation',()=>{
 let selected;
 const selector=new ConversationNavigator([view('root'),{...view('child','root'),inputNeeded:true}], 'root', 8, id=>selected=id, ()=>{});
 selector.handleInput('child');
 selector.updateSummaries(new Map([['root','Conversation idle'],['child','Response running · input needed']]));
 assert.match(selector.render(160).join('\n'),/input needed/);
 selector.updateSummaries(new Map([['root','Conversation idle'],['child','Response running']]));
 assert.doesNotMatch(selector.render(160).join('\n'),/INPUT NEEDED|input needed/);
 selector.handleInput('\r');assert.equal(selected,'child');
});

test('deep conversation hierarchies remain searchable and collapsible without recursive traversal',()=>{
 const depth=6000;
 const roster=[...Array.from({length:depth},(_,index)=>view('deep-'+index,index?'deep-'+(index-1):null,'Depth '+index)),view('sibling','deep-0','Later sibling')];
 let selected;
 const selector=new ConversationNavigator(roster,'deep-0',8,id=>selected=id,()=>{});
 selector.handleInput('\x1b[B');selector.handleInput('\r');assert.equal(selected,'deep-1','Children retain their original sibling order');
 selector.handleInput('\x1b[A');selector.handleInput('\x1b[D');
 const collapsed=selector.render(120).join('\n');
 assert.match(collapsed,/\[\+\] CURRENT Depth 0/);assert.doesNotMatch(collapsed,/#deep-1|Later sibling/);
 selector.handleInput('deep-5999');selector.handleInput('\r');assert.equal(selected,'deep-5999','Search reaches the deepest descendant even under a collapsed ancestor');
 selector.handleInput('\x15');selector.handleInput('\x1b[C');selector.handleInput('\x1b[C');selector.handleInput('\r');
 assert.equal(selected,'deep-1','Clearing search and expanding restores the original child order');
});

test('command menu requires an explicit exact command, preserves unknown/paste safety and cancels',()=>{
 let chosen=null,cancelled=0;const menu=new CommandMenu(key=>chosen=key,()=>cancelled++);
 for(const chunk of ['some pasted text','\x1b[200~s\x1b[201~','한국어']){menu.handleInput(chunk);assert.equal(chosen,null);assert.match(menu.render(120).join('\n'),/Unknown command/);}
 menu.handleInput('?');assert.equal(chosen,null);menu.handleInput('\x07');assert.equal(cancelled,1);
 menu.handleInput('w');assert.equal(chosen,'w');
 const paged=new CommandMenu(key=>chosen=key,()=>{});for(let i=0;i<10;i++)paged.handleInput('\x1b[B');paged.handleInput('\r');assert.equal(chosen,'l','Every command remains reachable in the bounded list');
 assert.equal(matchesKey('\x11','ctrl+q'),true);
 for(const [key,raw] of [['ctrl+g','\x07'],['ctrl+q','\x11'],['ctrl+p','\x10']]){
  let cancelled=0;const configured=new CommandMenu(()=>{},()=>cancelled++,key);
  assert.match(configured.render(120).join('\n'),new RegExp('Ctrl\\+'+key.at(-1).toUpperCase()));
  configured.handleInput(raw);assert.equal(cancelled,1);
 }
});

test('native split keeps pane identities while keyboard scrolling/search and pointer wheel target the proper pane',{timeout:5000},async()=>{
 let input;
 const terminal={columns:120,rows:32,kittyProtocolActive:false,start(fn){input=fn;},stop(){},async drainInput(){},write(){},moveBy(){},hideCursor(){},showCursor(){},clearLine(){},clearFromCursor(){},clearScreen(){},setTitle(){},setProgress(){},setProgramStatus(){}};
 const screen=new TuiAltScreen(terminal,true),factory=createNativeEditorFactory();
 let hostMenuRequests=0;
 const removeHostInput=screen.addInputListener(data=>{if(matchesKey(data,'ctrl+g')){hostMenuRequests++;return {consume:true};}});
 const left=new NativePane('left',screen,factory),right=new NativePane('right',screen,factory);
 left.body.addChild(new Text(Array.from({length:120},(_,i)=>'LEFT '+String(i).padStart(3,'0')).join('\n'),0,0));
 right.body.addChild(new Text(Array.from({length:120},(_,i)=>'RIGHT '+String(i).padStart(3,'0')).join('\n'),0,0));
 left.editor.setText('left protected');right.editor.setText('right protected');
 const root=()=>new VStack([{component:new HStack([{component:left.layout,basis:0,grow:1},{component:right.layout,basis:0,grow:1}]),basis:0,grow:1},{component:new Text('FOOTER',0,0),basis:'auto',shrink:0}]);
 const frame=async predicate=>{const end=Date.now()+1000;screen.requestRender();while(!predicate()&&Date.now()<end)await new Promise(r=>setImmediate(r));assert.ok(predicate());};
 try{
  left.setActive(true);right.setActive(false);screen.setLayoutRoot(root());screen.setFocus(left.editor);screen.start();
  await frame(()=>screen.getScreenLines().length===32);screen.scrollToTop();await frame(()=>left.scroll.scrollTop===0);
  const rightEnd=right.scroll.scrollTop;input('\x1b[6~');await frame(()=>left.scroll.scrollTop>0);assert.equal(right.scroll.scrollTop,rightEnd);
  const leftPosition=left.scroll.scrollTop;
  left.setActive(false);right.setActive(true);screen.setLayoutRoot(root());screen.setFocus(right.editor);
  await frame(()=>screen.viewportTop===right.scroll.scrollTop);screen.scrollToTop();await frame(()=>right.scroll.scrollTop===0);assert.equal(left.scroll.scrollTop,leftPosition);
  input('\x1b[6~');await frame(()=>right.scroll.scrollTop>0);assert.equal(left.scroll.scrollTop,leftPosition);
  assert.equal(matchesKey('\x1b[70;6u','ctrl+shift+f'),true);input('\x1b[70;6u');input('RIGHT 090');
  await frame(()=>right.scroll.scrollTop>60);assert.equal(left.scroll.scrollTop,leftPosition);input('\x1b');
  input('\x1b[70;6u');input('RIGHT');input('\x07');assert.equal(hostMenuRequests,0,'Native active search owns Ctrl+G before host commands');input('\x1b');input('\x07');assert.equal(hostMenuRequests,1);
  const rightAfterSearch=right.scroll.scrollTop;input('\x1b[<64;5;8M');await frame(()=>left.scroll.scrollTop<leftPosition);assert.equal(right.scroll.scrollTop,rightAfterSearch);
  screen.scrollToBottom();await frame(()=>right.scroll.isFollowingEnd);assert.equal(left.editor.getText(),'left protected');assert.equal(right.editor.getText(),'right protected');
  const lines=screen.getScreenLines();assert.ok(lines.some(line=>line.indexOf('left protected')>=0&&line.indexOf('right protected')>line.indexOf('left protected')),'Pane slots do not swap on focus');
  const deep=Array.from({length:20},(_,i)=>view('node'+i,i?'node'+(i-1):null,'Long ancestor label '+('wide words '.repeat(8))));
  const full=conversationPath(deep,'node19');assert.ok(new Text(full,0,0).render(40).length>24);
  terminal.columns=40;terminal.rows=24;
  right.status.setText('HEADER_VISIBLE\n'+full);
  screen.setLayoutRoot(new VStack([{component:right.layout,basis:0,grow:1,minSize:1},{component:new Text('FOOTER_VISIBLE',0,0),basis:'auto',shrink:0}]));
  await frame(()=>screen.getScreenLines().length===24&&screen.getScreenLines().join('\n').includes('HEADER_VISIBLE'));
  assert.ok(!screen.getScreenLines().join('\n').includes('right protected'),'Unbounded path actually reproduces editor starvation');
  const bounded=compactConversationPath(deep,'node19',40);assert.match(bounded,/^… /);assert.match(bounded,/#node19$/);
  right.status.setText('HEADER_VISIBLE\n'+bounded);
  await frame(()=>screen.getScreenLines().join('\n').includes('right protected'));
  for(const marker of ['HEADER_VISIBLE','#node19','right protected','FOOTER_VISIBLE'])assert.ok(screen.getScreenLines().join('\n').includes(marker),marker);
  const relatives=[...deep,...Array.from({length:12},(_,i)=>({...view('kid'+i,'node19','긴 자식 작업 '.repeat(20)),inputNeeded:true}))];
  const relations=conversationRelations(relatives,'node19',40);
  right.status.setText('HEADER_VISIBLE\n'+bounded+'\n'+relations.join('\n'));
  const toolbar=new Text('Ctrl+G commands · Shift+↑ parent · Shift+↓ child · Ctrl+D leave',0,0);
  screen.setLayoutRoot(new VStack([{component:right.layout,basis:0,grow:1,minSize:1},{component:new Text('No accessible parent.',0,0),basis:'auto',shrink:0},{component:toolbar,basis:'auto',shrink:0}]));
  await frame(()=>screen.getScreenLines().join('\n').includes('Children (12)'));
  const narrow=screen.getScreenLines().join('\n');
  for(const marker of ['HEADER_VISIBLE','#node19','right protected','Ctrl+G commands','No accessible parent.','RIGHT ','+11 more','[IDLE!]'])assert.ok(narrow.includes(marker),marker);
  screen.setLayoutRoot(new VStack([{component:right.layout,basis:0,grow:1,minSize:1},{component:new CommandMenu(()=>{},()=>{}),basis:'auto',shrink:0},{component:toolbar,basis:'auto',shrink:0},{component:new Text('Model: fixture',0,0),basis:'auto',shrink:0}]));
  await frame(()=>screen.getScreenLines().join('\n').includes('Commands'));
  const expanded=screen.getScreenLines().join('\n');for(const marker of ['HEADER_VISIBLE','right protected','RIGHT ','Model: fixture','Ctrl+G commands'])assert.ok(expanded.includes(marker),marker);
  assert.equal(screen.getScreenLines().length,24);
 }finally{removeHostInput();screen.stop();left.dispose();right.dispose();}
});


test('relationship rows preserve actual state, input flags and honest omitted counts within display width',()=>{
 const parent={...view('parent',null,'부모 작업 '.repeat(30)),state:'RUNNING',inputNeeded:true};
 const roster=[parent,view('current','parent'),...Array.from({length:12},(_,i)=>({...view('kid'+i,'current','자식 작업 '.repeat(30)),inputNeeded:true})),{...view('archived','current'),archived:true},{...view('deleted','current'),deleted:true},view('unrelated')];
 for(const width of [40,80,160]){
  const rows=conversationRelations(roster,'current',width);
  assert.equal(rows.length,2);assert.ok(rows.every(row=>visibleWidth(row)<=width));
  assert.match(rows[0],/\[RUNNING!\]/);assert.match(rows[1],/Children \(12\)/);
  const represented=(rows[1].match(/\[IDLE!\]/g)??[]).length;
  assert.ok(represented>0&&represented<=3);assert.match(rows[1],new RegExp('\\+'+(12-represented)+' more$'));
 }
 assert.match(conversationRelations(roster,'parent',40)[0],/Root/);
 assert.match(conversationRelations([view('orphan','missing')],'orphan',40)[0],/unavailable/);
 assert.match(conversationRelations([{...parent,archived:true},view('current','parent')],'current',40)[0],/unavailable/);
 assert.equal(conversationRelations([view('single')],'single',40)[1],'↓ Children (0): none');
 const hostile=[view('parent',null,'one\n\x1b[31m'),view('current','parent')];
 assert.ok(conversationRelations(hostile,'current',40).every(row=>!/[\x00-\x1f\x7f-\x9f]/.test(row)));
});
