import fcntl,json,os,pathlib,pty,select,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text())
master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,100,0,0));original=termios.tcgetattr(slave)
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'TMPDIR':cfg['artifacts'],'TERM':'xterm-256color'},close_fds=True)
prefix={'ctrl+g':b'\x07','ctrl+q':b'\x11','ctrl+p':b'\x10'}[cfg.get('commandKey','ctrl+g')];ready=('Ctrl+'+cfg.get('commandKey','ctrl+g')[-1].upper()+' commands').encode()
out=bytearray();stage='start';offset=0;started=time.monotonic();sample=None;keyboard=False;refusalBefore=0
try:
 while time.monotonic()-started<10:
  if select.select([master],[],[],0.01)[0]:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   out.extend(chunk)
   if len(out)>2*1024*1024:raise RuntimeError('PTY output cap')
  try:c=json.loads(pathlib.Path(cfg['control']).read_text())
  except (FileNotFoundError,json.JSONDecodeError):continue
  if stage=='start' and ready in out:offset=len(out);os.write(master,prefix+b's');stage='picker'
  elif stage=='picker' and b'Conversations' in out[offset:]:os.write(master,b'\x1b[B\r');stage='split'
  elif stage=='split' and c.get('visibleSecond')==c.get('right'):offset=len(out);os.write(master,prefix+b'w');stage='keyboard-right'
  elif stage=='keyboard-right' and c.get('selected')==c.get('right') and 'INPUT · Conversation idle'.encode() in out[offset:]:offset=len(out);os.write(master,prefix+b'w');stage='keyboard-left'
  elif stage=='keyboard-left' and c.get('selected')==c.get('left') and 'INPUT · Conversation idle'.encode() in out[offset:]:
   keyboard=True
   if cfg.get('persistenceRefusal'):os.write(master,b'\x1b[200~UNSAVED\x1b[201~');stage='unsaved'
   else:os.write(master,b'\x1b[<0;76;29M\x1b[<0;76;29m\x1b[200~POINTER_TARGET\x1b[201~');stage='pointer'
  elif stage=='unsaved' and c.get('failedSaves'):
   refusalBefore=c['failedSaves'];offset=len(out);os.write(master,b'\x1b[<0;76;29M\x1b[<0;76;29m\x1b[200~POINTER_TARGET\x1b[201~');stage='refused'
  elif stage=='refused' and c.get('failedSaves',0)>=refusalBefore+2 and 'POINTER_TARGET' in (c.get('lastAttempt') or {}).get('text','') and b'INJECTED_POINTER_DRAFT_SAVE_UNAVAILABLE' in out:
   sample=c;pathlib.Path(cfg['finish']).write_text('recover-and-close-owned-ui');stage='closed'
  elif stage=='pointer' and 'POINTER_TARGET' in c.get('rightDraft',''):
   sample=c;pathlib.Path(cfg['finish']).write_text('close-owned-ui');stage='closed'
  if p.poll() is not None:break
 if p.poll() is None:raise RuntimeError('Pointer scenario stalled at '+stage+' tail='+repr(bytes(out[-1500:])))
 p.wait(timeout=2)
 mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'exitCode':p.returncode,'stage':stage,'keyboardControl':keyboard,'pointerDeliveredToRightDraft':bool(sample and 'POINTER_TARGET' in sample['rightDraft']),'selectedMatchesPointerTarget':bool(sample and sample['selected']==sample['right']),'sample':sample,'terminalRestored':(termios.tcgetattr(slave)[3]&mask)==(original[3]&mask),'elapsedMs':round((time.monotonic()-started)*1000),'actualOsPty':True,'humanImeAcceptance':False}))
finally:
 pathlib.Path(cfg['output']).write_bytes(out)
 pathlib.Path(cfg['finish']).write_text('close-owned-ui')
 if p.poll() is None:
  try:p.wait(timeout=2)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 os.close(master);os.close(slave)
