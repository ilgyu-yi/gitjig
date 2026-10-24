"""Actual PTY startup/leave + optional exact-C resume. Never establishes human IME acceptance."""
import os, json, pathlib, pty, fcntl, termios, struct, subprocess, select, time, sys, re, tempfile
if len(sys.argv) not in (2,4) or (len(sys.argv)==4 and sys.argv[2]!='--resume'):
 raise RuntimeError('Usage: python3 startup-smoke.py EXACT_INSTALL_RECEIPT [--resume PRIOR_OBSERVATION_JSON]')
pointer=str(pathlib.Path(sys.argv[1]).resolve());cfg=json.loads(pathlib.Path(pointer).read_text());home=pathlib.Path(cfg['home'])
prior_path=str(pathlib.Path(sys.argv[3]).resolve()) if len(sys.argv)==4 else None
prior=json.loads(pathlib.Path(prior_path).read_text()) if prior_path else None
master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,120,0,0));old=termios.tcgetattr(slave);output=bytearray();left=False;started=time.monotonic()
command=[str(home/'bootstrap/node'),str(pathlib.Path(__file__).with_name('installed-terminal.mjs').resolve()),pointer]
if prior_path:command+=['--resume',prior_path]
p=subprocess.Popen(command,stdin=slave,stdout=slave,stderr=slave,env={**{k:v for k,v in os.environ.items() if k not in {'NODE_OPTIONS','NODE_PATH','PI_PACKAGE_DIR'}},'TERM':'xterm-256color'},close_fds=True)
artifact=pathlib.Path(tempfile.mkdtemp(prefix='gitjig manual startup ')).resolve()
try:
 while time.monotonic()-started<15:
  if select.select([master],[],[],0.025)[0]:
   try:b=os.read(master,65536)
   except OSError:break
   output.extend(b)
   if len(output)>2**21:raise RuntimeError('PTY output cap')
   if not left and b'Ctrl+G commands' in output:os.write(master,b'\x04');left=True
  if p.poll() is not None:break
 p.wait(timeout=2);mask=termios.ICANON|termios.ECHO|termios.ISIG;restored=(termios.tcgetattr(slave)[3]&mask)==(old[3]&mask)
 (artifact/'terminal.bin').write_bytes(output)
 matches=re.findall(rb'Human fixture receipt: ([^\r\n]+)',output)
 observation=str(pathlib.Path(matches[-1].decode()).resolve()) if matches else None
 result={'exitCode':p.returncode,'nativeUiStartedAndLeft':left,'terminalRestored':restored,'elapsedSeconds':round(time.monotonic()-started,3),'payloadId':cfg['payloadId'],'observation':observation,'priorObservation':prior_path,'ptyArtifacts':str(artifact),'humanImeAcceptance':False,'scope':'scripted human-fixture startup/teardown only; no human typing, IME, focus/dialog or scroll acceptance'}
 assert p.returncode==0 and left and restored,result
 assert observation,'Actual helper observation path missing'
 actual=json.loads(pathlib.Path(observation).read_text())
 assert actual['home']==str(home) and actual['payloadId']==cfg['payloadId']
 assert actual['cleanupConfirmed'] is True and not actual.get('snapshotError'),actual.get('snapshotError')
 assert actual['paidCalls']==0 and actual['networkCalls']==0
 assert actual['beforeUI']['conversationIds']==actual['afterUI']['conversationIds'],'Startup/leave created a conversation'
 for which in ('parent','child'):
  before,after=actual['beforeUI'][which],actual['afterUI'][which]
  assert before['conversationId']==after['conversationId']==actual[which]
  for field in ('history','nativeSessionId','generation'):assert before[field]==after[field],f'{which} {field} changed without input'
  assert before['draft']['text']==after['draft']['text'],f'{which} draft bytes changed without input'
  assert after['draft']['revision']>=before['draft']['revision'],f'{which} draft revision regressed'
 if prior:
  assert actual['mode']=='resume' and actual['calls']==[],'Resume reseeded or dispatched a model request'
  assert actual['parent']==prior['parent'] and actual['child']==prior['child'],'Resume changed conversation identity'
  assert actual['priorObservation']['path']==prior_path
  for which in ('parent','child'):
   for field in ('history','draft','nativeSessionId','generation'):assert actual['beforeUI'][which][field]==prior['afterUI'][which][field],f'Resume changed retained {which} {field}'
  assert actual['beforeUI']['conversationIds']==prior['afterUI']['conversationIds'],'Resume created conversations'
 result.update({'parent':actual['parent'],'child':actual['child'],'mode':actual['mode'],'modelCallsThisRun':len(actual['calls']),'sameIdentityDraftHistory':True})
 (artifact/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(result,ensure_ascii=False))
finally:
 if p.poll() is None:p.kill();p.wait()
 if output:(artifact/'terminal.bin').write_bytes(output)
 os.close(master);os.close(slave)
