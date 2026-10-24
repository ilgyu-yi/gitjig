import fcntl,json,os,pathlib,pty,select,struct,subprocess,sys,termios,time

cfg=json.loads(pathlib.Path(sys.argv[1]).read_text())
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,140,0,0))
original=termios.tcgetattr(slave)
child=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env=cfg['env'],close_fds=True)
output=bytearray();samples=[];started=time.monotonic();current={};stage='startup'

def pump():
 global current
 if select.select([master],[],[],.005)[0]:
  try:output.extend(os.read(master,65536))
  except OSError:pass
 if len(output)>2**21:raise RuntimeError('Native modal terminal output cap exceeded')
 try:current=json.loads(pathlib.Path(cfg['control']).read_text())
 except (FileNotFoundError,json.JSONDecodeError):pass

def wait(name,predicate):
 global stage
 stage=name;stable=None
 while time.monotonic()-started<12:
  pump()
  if predicate(current):
   if stable is None:stable=time.monotonic()
   if time.monotonic()-stable>.04:samples.append({'stage':name,**current});return
  else:stable=None
  if child.poll() is not None:raise RuntimeError('Native modal exited during '+name)
 raise RuntimeError('Native modal stalled '+name+' '+repr(current))

def text(value):return '\n'.join(value.get('frame',[]))
def send(value):os.write(master,value.encode())
def modal(value,title):return not value.get('editorFocused') and title in text(value)
def unchanged(value):return value.get('draft')==cfg['draft'] and value.get('hookCalls')==0 and value.get('answer') is None and value.get('counts')==baseline

try:
 wait('actual-editor',lambda value:value.get('editorFocused') and 'Ctrl+G q leave' in text(value))
 send('Begin one owned native response\r')
 wait('actual-native-running',lambda value:value.get('state')=='RUNNING' and value.get('requestCalls')==1 and value.get('draft')=='')
 baseline=current['counts'];send('\x1b[200~'+cfg['draft']+'\x1b[201~\x07t')
 wait('parent-setup',lambda value:modal(value,'Setup and next actions') and unchanged(value))
 send('Getting started\r')
 wait('child-guide',lambda value:modal(value,'Give your first request') and unchanged(value))
 pathlib.Path(cfg['gate']).write_text('arm next original startup read');send('\x1b')
 wait('native-arrival-under-held-parent',lambda value:value.get('held') and value.get('nativeRequests')==1 and modal(value,'Working on your selected action') and unchanged(value))
 send('\x1b[200~TYPE_PROBE\x1b[201~\r\x07')
 wait('held-input-remains-owned',lambda value:modal(value,'Working on your selected action') and 'Native confirmation arrived during setup' not in text(value) and 'Commands ·' not in text(value) and unchanged(value))
 pathlib.Path(cfg['gate']+'.release').write_text('release original startup read')
 wait('parent-resumes-before-native',lambda value:value.get('released') and modal(value,'Setup and next actions') and unchanged(value))
 send('\x1b')
 wait('actual-native-dialog-focused',lambda value:modal(value,'Native confirmation arrived during setup') and unchanged(value))
 send('\r')
 wait('one-deliberate-native-answer',lambda value:value.get('state')=='IDLE' and value.get('answer') is True and value.get('hookCalls')==1 and value.get('requestCalls')==1 and value.get('nativeRequests')==1 and value.get('draft')==cfg['draft'])
 send('\x07q')
 while child.poll() is None and time.monotonic()-started<14:pump()
 if child.poll() is None:raise RuntimeError('Native modal did not close normally')
 mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'exitCode':child.returncode,'terminalRestored':termios.tcgetattr(slave)[3]&mask==original[3]&mask,'stages':len(samples)}))
finally:
 if child.poll() is None:
  child.terminate()
  try:child.wait(timeout=3)
  except subprocess.TimeoutExpired:child.kill();child.wait()
 pathlib.Path(cfg['output']).write_bytes(output)
 pathlib.Path(cfg['output']+'.frames.json').write_text(json.dumps({'stage':stage,'samples':samples,'last':current,'exitCode':child.returncode}))
 os.close(master);os.close(slave)
