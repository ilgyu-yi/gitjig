import fcntl,json,os,pathlib,pty,resource,select,signal,struct,subprocess,sys,termios,time
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text()); master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',32,120,0,0))
original=termios.tcgetattr(slave); env={**os.environ,'TMPDIR':cfg['artifacts'],'TERM':'xterm-256color'}
p=subprocess.Popen(cfg['command'],stdin=slave,stdout=slave,stderr=slave,env=env,close_fds=True)
output=bytearray();sent=False;left=False;started=time.monotonic();startup_ms=None;turn_started=None;turn_ms=[];markers=cfg.get('markers',[cfg['marker']]);turn=0;pending_idle=False
try:
 while time.monotonic()-started<20:
  ready,_,_=select.select([master],[],[],0.025)
  if ready:
   try:chunk=os.read(master,65536)
   except OSError:break
   if not chunk:break
   output.extend(chunk)
   if len(output)>2*1024*1024:raise RuntimeError('PTY output cap')
   if not sent and ('Ctrl+'+cfg.get('commandKey','ctrl+g')[-1].upper()+' commands').encode() in output:
    startup_ms=round((time.monotonic()-started)*1000,3);turn_started=time.monotonic();os.write(master,cfg['input'].encode()+b'\r');sent=True
   if sent and not left and not pending_idle and markers[turn].encode() in output:
    turn_ms.append(round((time.monotonic()-turn_started)*1000,3));turn+=1
    if turn<len(markers):
     pending_idle=True
    else:os.write(master,b'\x04');left=True
   if pending_idle and b'IDLE' in chunk:
    pending_idle=False;turn_started=time.monotonic();os.write(master,cfg['input'].encode()+b'\r')
  if p.poll() is not None:break
 p.wait(timeout=2)
 while select.select([master],[],[],0.02)[0]:
  try:chunk=os.read(master,65536)
  except OSError:break
  if not chunk:break
  output.extend(chunk)
  if len(output)>2*1024*1024:raise RuntimeError('PTY output cap')
 mask=termios.ICANON|termios.ECHO|termios.ISIG
 restored=(termios.tcgetattr(slave)[3]&mask)==(original[3]&mask)
 pathlib.Path(cfg['output']).write_bytes(output)
 print(json.dumps({'exitCode':p.returncode,'sent':sent,'left':left,'terminalRestored':restored,'alternateScreenEntered':b'\x1b[?1049h' in output,'alternateScreenExited':b'\x1b[?1049l' in output,'outputBytes':len(output),'elapsedMs':round((time.monotonic()-started)*1000),'startupMs':startup_ms,'turnResponseMs':turn_ms,'childMaxRssBytes':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss if sys.platform=='darwin' else resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss*1024,'humanImeAcceptance':False}))
finally:
 pathlib.Path(cfg['output']).write_bytes(output)
 if p.poll() is None:p.kill();p.wait()
 os.close(master);os.close(slave)
