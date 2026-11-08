import os, sys, json, time, select, signal, termios

config = json.load(open(sys.argv[1]))
pid, fd = os.forkpty()
if pid == 0:
    os.execve(config['command'][0], config['command'], config['env'])
output = bytearray()
sent = False
status = None
started = time.monotonic()
before = termios.tcgetattr(fd)
try:
    while time.monotonic() - started < 8:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if ready:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                chunk = b''
            output.extend(chunk)
            if len(output) > 1024 * 1024:
                raise RuntimeError('Terminal output bound')
        # The original Pi prompt is secret, presented by gitjig's terminal
        # interaction; wait for its rendered prompt before supplying input.
        if not sent and b'API key' in output:
            os.write(fd, b'\x04' if config['cancel'] == 'eof' else b'\x03' if config['cancel'] else config['secret'].encode() + b'\r')
            sent = True
        done, child_status = os.waitpid(pid, os.WNOHANG)
        if done:
            status = child_status
            break
    if status is None:
        raise RuntimeError('Account terminal did not settle within8s')
    after = termios.tcgetattr(fd)
    result = dict(exitCode=os.waitstatus_to_exitcode(status), sent=sent,
                  secretVisible=config['secret'].encode() in output,
                  terminalRestored=(before[3] & (termios.ECHO | termios.ICANON)) == (termios.ECHO | termios.ICANON) and
                                   (after[3] & (termios.ECHO | termios.ICANON)) == (termios.ECHO | termios.ICANON),
                  output=output.decode(errors='replace'))
    with open(config['output'], 'w') as stream:
        json.dump(result, stream)
    # Keep transcript in private evidence, never echo any entered secret.
    print(json.dumps({key: value for key, value in result.items() if key != 'output'}))
finally:
    if status is None:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    os.close(fd)
