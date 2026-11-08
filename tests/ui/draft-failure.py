import fcntl,json,os,pathlib,pty,select,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text());master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,100,0,0));original=termios.tcgetattr(slave)
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'TMPDIR':cfg['artifacts'],'TERM':'xterm-256color'},close_fds=True);out=bytearray();stage='start';actions=[];started=time.monotonic();offset=0
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
  if stage=='start' and b'Ctrl+G commands' in out:os.write(master,b'\x1bOR');stage='create-fail';actions.append('F3-fails')
  elif stage=='create-fail' and c.get('createFailed'):offset=len(out);os.write(master,b'\x1bOS');stage='split-picker';actions.append('F4-fails')
  elif stage=='split-picker' and b'Conversations' in out[offset:]:os.write(master,b'\x1b[B\r');stage='split-fail'
  elif stage=='split-fail' and c.get('splitFailed'):os.write(master,cfg['draft'].encode());stage='draft-fail';actions.append('type-exact-unsaved-draft')
  elif stage=='draft-fail' and c.get('failed'):offset=len(out);os.write(master,b'\x1bOQ');stage='picker-fail';actions.append('try-navigation')
  elif stage=='picker-fail' and b'Conversations' in out[offset:]:os.write(master,b'\x1b[B\r');stage='selection-fail'
  elif stage=='selection-fail' and b'Draft persistence unavailable' in out[offset:]:
   if c.get('selected')!=c.get('primary'):raise RuntimeError('Failed persistence changed selection')
   pathlib.Path(cfg['recover']).write_text('recover');stage='recover';actions.append('restore-state-writes')
  elif stage=='recover' and c.get('recovering'):offset=len(out);os.write(master,b'\x1bOQ');stage='picker-success'
  elif stage=='picker-success' and b'Conversations' in out[offset:]:os.write(master,b'\x1b[B\r');stage='selected-success'
  elif stage=='selected-success' and c.get('selected')==c.get('secondary') and c.get('ackText')==cfg['draft']:os.write(master,b'\x04');stage='left';actions.append('same-exact-draft-acknowledged')
  if p.poll() is not None:break
 if p.poll() is None:raise RuntimeError('draft scenario stalled '+stage+' tail='+repr(bytes(out[-1000:])))
 p.wait(timeout=2);mask=termios.ICANON|termios.ECHO|termios.ISIG;print(json.dumps({'exitCode':p.returncode,'stage':stage,'actions':actions,'terminalRestored':(termios.tcgetattr(slave)[3]&mask)==(original[3]&mask),'elapsedMs':round((time.monotonic()-started)*1000)}))
finally:
 pathlib.Path(cfg['output']).write_bytes(out)
 if p.poll() is None:p.kill();p.wait()
 os.close(master);os.close(slave)
