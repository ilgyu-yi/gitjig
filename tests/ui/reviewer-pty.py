import fcntl,json,os,pathlib,pty,select,signal,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text());master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',38,140,0,0));original=termios.tcgetattr(slave)
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'TMPDIR':cfg['artifacts'],'TERM':'xterm-256color'},close_fds=True)
out=bytearray();stage='start';actions=[];started=time.monotonic();picker_offset=0
try:
 while time.monotonic()-started<45:
  if select.select([master],[],[],0.015)[0]:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   out.extend(chunk)
   if len(out)>3*1024*1024:raise RuntimeError('PTY output cap')
  control={}
  if pathlib.Path(cfg['control']).exists():control=json.loads(pathlib.Path(cfg['control']).read_text())
  if control.get('phase')=='failed' and stage!='closing-failed':os.write(master,b'\x07q');stage='closing-failed';actions.append('graceful-leave-after-fixture-failure')
  elif stage=='start' and b'Ctrl+G commands' in out:os.write(master,b'Parent ordinary question\r');stage='wait-reviewer';actions.append('submit-parent')
  elif stage=='wait-reviewer' and control.get('phase')=='reviewer-ready':picker_offset=len(out);os.write(master,b'\x1bOQ');stage='reviewer-picker';actions.append('open-picker')
  elif stage=='reviewer-picker' and b'Conversations' in out[picker_offset:]:os.write(master,control['reviewerId'].encode()+b'\r');stage='wait-selected-reviewer'
  elif stage=='wait-selected-reviewer' and control.get('selected')==control.get('reviewerId') and control.get('reviewerId'):os.write(master,cfg['question'].encode()+b'\r');stage='wait-parent-completion';actions.append('submit-direct-reviewer')
  elif stage=='wait-parent-completion' and control.get('phase')=='parent-completed':picker_offset=len(out);os.write(master,b'\x1bOQ');stage='parent-picker';actions.append('return-to-parent')
  elif stage=='parent-picker' and b'Conversations' in out[picker_offset:]:os.write(master,control['parentId'].encode()+b'\r');stage='wait-complete'
  elif stage=='wait-complete' and control.get('phase')=='complete':os.write(master,b'\x04');stage='left';actions.append('leave')
  if p.poll() is not None:break
 p.wait(timeout=2)
 while select.select([master],[],[],0.02)[0]:
  try:chunk=os.read(master,65536)
  except OSError:break
  if not chunk:break
  out.extend(chunk)
 mask=termios.ICANON|termios.ECHO|termios.ISIG;pathlib.Path(cfg['output']).write_bytes(out)
 print(json.dumps({'exitCode':p.returncode,'stage':stage,'actions':actions,'terminalRestored':(termios.tcgetattr(slave)[3]&mask)==(original[3]&mask),'outputBytes':len(out),'elapsedMs':round((time.monotonic()-started)*1000),'actualOsPty':True,'humanImeAcceptance':False}))
finally:
 try:
  if p.poll() is None:
   p.send_signal(signal.SIGINT)
   p.wait(timeout=20)
 finally:
  try:pathlib.Path(cfg['output']).write_bytes(out)
  finally:os.close(master);os.close(slave)
