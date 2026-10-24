import fcntl,json,os,pathlib,pty,select,signal,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text());master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,40,0,0));original=termios.tcgetattr(slave)
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'TMPDIR':cfg['artifacts'],'TERM':'xterm-256color'},close_fds=True)
out=bytearray();stage='start';actions=[];started=time.monotonic();offset=0;pending=False;complete=False;failed=False;smallReason=False;narrowNotice=False;narrowSwitch=False;splitClosed=False
try:
 while time.monotonic()-started<20:
  if select.select([master],[],[],0.01)[0]:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   out.extend(chunk)
   if len(out)>5*1024*1024:raise RuntimeError('PTY output cap')
  control={}
  if pathlib.Path(cfg['control']).exists():
   try:control=json.loads(pathlib.Path(cfg['control']).read_text())
   except json.JSONDecodeError:continue
  if stage=='start' and b'Ctrl+G commands' in out:offset=len(out);os.write(master,b'\x07s');stage='split-picker';actions.append('CtrlG-s')
  elif stage=='split-picker' and b'Conversations' in out[offset:]:os.write(master,b'\x1b[B\r');stage='narrow-split';actions.append('choose-second-pane-at40')
  elif stage=='narrow-split' and control.get('second')==control.get('secondary') and control.get('visibleSecond') is None:
   frame='\n'.join(control.get('frame',[]))
   if 'Split' not in frame or '100' not in frame:continue
   if control.get('primaryDraft')!='' or control.get('secondaryDraft')!='Secondary protected draft':raise RuntimeError('Opening narrow split changed drafts')
   narrowNotice=True;os.write(master,b'\x07w');stage='narrow-switch';actions.append('notice-explains-narrow-split')
  elif stage=='narrow-switch' and control.get('selected')==control.get('secondary'):
   if control.get('visibleSecond') is not None or control.get('secondaryDraft')!='Secondary protected draft':raise RuntimeError('Narrow focus switch lost draft or exposed split')
   narrowSwitch=True;os.write(master,b'\x07w');stage='narrow-return';actions.append('switch-narrow-conversation')
  elif stage=='narrow-return' and control.get('selected')==control.get('primary'):
   fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,100,0,0));os.kill(p.pid,signal.SIGWINCH);stage='split';actions.append('widen-first-open100')
  elif stage=='split' and control.get('visibleSecond'):os.write(master,'Resize protected 한국어'.encode());stage='draft';actions.append('type-focused-primary-draft')
  elif stage=='draft' and control.get('primaryDraft')=='Resize protected 한국어':os.write(master,b'\x07w');stage='focus-second';actions.append('keyboard-focus-second')
  elif stage=='focus-second' and control.get('selected')==control.get('visibleSecond'):
   raise RuntimeError('Controller selected and second IDs must remain distinct')
  elif stage=='focus-second' and control.get('secondaryDraft')=='Secondary protected draft' and control.get('primaryDraft')=='Resize protected 한국어' and control.get('selected')!=control.get('second'):
   # The next callback after the focus command carries the primary as the remembered other pane.
   if control.get('selected')==control.get('primary'):continue
   os.write(master,b' pane');stage='type-second'
  elif stage=='type-second' and control.get('secondaryDraft')=='Secondary protected draft pane':os.write(master,b'\x07w');stage='focus-first'
  elif stage=='focus-first' and control.get('primaryDraft')=='Resize protected 한국어' and control.get('secondaryDraft')=='Secondary protected draft pane':
   if control.get('selected')!=control.get('primary'):continue
   fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,40,0,0));os.kill(p.pid,signal.SIGWINCH);stage='narrow';actions.append('resize40-no-F4')
  elif stage=='narrow' and control.get('columns')==40 and control.get('visibleSecond') is None:
   if not control.get('second') or control.get('paneWidth')!=40 or control.get('primaryDraft')!='Resize protected 한국어' or control.get('secondaryDraft')!='Secondary protected draft pane':raise RuntimeError('Narrow layout lost remembered split/drafts')
   os.write(master,b' focused');stage='narrow-focused'
  elif stage=='narrow-focused' and control.get('primaryDraft')=='Resize protected 한국어 focused':fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,100,0,0));os.kill(p.pid,signal.SIGWINCH);stage='wide';actions.append('expand100-no-F4')
  elif stage=='wide' and control.get('columns')==100 and control.get('visibleSecond')==control.get('second') and control.get('second'):
   if control.get('paneWidth')!=50 or control.get('primaryDraft')!='Resize protected 한국어 focused' or control.get('secondaryDraft')!='Secondary protected draft pane':raise RuntimeError('Expanded layout lost focus/drafts')
   os.write(master,b'\x15');stage='clear-draft';actions.append('clear-primary-draft')
  elif stage=='clear-draft' and control.get('primaryDraft')=='':offset=len(out);os.write(master,b'\x07m');stage='compact-held';actions.append('CtrlG-m')
  elif stage=='compact-held' and control.get('summaryHeld') and b'Summary in progress' in out[offset:]:pending=True;offset=len(out);os.write(master,b'\x1b[18~\x07');stage='duplicate-menu';actions.append('duplicate-F7-while-held')
  elif stage=='duplicate-menu' and b'Commands' in out[offset:]:
   if control.get('compactAttempts')!=1:raise RuntimeError('Duplicate summary reached Controller')
   os.write(master,b'w');stage='compact-other'
  elif stage=='compact-other' and control.get('selected')!=control.get('primary'):
   if control.get('compactAttempts')!=1:raise RuntimeError('Duplicate summary reached Controller')
   pathlib.Path(cfg['releaseSummary']).write_text('release');stage='compact-complete';actions.append('release-summary-on-other-pane')
  elif stage=='compact-complete' and control.get('compact') and b'Summary complete.' in out[offset:]:complete=True;os.write(master,b'\x07w');stage='back-primary'
  elif stage=='back-primary' and control.get('selected')==control.get('primary'):offset=len(out);os.write(master,b'\x07h');stage='tree';actions.append('CtrlG-h')
  elif stage=='tree' and b'Session Tree' in out[offset:]:os.write(master,b'\r');stage='tree-done';actions.append('select-native-node')
  elif stage=='tree-done' and control.get('tree'):offset=len(out);os.write(master,b'\x07c');stage='exhausted-picker'
  elif stage=='exhausted-picker' and b'Conversations' in out[offset:]:os.write(master,control['exhausted'].encode()+b'\r');stage='exhausted-selected'
  elif stage=='exhausted-selected' and control.get('selected')==control.get('exhausted'):offset=len(out);os.write(master,b'\x07m');stage='summary-failure'
  elif stage=='summary-failure' and b'Error:' in out[offset:] and b'allowance exhausted' in out[offset:] and any('allowance exhausted' in line for line in control.get('frame',[])):
   if any('Summary in progress' in line for line in control.get('frame',[])):raise RuntimeError('Failed summary still presented as pending')
   failed=True;offset=len(out);os.write(master,b'\x07c');stage='small-picker'
  elif stage=='small-picker' and b'Conversations' in out[offset:]:os.write(master,control['small'].encode()+b'\r');stage='small-selected'
  elif stage=='small-selected' and control.get('selected')==control.get('small'):offset=len(out);os.write(master,b'\x07m');stage='small-reason'
  elif stage=='small-reason' and b'Summary unavailable: Error: Nothing to compact' in out[offset:]:
   smallReason=True;os.write(master,b'\x1bOS');stage='close-split';actions.append('close-split-F4')
  elif stage=='close-split' and control.get('second') is None:
   splitClosed=True;os.write(master,b'\x04');stage='left';actions.append('leave-after-allowance-and-small-history-refusals')
  if p.poll() is not None:break
 if p.poll() is None:raise RuntimeError('PTY scenario stalled at '+stage+' tail='+repr(bytes(out[-1500:])))
 p.wait(timeout=2);pathlib.Path(cfg['output']).write_bytes(out);mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'exitCode':p.returncode,'stage':stage,'actions':actions,'pendingVisible':pending,'completeVisible':complete,'allowanceFailureVisible':failed,'smallHistoryReasonVisible':smallReason,'narrowSplitNoticeVisible':narrowNotice,'narrowSplitSwitchPreservedDraft':narrowSwitch,'splitClosed':splitClosed,'terminalRestored':(termios.tcgetattr(slave)[3]&mask)==(original[3]&mask),'elapsedMs':round((time.monotonic()-started)*1000),'outputBytes':len(out),'actualOsPty':True,'humanImeAcceptance':False}))
finally:
 pathlib.Path(cfg['output']).write_bytes(out)
 if p.poll() is None:p.kill();p.wait()
 os.close(master);os.close(slave)
