import fcntl,json,os,pathlib,pty,select,struct,subprocess,sys,termios,time,signal
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text())
master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,160,0,0));original=termios.tcgetattr(slave)
ko=cfg.get('locale')=='ko'
locale='ko_KR.UTF-8' if ko else 'C.UTF-8'
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'TERM':'xterm-256color','LANG':locale,'LC_ALL':locale},close_fds=True)
out=bytearray();started=time.monotonic();checks=[];stage='startup';c={};offset=0
up=b'\x1b[1;2A';down=b'\x1b[1;2B'
def pump():
 global c
 if select.select([master],[],[],0.005)[0]:
  try:chunk=os.read(master,65536)
  except OSError:chunk=b''
  out.extend(chunk)
 if len(out)>2**21:raise RuntimeError('output cap')
 try:c=json.loads(pathlib.Path(cfg['control']).read_text())
 except (FileNotFoundError,json.JSONDecodeError):pass
def wait(predicate):
 while time.monotonic()-started<12:
  pump()
  if predicate():return
  if p.poll() is not None:break
 raise RuntimeError('hierarchy stalled '+stage+' tail='+repr(bytes(out[-1200:])))
def send(data):
 global offset
 offset=len(out);os.write(master,data)
def at(key):
 heading='입력 · 대화 대기 · #' if ko else 'INPUT · Conversation idle · #'
 return c.get('selected')==c.get(key) and (heading+c.get(key,'missing')[:8]).encode() in out[offset:]
def paste(text):return b'\x1b[200~'+text.encode()+b'\x1b[201~'
def step(name,data,key):
 global stage
 stage=name;send(data);wait(lambda:at(key));checks.append(name)
try:
 toolbar='Ctrl+G 명령' if ko else 'Ctrl+G commands'
 wait(lambda:toolbar.encode() in out and c.get('root'))
 if cfg.get('menuPointer'):
  stage='menu-pointer-input-ownership';send(b'\x07');wait(lambda:any('Commands' in line for line in c.get('frame',[])))
  send(b'\x1b[B');wait(lambda:any('→ j Project' in line for line in c.get('frame',[])))
  send(b'\x1b[A\x1b[1;1:3B\x1b[103;5:3u?');wait(lambda:any('Press a listed letter' in line for line in c.get('frame',[])))
  assert any('→ c Conversations' in line for line in c['frame']), 'Key releases must neither move selection nor close the menu'
  checks.append('menu-release-filter-and-redraw')
  row=next(i+1 for i,line in enumerate(c['frame']) if 'ROOT_DRAFT' in line)
  send(('\x1b[<0;5;'+str(row)+'M'+'\x1b[<0;5;'+str(row)+'m').encode()+paste('MENU_ACK'))
  wait(lambda:'MENU_ACK' in c.get('drafts',{}).get(c['root'],'') or any('Unknown command' in line for line in c.get('frame',[])))
  pathlib.Path(cfg['control']).with_name('menu-pointer-sample.json').write_text(json.dumps(c))
  if c['drafts'][c['root']]=='ROOT_DRAFT':checks.append(stage)
 elif cfg.get('fastSwitch'):
  stage='immediate-input-target-aligned';send(down+paste('BURST_ACK'));wait(lambda:any('BURST_ACK' in text for text in c.get('drafts',{}).values()))
  wait(lambda:at('grand'));pathlib.Path(cfg['control']).with_name('fast-switch-sample.json').write_text(json.dumps(c))
  if c['selected']==c['grand'] and c['drafts'][c['b']]=='B_DRAFT' and c['drafts'][c['grand']]=='GRAND_DRAFTBURST_ACK':checks.append(stage)
 elif cfg.get('stalePicker'):
  if ko:
   stage='localized-parent-boundary'
   parent_boundary='열 수 있는 상위 대화가 없습니다'
   send(up);wait(lambda:any(parent_boundary in line for line in c.get('frame',[])))
   assert c['selected']==c['root']
   send(b'\x07');wait(lambda:any('명령 · Ctrl+G' in line for line in c.get('frame',[])))
   send(b'p');wait(lambda:any(parent_boundary in line for line in c.get('frame',[])))
   assert c['selected']==c['root']
   checks.append(stage)
  scope='바로 아래 대화 선택' if ko else 'children and ancestors'
  context='대화 관계를 보여 주는 항목입니다' if ko else 'Relationship context. Select a direct child'
  open_key='Enter 열기' if ko else 'Enter open'
  changed='선택한 대화가 바뀌었습니다' if ko else 'Selected conversation changed'
  stage='ancestor-context-refused';send(down);wait(lambda:scope.encode() in out[offset:])
  if ko:
   wait(lambda:any('검색:' in line for line in c.get('frame',[])) and any('하위' in line and '#' in line for line in c.get('frame',[])))
  send(b'\x1b[A');wait(lambda:any(context in line for line in c.get('frame',[])))
  assert not any(open_key in line for line in c['frame'])
  send(b'\r'+paste(c['b']));wait(lambda:c['b'].encode() in out[offset:] and any(open_key in line for line in c.get('frame',[])))
  assert c['selected']==c['root'] and c['drafts'][c['root']]=='ROOT_DRAFT';checks.append(stage)
  pathlib.Path(cfg['reparent']).write_text('explicit-reparent-during-picker');wait(lambda:c.get('reparented'))
  stage='stale-picker-refused'
  wait(lambda:any(changed in line for line in c.get('frame',[])))
  assert any(c['b'] in line for line in c['frame']) and not any(open_key in line for line in c['frame'])
  send(b'\r\r'+b'\x15'+paste(c['a']));wait(lambda:c['a'].encode() in out[offset:] and any(open_key in line for line in c.get('frame',[])))
  pathlib.Path(cfg['control']).with_name('stale-picker-sample.json').write_text(json.dumps(c))
  assert c['selected']==c['root'] and c['drafts'][c['root']]=='ROOT_DRAFT' and c['drafts'][c['b']]=='B_DRAFT'
  checks.append(stage);step('fresh-child-after-refusal',b'\r','a')
  step('return-after-refusal',up,'root');send(paste('STALE_ACK'));wait(lambda:c['drafts'][c['root']]=='ROOT_DRAFTSTALE_ACK')
 elif cfg['fault']:
  stage='inject-save-failure';send(paste('UNSAVED'));wait(lambda:c.get('failed',0)>0)
  before=c['failed'];send(up);wait(lambda:c.get('failed',0)>before and any('Draft persistence unavailable' in line for line in c.get('frame',[])))
  assert c['selected']==c['b'] and c['lastAttempt']['text']=='B_DRAFTUNSAVED';checks.append('save-refused')
  pathlib.Path(cfg['recover']).write_text('explicit-owned-recovery');wait(lambda:c.get('recovered'))
  step('exact-text-recovered',up,'root');assert c['drafts'][c['b']]=='B_DRAFTUNSAVED'
  stage='recovered-child-return';send(down);wait(lambda:any('children and ancestors' in line for line in c.get('frame',[])))
  step(stage,paste(c['b'])+b'\r','b')
 else:
  stage='root-boundary';send(up);wait(lambda:b'No accessible parent' in out[offset:]);assert c['selected']==c['root'];checks.append(stage)
  wait(lambda:any('No accessible parent' in line for line in c.get('frame',[])))
  pathlib.Path(cfg['control']).with_name('root-boundary-frame.json').write_text(json.dumps(c['frame']))
  if any('Ctrl+G commands' in line for line in c['frame']):checks.append('toolbar-preserved-on-boundary')
  assert any('Children (2)' in line for line in c['frame'])
  send(paste('EDIT_ACK'));wait(lambda:c.get('drafts',{}).get(c['root'])=='ROOT_DRAFTEDIT_ACK')
  wait(lambda:not any('No accessible parent' in line for line in c.get('frame',[])))
  checks.append('notice-cleared-on-edit')
  # Restore only the explicitly added test text through native backspace editing.
  send(b'\x7f'*8);wait(lambda:c.get('drafts',{}).get(c['root'])=='ROOT_DRAFT')
  send(up);wait(lambda:any('No accessible parent' in line for line in c.get('frame',[])))
  send(b'\x07');wait(lambda:not any('No accessible parent' in line for line in c.get('frame',[])) and any('commands' in line.lower() for line in c.get('frame',[])))
  wait(lambda:any('Commands' in line for line in c.get('frame',[])) and any('ROOT_DRAFT' in line for line in c.get('frame',[])) and any('Model: fixture' in line for line in c.get('frame',[])))
  fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,40,0,0));os.kill(p.pid,signal.SIGWINCH)
  wait(lambda:len(c.get('frame',[]))==24 and any('Commands' in line for line in c['frame']) and any('ROOT_DRAFT' in line for line in c['frame']) and any('Model: fixture' in line for line in c['frame']))
  assert not any('Esc interrupt' in line for line in c['frame']), 'Command mode must show cancellation keys, not interrupt hints'
  assert any('Conversations' in line for line in c['frame']), 'Narrow command labels must retain their meaning'
  pathlib.Path(cfg['control']).with_name('expanded-footer-narrow-frame.json').write_text(json.dumps(c['frame']))
  checks.append('expanded-footer-keeps-context-and-model')
  fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,160,0,0));os.kill(p.pid,signal.SIGWINCH)
  wait(lambda:len(c.get('frame',[]))==36)
  checks.append('notice-cleared-on-menu');send(b'\x1b')
  wait(lambda:not any('Commands ·' in line for line in c.get('frame',[])) and any('Model: fixture' in line for line in c.get('frame',[])))
  send(up);wait(lambda:any('No accessible parent' in line for line in c.get('frame',[])))
  stage='multiple-child-picker';send(down);wait(lambda:b'children and ancestors' in out[offset:]);assert c['selected']==c['root']
  # Search the intended actual child ID; no arbitrary row-order assumption.
  send(paste(c['b'])+b'\r');wait(lambda:at('b'));checks.append(stage);assert c['drafts'][c['root']]=='ROOT_DRAFT'
  wait(lambda:any('Parent:' in line and '[Conversation idle]' in line for line in c.get('frame',[])) and not any('No accessible parent' in line for line in c.get('frame',[])))
  checks.append('notice-cleared-on-navigation')
  step('parent-return',up,'root')
  stage='picker-reopens-for-siblings';send(down)
  wait(lambda:any('children and ancestors' in line for line in c.get('frame',[])) and
       all(any('CHILD' in line and '#'+c[key][:8] in line for line in c['frame']) for key in ('a','b')))
  assert c['selected']==c['root'] and c['drafts'][c['root']]=='ROOT_DRAFT'
  step(stage,paste(c['a'])+b'\r','a')
  step('alternate-parent-return',up,'root')
  stage='choose-previous-child';send(down);wait(lambda:any('children and ancestors' in line for line in c.get('frame',[])))
  step(stage,paste(c['b'])+b'\r','b')
  step('one-level-grandchild',down,'grand')
  stage='release-repeat-no-extra-step';send(b'\x1b[1;2:3A\x1b[1;2:2A'+paste('ACK'));wait(lambda:'ACK' in c.get('drafts',{}).get(c.get('grand'),''));assert c['selected']==c['grand'];checks.append(stage)
  stage='leaf-boundary';send(down);wait(lambda:b'no accessible children' in out[offset:]);assert c['selected']==c['grand'];checks.append(stage)
  step('grand-parent',up,'b');step('root-return',up,'root')
  pathlib.Path(cfg['reparent']).write_text('explicit-owned-reparent');wait(lambda:c.get('reparented'))
  step('stale-child-ignored',down,'a');step('split-setup-parent',up,'root')
  stage='split-default';send(b'\x07s');wait(lambda:any('choose the second pane' in line for line in c.get('frame',[])))
  row=next(line for line in c['frame'] if '→' in line and 'Control conversation #' in line)
  destination=next(c[key] for key in ('root','a','b','grand','other') if '#'+c[key][:8] in row)
  send(b'\r');wait(lambda:c.get('visibleSecond')==destination or b'Choose a different conversation to split' in out[offset:])
  assert destination!=c['root'] and c.get('visibleSecond')==destination and c['selected']==c['root'];checks.append(stage)
  send(b'\x07s');wait(lambda:c.get('second') is None and any('ROOT_DRAFT' in line for line in c.get('frame',[])))
  stage='split-current-context';send(b'\x07s')
  wait(lambda:any('choose the second pane' in line for line in c.get('frame',[])));send(paste(c['root']))
  wait(lambda:any('This conversation is already in the first pane' in line for line in c.get('frame',[])))
  assert not any('Enter open' in line for line in c['frame'])
  send(b'\r\x15'+paste(c['a']));wait(lambda:any(c['a'] in line for line in c.get('frame',[])) and any('Enter open' in line for line in c['frame']))
  assert c['selected']==c['root'] and c.get('second') is None and c['drafts'][c['root']]=='ROOT_DRAFT';checks.append(stage)
  send(b'\r');wait(lambda:c.get('visibleSecond')==c['a'])
  step('split-current-target',down,'a');assert c['second']==c['root']
  send(paste('SPLIT_ACK'));wait(lambda:'SPLIT_ACK' in c.get('drafts',{}).get(c.get('a'),''));assert c['drafts'][c['root']]=='ROOT_DRAFT'
  step('split-return-parent',up,'root')
  stage='native-search-owns-input';send(b'\x1b[70;6u');wait(lambda:b'ind in transcript' in out[offset:])
  send(down+paste('SEARCH_ACK'));wait(lambda:b'SEARCH_ACK' in out[offset:])
  assert c['selected']==c['root'] and c['drafts'][c['root']]=='ROOT_DRAFT';checks.append(stage)
  stage='native-autocomplete-owns-input';send(b'\x1b\x1b[20~');wait(lambda:c.get('autocomplete'))
  send(down);wait(lambda:c.get('completionArrowSeen'));assert c['selected']==c['root'];checks.append(stage)
 pathlib.Path(cfg['finish']).write_text('normal-owned-ui-return')
 wait(lambda:p.poll() is not None);p.wait(timeout=2)
 mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'exitCode':p.returncode,'terminalRestored':(termios.tcgetattr(slave)[3]&mask)==(original[3]&mask),'checks':checks,'elapsedMs':round((time.monotonic()-started)*1000),'actualOsPty':True,'humanAcceptance':False}))
finally:
 pathlib.Path(cfg['output']).write_bytes(out);pathlib.Path(cfg['finish']).write_text('close-owned-ui')
 if p.poll() is None:
  try:p.wait(timeout=2)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 os.close(master);os.close(slave)
