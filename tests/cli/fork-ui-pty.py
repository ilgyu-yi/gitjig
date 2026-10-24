import fcntl,hashlib,json,os,pathlib,pty,select,sqlite3,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text()); master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,140,0,0)); original=termios.tcgetattr(slave)
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env=cfg['env'],cwd=cfg.get('cwd'),close_fds=True)
output=bytearray(); pending=bytearray(); stage=0; started=time.monotonic(); offsets=[]; failure=None
steps=cfg['steps']
try:
 while time.monotonic()-started<cfg.get('timeoutSeconds',10):
  if select.select([master],[],[],.02)[0]:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   output.extend(chunk);pending.extend(chunk)
   pathlib.Path(cfg['output']).write_bytes(output)
   if len(output)>2*1024*1024:raise RuntimeError('Output cap')
  if stage<len(steps) and steps[stage]['wait'].encode() in pending:
    checks=steps[stage].get('queries',[])
    if checks:
     db=sqlite3.connect('file:'+cfg['database']+'?mode=ro',uri=True)
     try:matched=all([list(row) for row in db.execute(check['sql'],check.get('params',[])).fetchall()]==check['rows'] for check in checks)
     finally:db.close()
     if not matched:continue
    if any(not pathlib.Path(check['path']).is_file() or pathlib.Path(check['path']).read_text()!=check['value'] for check in steps[stage].get('waitFiles',[])):continue
    if steps[stage].get('nativeUnchanged'):
     assert hashlib.sha256(pathlib.Path(cfg['nativeFile']).read_bytes()).hexdigest()==cfg['nativeSHA256'],'Source history changed'
    for check in steps[stage].get('textFiles',[]):assert pathlib.Path(check['path']).read_text()==check['value'],'Unexpected controlled action count'
    if 'releaseFile' in steps[stage]:pathlib.Path(steps[stage]['releaseFile']).write_text('release')
    if 'mutations' in steps[stage]:
     # Explicit controlled stale-source injection in this private fixture only.
     db=sqlite3.connect(cfg['database'])
     try:
      for mutation in steps[stage]['mutations']:db.execute(mutation['sql'],mutation.get('params',[]))
      db.commit()
     finally:db.close()
    if steps[stage].get('waitIdle'):
     db=sqlite3.connect('file:'+cfg['database']+'?mode=ro',uri=True)
     try:idle=db.execute('SELECT resource FROM conversation_state JOIN interaction_view ON conversation=selected').fetchone()[0]=='IDLE'
     finally:db.close()
     if not idle:continue
    if 'assertStored' in steps[stage]:
     auth=json.loads(pathlib.Path(cfg['authFile']).read_text()) if pathlib.Path(cfg['authFile']).exists() else {}
     current=auth.get(steps[stage].get('provider','openai'))
     if steps[stage]['assertStored']:assert current and current.get('key')==cfg['secret'],'Intended credential missing'
     else:assert current is None,'Cancelled/removed credential unexpectedly stored'
    if 'assertDraft' in steps[stage]:
     db=sqlite3.connect('file:'+cfg['database']+'?mode=ro',uri=True)
     try:
      assert db.execute('SELECT draft FROM conversation_views JOIN interaction_view ON conversation=selected').fetchone()[0]==steps[stage]['assertDraft'],'Exact selected setup draft not preserved'
      assert db.execute('SELECT COUNT(*) FROM conversation_inputs').fetchone()[0]==steps[stage].get('expectedInputs',cfg.get('expectedInputs',0)),'Unexpected queued input'
      if 'expectedSelected' in steps[stage]:assert db.execute('SELECT selected FROM interaction_view').fetchone()[0]==steps[stage]['expectedSelected'],'Unexpected input target'
      if 'expectedChoice' in steps[stage]:
       choice=json.loads(db.execute('SELECT data FROM conversation_state JOIN interaction_view ON conversation=selected').fetchone()[0])['modelChoice']
       for key,value in steps[stage]['expectedChoice'].items():assert choice.get(key)==value,'Cancel changed model choice'
     finally:db.close()
    if 'keybindings' in steps[stage]:
     keyfile=pathlib.Path(cfg['keybindingsFile']);keyfile.write_text(json.dumps(steps[stage]['keybindings']));keyfile.chmod(0o600)
    if steps[stage].get('terminate'):p.terminate()
    os.write(master,bytes.fromhex(steps[stage]['keys']) if 'keys' in steps[stage] else steps[stage]['send'].encode());stage+=1;offsets.append(len(output));pending.clear()
    pathlib.Path(cfg['output']+'.progress.json').write_text(json.dumps({'stage':stage,'expectedStages':len(steps),'actionOutputOffsets':offsets,'elapsedSeconds':time.monotonic()-started,'childPid':p.pid}))
  if p.poll() is not None:break
 p.wait(timeout=1)
 mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'exitCode':p.returncode,'stages':stage,'terminalRestored':termios.tcgetattr(slave)[3]&mask==original[3]&mask,'alternateEntered':b'\x1b[?1049h' in output,'alternateExited':b'\x1b[?1049l' in output}))
except BaseException as error:
 failure=type(error).__name__+': '+str(error);raise
finally:
 pathlib.Path(cfg['output']).write_bytes(output)
 if p.poll() is None:
  if cfg.get('gracefulShutdownSeconds'):
   p.terminate()
   try:p.wait(timeout=cfg['gracefulShutdownSeconds'])
   except subprocess.TimeoutExpired:p.kill();p.wait()
  else:p.kill();p.wait()
 pathlib.Path(cfg['output']+'.progress.json').write_text(json.dumps({'stage':stage,'expectedStages':len(steps),'actionOutputOffsets':offsets,'error':failure,'exitCode':p.returncode,'elapsedSeconds':time.monotonic()-started}))
 os.close(master);os.close(slave)
