import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute = promisify(execFile);
for(const count of [262144,2359296])test(count+' byte no-force PTY failure drains graceful shutdown and records its original child', {timeout: 10000}, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gitjig-pty-graceful-'))), worker = path.join(root, 'worker.py'), config = path.join(root, 'pty.json'), output = path.join(root, 'terminal');
    let passed = false; t.after(async () => { if (passed) await fs.rm(root, {recursive: true, force: true}); else t.diagnostic('Retained original PTY fixture: ' + root); });
    await fs.writeFile(worker, `import os,signal,sys,termios,time\noriginal=termios.tcgetattr(0)\ndef finish(sig,frame):\n os.write(1,b'x'*${count}+b'SHUTDOWN_COMPLETE')\n termios.tcsetattr(0,termios.TCSANOW,original)\n sys.exit(0)\nsignal.signal(signal.SIGTERM,finish)\nprint('ready',flush=True)\nwhile True:time.sleep(.02)\n`);
    await fs.writeFile(config, JSON.stringify({command: ['/usr/bin/python3', worker], cwd: root, env: {PATH: '/usr/bin:/bin', HOME: root, TERM: 'xterm-256color'},
        steps: [{wait: 'never emitted', send: ''}], timeoutSeconds: .2, noForceKill: true, gracefulShutdownSeconds: 3, output}));
    await assert.rejects(execute('/usr/bin/python3', ['tests/cli/fork-ui-pty.py', config], {timeout: 7000, killSignal: 'SIGINT', maxBuffer: 1024 * 1024}), error => error.code === 1);
    const progress = JSON.parse(await fs.readFile(output + '.progress.json', 'utf8'));
    assert.equal(progress.stage, 0); assert.equal(progress.forceKilled, false); assert.equal(progress.exitCode, 0);
    assert.match(progress.error, /TimeoutExpired/); assert.ok(Number.isSafeInteger(progress.childPid));
    assert.throws(() => process.kill(progress.childPid, 0), error => error.code === 'ESRCH');
    const text = await fs.readFile(output); assert.ok(text.includes(Buffer.from('ready'))); assert.ok(text.length >= 262144); assert.equal(text.subarray(-17).equals(Buffer.from('SHUTDOWN_COMPLETE')),count===262144); assert.equal(progress.outputTruncated,count>2*1024*1024); assert.ok(text.length<=2*1024*1024);
    passed = true;
});
