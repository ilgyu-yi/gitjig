import fcntl,json,os,pathlib,pty,select,sqlite3,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text()); master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,140,0,0)); original=termios.tcgetattr(slave)
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env=cfg['env'],close_fds=True)
if cfg.get('pidFile'):pathlib.Path(cfg['pidFile']).write_text(str(p.pid))
output=bytearray(); pending=bytearray(); stage=0; started=time.monotonic(); offsets=[]; failure=None
steps=cfg['steps']; secret=pathlib.Path(cfg['secretFile']).read_text() if cfg.get('secretFile') else cfg.get('secret')
try:
 while time.monotonic()-started<cfg.get('timeoutSeconds',10):
  if select.select([master],[],[],.02)[0]:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   output.extend(chunk);pending.extend(chunk)
   if len(output)>2*1024*1024:raise RuntimeError('Output cap')
  if stage<len(steps) and steps[stage]['wait'].encode() in pending:
    if any(key in steps[stage] for key in ['waitSelected','waitSecond','waitParent','assertParent']):
     db=sqlite3.connect('file:'+cfg['database']+'?mode=ro',uri=True)
     try:
      selected,second=db.execute('SELECT selected,second FROM interaction_view').fetchone()
      if 'waitSelected' in steps[stage] and selected!=steps[stage]['waitSelected']:continue
      if 'waitSecond' in steps[stage] and second!=steps[stage]['waitSecond']:continue
      if 'waitParent' in steps[stage]:
       relation=db.execute('SELECT parent FROM conversation_relations WHERE child=?',(selected,)).fetchone()
       if not relation or relation[0]!=steps[stage]['waitParent']:continue
      if 'assertParent' in steps[stage]:assert db.execute('SELECT parent FROM conversation_relations WHERE child=?',(selected,)).fetchone()[0]==steps[stage]['assertParent'],'Wrong actual selected child relation'
     finally:db.close()
    if steps[stage].get('waitIdle'):
     db=sqlite3.connect('file:'+cfg['database']+'?mode=ro',uri=True)
     try:idle=db.execute('SELECT resource FROM conversation_state JOIN interaction_view ON conversation=selected').fetchone()[0]=='IDLE'
     finally:db.close()
     if not idle:continue
    if 'assertStored' in steps[stage]:
     auth=json.loads(pathlib.Path(cfg['authFile']).read_text()) if pathlib.Path(cfg['authFile']).exists() else {}
     current=auth.get(steps[stage].get('provider','openai'))
     if steps[stage]['assertStored']:assert current and current.get('key')==secret,'Intended credential missing'
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
    if steps[stage].get('probePeer'):
     peer=subprocess.Popen(cfg['peerCommand'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=cfg['env'],close_fds=True)
     try:peerout,peererr=peer.communicate(timeout=5)
     except BaseException:peer.kill();peer.wait();raise
     pathlib.Path(cfg['peerFile']).write_text(json.dumps({'pid':peer.pid,'code':peer.returncode,'stdout':peerout.decode(),'stderr':peererr.decode()}))
     assert peer.returncode==2 and b'OWNER_BUSY' in peererr,'Same-home peer was not refused by original owner'
    if 'keybindings' in steps[stage]:
     keyfile=pathlib.Path(cfg['keybindingsFile']);keyfile.write_text(json.dumps(steps[stage]['keybindings']));keyfile.chmod(0o600)
    if steps[stage].get('terminate'):p.terminate()
    os.write(master,secret.encode() if steps[stage].get('sendSecret') else bytes.fromhex(steps[stage]['keys']) if 'keys' in steps[stage] else steps[stage]['send'].encode());stage+=1;offsets.append(len(output));pending.clear()
  if p.poll() is not None:break
 p.wait(timeout=1)
 mask=termios.ICANON|termios.ECHO|termios.ISIG
 print(json.dumps({'exitCode':p.returncode,'stages':stage,'terminalRestored':termios.tcgetattr(slave)[3]&mask==original[3]&mask,'alternateEntered':b'\x1b[?1049h' in output,'alternateExited':b'\x1b[?1049l' in output}))
except BaseException as error:
 failure=type(error).__name__+': '+str(error);raise
finally:
 pathlib.Path(cfg['output']).write_bytes(output)
 if p.poll() is None:p.kill();p.wait()
 pathlib.Path(cfg['output']+'.progress.json').write_text(json.dumps({'stage':stage,'expectedStages':len(steps),'actionOutputOffsets':offsets,'error':failure,'exitCode':p.returncode,'elapsedSeconds':time.monotonic()-started}))
 os.close(master);os.close(slave)
