import fcntl,json,os,pathlib,pty,select,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text());master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,120,0,0));original=termios.tcgetattr(slave);p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'TMPDIR':cfg['artifacts'],'TERM':'xterm-256color'},close_fds=True);out=bytearray();stage='start';started=time.monotonic();offset=0;hidden=False;activeModelMatchesChild=False;openingVisible=False
try:
 while time.monotonic()-started<15:
  if select.select([master],[],[],0.01)[0]:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   out.extend(chunk)
  c={}
  if pathlib.Path(cfg['control']).exists():
   try:c=json.loads(pathlib.Path(cfg['control']).read_text())
   except json.JSONDecodeError:continue
  if stage=='start' and b'Ctrl+G commands' in out:os.write(master,b'Parent input\r');stage='wait-dialog'
  elif stage=='wait-dialog' and c.get('phase')==('dialog-opening' if cfg.get('holdOpening') else 'dialog-pending'):
   hidden=c.get('selected')==c.get('parent') and c.get('inputNeeded') and c.get('answer') is None
   if not hidden:raise RuntimeError('hidden dialog autoanswered or stole focus')
   offset=len(out);os.write(master,b'\x07c');stage='current-picker'
  elif stage=='current-picker' and b'Conversations' in out[offset:]:offset=len(out);os.write(master,b'\r');stage='kept-parent'
  elif stage=='kept-parent' and c.get('selected')==c.get('parent'):offset=len(out);os.write(master,b'\x1b[1;2A');stage='parent-ready'
  elif stage=='parent-ready':
   # A rendered footer can precede async picker settlement. Probe an idempotent
   # root boundary until navigation is actually accepted; do not add a sleep.
   if b'No accessible parent' in out[offset:]:
    if c.get('answer') is not None:raise RuntimeError('parent navigation answered hidden child')
    offset=len(out);os.write(master,b'\x07d');stage='picker'
   else:os.write(master,b'\x1b[1;2A')
  elif stage=='picker' and b'Conversations' in out[offset:]:os.write(master,b'\r');stage='dialog'
  elif stage=='dialog' and cfg.get('holdOpening') and c.get('selected')==c.get('child') and b'Opening dialog' in out[offset:] and 'Model: fixture · dialog-child'.encode() in out[offset:]:
   openingVisible=True;activeModelMatchesChild=True;offset=len(out);os.write(master,b'SHOULD_NOT_BECOME_INPUT\r\x1b');stage='opening-cancelled'
  elif stage=='opening-cancelled' and b'Actual hidden child question' in out[offset:]:
   pathlib.Path(cfg['openingRelease']).write_text('release');stage='dialog-confirm'
  elif stage in ['dialog','dialog-confirm'] and c.get('selected')==c.get('child') and b'Actual hidden child question' in out[offset:] and (activeModelMatchesChild or 'Model: fixture · dialog-child'.encode() in out[offset:]):activeModelMatchesChild=True;os.write(master,b'\x1b[1;2A\r');stage='answered'
  elif stage=='answered' and c.get('phase')=='complete':offset=len(out);os.write(master,b'\x07p');stage='return'
  elif stage=='return' and c.get('selected')==c.get('parent'):os.write(master,b'\x04');stage='left'
  if p.poll() is not None:break
 if p.poll() is None:raise RuntimeError('dialog stalled '+stage+' tail='+repr(bytes(out[-500:])))
 p.wait(timeout=2);mask=termios.ICANON|termios.ECHO|termios.ISIG;print(json.dumps({'exitCode':p.returncode,'stage':stage,'hiddenNoFocusNoAnswer':hidden,'activeModelMatchesChild':activeModelMatchesChild,'openingVisible':openingVisible,'terminalRestored':(termios.tcgetattr(slave)[3]&mask)==(original[3]&mask),'elapsedMs':round((time.monotonic()-started)*1000),'humanIME':False}))
finally:
 pathlib.Path(cfg['output']).write_bytes(out)
 if p.poll() is None:p.kill();p.wait()
 os.close(master);os.close(slave)
