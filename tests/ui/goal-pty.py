import fcntl,json,os,pathlib,pty,select,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text());master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,100,0,0));original=termios.tcgetattr(slave)
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env={**os.environ,'TERM':'xterm-256color'},close_fds=True);out=bytearray();stage='start';started=time.monotonic()
try:
 while time.monotonic()-started<15:
  if select.select([master],[],[],0.01)[0]:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   out.extend(chunk)
  state={}
  try:state=json.loads(pathlib.Path(cfg['control']).read_text())
  except (FileNotFoundError,json.JSONDecodeError):pass
  if stage=='start' and b'Ctrl+G commands' in out:os.write(master,b'/goal start\r');stage='active'
  elif stage=='active' and state.get('calls')==1 and b'Goal coordination running' in out:os.write(master,b'\x1b[1;2B');stage='child'
  elif stage=='child' and state.get('selected')==state.get('child'):os.write(master,b'\x1b[1;2A');stage='parent'
  elif stage=='parent' and state.get('selected')==state.get('parent'):os.write(master,b'/goal pause\r');stage='pause'
  elif stage=='pause' and state.get('goal',{}).get('state')=='PAUSED' and b'Goal paused' in out:os.write(master,b'\x04');stage='left'
  if p.poll() is not None:break
 if p.poll() is None:raise RuntimeError('goal UI stalled '+stage+' tail='+repr(bytes(out[-1200:])))
 p.wait(timeout=2);mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'stage':stage,'exitCode':p.returncode,'terminalRestored':(termios.tcgetattr(slave)[3]&mask)==(original[3]&mask)}))
finally:
 pathlib.Path(cfg['output']).write_bytes(out)
 if p.poll() is None:p.kill();p.wait()
 os.close(master);os.close(slave)
