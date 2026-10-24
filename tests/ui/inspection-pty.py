"""Actual source execution and result inspection using stable current frames and focus."""
import fcntl,json,os,pathlib,pty,select,struct,subprocess,sys,termios,time

cfg=json.loads(pathlib.Path(sys.argv[1]).read_text())
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,140,0,0))
original=termios.tcgetattr(slave)
child=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env=cfg['env'],close_fds=True)
output=bytearray();snapshots=[];started=time.monotonic();error=None;baseline=cfg.get('expectedLedger')

def pump():
 if select.select([master],[],[],.01)[0]:
  try:output.extend(os.read(master,65536))
  except OSError:pass
 if len(output)>2**22:raise RuntimeError('Managed result terminal output cap exceeded')

def matches(snapshot,step):
 text='\n'.join(snapshot.get('frame',[]))
 return (all(value in text for value in step.get('contains',[]))
  and all(value not in text for value in step.get('absent',[]))
  and ('autocomplete' not in step or snapshot.get('autocomplete')==step['autocomplete'])
  and snapshot.get('editorFocused')==step['editorFocused']
  and snapshot.get('draft')==step['draft']
  and snapshot.get('selected')==step.get('selected',cfg['cid']))

try:
 for index,step in enumerate(cfg['steps']):
  stable=None;last_sequence=None;last_scroll=0;pages=0
  while time.monotonic()-started<cfg.get('timeoutSeconds',60):
   pump()
   try:snapshot=json.loads(pathlib.Path(cfg['observation']).read_text())
   except (FileNotFoundError,json.JSONDecodeError):continue
   if step.get('unchanged') and snapshot.get('ledger')!=baseline:
    raise RuntimeError('Result inspection changed the original execution ledger at step '+str(index))
   if step.get('absent') and matches(snapshot,{**step,'absent':[]}):
    forbidden=[value for value in step['absent'] if value in '\n'.join(snapshot.get('frame',[]))]
    if forbidden:raise RuntimeError('Unexpected visible state at step '+str(index)+': '+', '.join(forbidden))
   if any(not pathlib.Path(item['path']).is_file() for item in step.get('waitFiles',[])):continue
   if matches(snapshot,step):
    if stable is None:stable=time.monotonic();last_sequence=snapshot['sequence']
    if time.monotonic()-stable>=.05 and snapshot['sequence']!=last_sequence:break
   else:
    stable=None
    if step.get('scrollUntil') and snapshot.get('editorFocused') is False and step.get('scrollTitle','Task result') in '\n'.join(snapshot.get('frame',[])) and time.monotonic()-last_scroll>(.05 if step.get('scrollByLine') else .15):
     if pages>=(128 if step.get('scrollByLine') else 12):raise RuntimeError('Result section was not visible after scrolling at step '+str(index))
     os.write(master,b'\x1b[B' if step.get('scrollByLine') else b'\x1b[6~');last_scroll=time.monotonic();pages+=1
   if child.poll() is not None:raise RuntimeError('Managed result exited before step '+str(index))
  else:raise RuntimeError('Managed result step '+str(index)+' did not reach its current frame/focus/draft')
  if step.get('baseline'):baseline=snapshot['ledger']
  snapshots.append({'step':index,**snapshot})
  pathlib.Path(cfg['output']+'.frames.json').write_text(json.dumps({'snapshots':snapshots,'childPid':child.pid,'error':None}))
  if step.get('releaseFile'):pathlib.Path(step['releaseFile']).write_text('release')
  os.write(master,step.get('send','').encode())
 while child.poll() is None and time.monotonic()-started<cfg.get('timeoutSeconds',60)+5:pump()
 if child.poll() is None:raise RuntimeError('Managed result CLI did not close normally')
 if child.returncode!=0:raise RuntimeError('Managed result CLI did not exit successfully')
 while select.select([master],[],[],.01)[0]:
  try:tail=os.read(master,65536)
  except OSError:break
  if not tail:break
  output.extend(tail)
 assert b'\x1b[?1049h' in output and b'\x1b[?1049l' in output,'Alternate terminal was not restored'
 mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'exitCode':child.returncode,'stages':len(snapshots),'terminalRestored':termios.tcgetattr(slave)[3]&mask==original[3]&mask,'ledger':baseline}))
except BaseException as failure:
 error=str(failure);raise
finally:
 if error:
  for file in cfg.get('releaseFilesOnFailure',[]):pathlib.Path(file).write_text('release')
 if child.poll() is None:
  child.terminate()
  try:child.wait(timeout=8)
  except subprocess.TimeoutExpired:child.kill();child.wait()
 pathlib.Path(cfg['output']).write_bytes(output)
 pathlib.Path(cfg['output']+'.frames.json').write_text(json.dumps({'snapshots':snapshots,'lastSnapshot':snapshot if 'snapshot' in locals() else None,'error':error,'exitCode':child.returncode}))
 os.close(master);os.close(slave)
