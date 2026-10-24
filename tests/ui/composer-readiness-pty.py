"""A narrow actual-terminal consumer that waits for current frames and actual focus."""
import fcntl,json,os,pathlib,pty,select,sqlite3,struct,subprocess,sys,termios,time

cfg=json.loads(pathlib.Path(sys.argv[1]).read_text())
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,140,0,0))
original=termios.tcgetattr(slave)
child=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env=cfg['env'],close_fds=True)
output=bytearray();snapshots=[];started=time.monotonic();error=None

def pump():
 if select.select([master],[],[],.005)[0]:
  try:output.extend(os.read(master,65536))
  except OSError:pass
 if len(output)>2**21:raise RuntimeError('Composer terminal output cap exceeded')

def matches(snapshot,step):
 text='\n'.join(snapshot.get('frame',[]))
 return (all(value in text for value in step.get('contains',[]))
  and all(value not in text for value in step.get('absent',[]))
  and snapshot.get('editorFocused')==step['editorFocused']
  and snapshot.get('draft')==step['draft']
  and snapshot.get('counts')=={'works':0,'runs':0,'conversation_inputs':0})

try:
 for index,step in enumerate(cfg['steps']):
  stable=None;last_sequence=None
  while time.monotonic()-started<10:
   pump()
   try:snapshot=json.loads(pathlib.Path(cfg['observation']).read_text())
   except (FileNotFoundError,json.JSONDecodeError):continue
   if matches(snapshot,step):
    if stable is None:stable=time.monotonic();last_sequence=snapshot['sequence']
    if time.monotonic()-stable>=.04 and snapshot['sequence']!=last_sequence:break
   else:stable=None
   if child.poll() is not None:raise RuntimeError('Composer exited before step '+str(index))
  else:raise RuntimeError('Composer step '+str(index)+' did not reach its current frame/focus/draft')
  snapshots.append({'step':index,**snapshot})
  if step.get('writeFile'):pathlib.Path(step['writeFile']).write_text('explicit fixture gate')
  os.write(master,step.get('send','').encode())
 while child.poll() is None and time.monotonic()-started<12:pump()
 if child.poll() is None:raise RuntimeError('Composer did not close normally')
 if child.returncode!=0:raise RuntimeError('Composer did not exit successfully')
 while select.select([master],[],[],.01)[0]:
  try:tail=os.read(master,65536)
  except OSError:break
  if not tail:break
  output.extend(tail)
  if len(output)>2**21:raise RuntimeError('Composer terminal output cap exceeded')
 assert b'\x1b[?1049l' in output,'Alternate screen was not restored'
 restored=output.rsplit(b'\x1b[?1049l',1)[1]
 for label in [cfg['expectedFinalDraft'],'Working on your selected action','Closing Gitjig','Model:','모델:']:
  assert label.encode() not in restored,'Closed application replayed its live layout into the shell'
 wal=pathlib.Path(cfg['database']+'-wal')
 assert not wal.exists() or wal.stat().st_size==0,'Closed composer left uncheckpointed SQLite data'
 with sqlite3.connect('file:'+cfg['database']+'?mode=ro&immutable=1',uri=True) as database:
  retained=database.execute('SELECT draft FROM conversation_views JOIN interaction_view ON conversation=selected').fetchone()[0]
  assert retained==cfg['expectedFinalDraft'],'Menu exit changed the exact unsent request'
  for table in ['works','runs','conversation_inputs']:
   assert database.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==0,'Menu exit dispatched work'
 mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'exitCode':child.returncode,'stages':len(snapshots),'terminalRestored':termios.tcgetattr(slave)[3]&mask==original[3]&mask,'retainedDraft':retained}))
except BaseException as failure:
 error=str(failure);raise
finally:
 if child.poll() is None:
  child.terminate()
  try:child.wait(timeout=3)
  except subprocess.TimeoutExpired:child.kill();child.wait()
 pathlib.Path(cfg['output']).write_bytes(output)
 pathlib.Path(cfg['output']+'.frames.json').write_text(json.dumps({'snapshots':snapshots,'error':error,'exitCode':child.returncode}))
 os.close(master);os.close(slave)
