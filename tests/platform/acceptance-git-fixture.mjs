import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture, base, user } from './acceptance-fixture.mjs';

const exec = promisify(execFile);
export const git = '/opt/homebrew/bin/git';
const env = root => ({ PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: root, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Synthetic acceptance', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Synthetic acceptance', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' });
export async function command(root, repository, args, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(git, [`--git-dir=${repository}`, ...args], { env: env(root), stdio: ['pipe', 'pipe', 'pipe'] });
        const out = [], err = [];
        child.stdout.on('data', b => out.push(b)); child.stderr.on('data', b => err.push(b)); child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(Buffer.concat(out)) : reject(Error(Buffer.concat(err).toString())));
        child.stdin.on('error', () => {}); child.stdin.end(input);
    });
}
export async function commit(root, repository, parent, label, operationId) {
    const blob = (await command(root, repository, ['hash-object', '-w', '--stdin'], Buffer.from(label))).toString().trim();
    const tree = (await command(root, repository, ['mktree'], Buffer.from(`100644 blob ${blob}\tconsumer.txt\n`))).toString().trim();
    return (await command(root, repository, ['commit-tree', tree, ...(parent ? ['-p', parent] : [])],
        Buffer.from(operationId ? `Owned Gitjig integration\nOperation: ${operationId}\n` : label))).toString().trim();
}
export async function gitFixture() {
    const rest = await fixture();
    await fs.mkdir('.runtime-fixtures', { recursive: true });
    const root = await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/acceptance-git-')));
    await fs.chmod(root, 0o700);
    const owner = user.login, repository = base.split('/').at(-1), receiver = path.join(root, owner, repository + '.git');
    await fs.mkdir(path.dirname(receiver), { recursive: true, mode: 0o700 });
    await exec(git, ['init', '--bare', '--template=', receiver], { env: env(root) });
    await command(root, receiver, ['config', 'http.receivepack', 'true']);
    const B = await commit(root, receiver, null, 'synthetic-base');
    for (const ref of ['main', 'fixture/ordinary', 'fixture/override', 'fixture/head', 'fixture/race', 'fixture/overlap'])
        await command(root, receiver, ['update-ref', 'refs/heads/' + ref, B]);
    const key = path.join(root, 'key.pem'), caFile = path.join(root, 'ca.pem');
    await exec('/usr/bin/openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', key, '-out', caFile,
        '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']);
    await fs.chmod(key, 0o600); await fs.chmod(caFile, 0o600);
    const execPath = (await exec(git, ['--exec-path'])).stdout.trim(), requests = [], sockets = new Set(), children = new Set();
    const state = { stall: false, dropAfterReceive: false };
    let enteredResolve; let entered = new Promise(r => enteredResolve = r);
    let origin;
    const server = https.createServer({ key: await fs.readFile(key), cert: await fs.readFile(caFile), maxVersion: 'TLSv1.2' }, (request, response) => {
        const authorized = request.headers.authorization === 'Basic ' + Buffer.from('x-access-token:fixture-literal-original').toString('base64');
        requests.push({ path: request.url, authorized });
        if (!authorized) { response.writeHead(401, { 'www-authenticate': 'Basic realm="fixture"' }); response.end(); return; }
        if (state.stall) { enteredResolve(); return; }
        const u = new URL(request.url, origin);
        const child = spawn(path.join(execPath, 'git-http-backend'), [], { env: { ...env(root), GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1',
            PATH_INFO: u.pathname, QUERY_STRING: u.search.slice(1), REQUEST_METHOD: request.method, CONTENT_TYPE: request.headers['content-type'] ?? '',
            CONTENT_LENGTH: request.headers['content-length'] ?? '', REMOTE_USER: 'synthetic-fixture' }, stdio: ['pipe', 'pipe', 'pipe'] });
        children.add(child); child.stderr.resume(); child.stdin.on('error', () => {}); request.pipe(child.stdin);
        const out = []; child.stdout.on('data', b => out.push(b));
        child.on('close', () => {
            children.delete(child);
            const bytes = Buffer.concat(out), end = bytes.indexOf('\r\n\r\n');
            if (end < 0) { response.writeHead(500); response.end(); return; }
            const headers = {}; let status = 200;
            for (const line of bytes.subarray(0, end).toString().split('\r\n')) {
                const split = line.indexOf(':'); if (split < 0) continue;
                const name = line.slice(0, split), value = line.slice(split + 1).trim();
                if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0]); else headers[name] = value;
            }
            if (state.dropAfterReceive && u.pathname.endsWith('/git-receive-pack')) { enteredResolve(); return; }
            response.writeHead(status, headers); response.end(bytes.subarray(end + 4));
        });
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = 'https://127.0.0.1:' + server.address().port;
    return { ...rest, gitRoot: root, receiver, B, requests, gitState: state,
        ownedHttps: { origin, caFile, execPath },
        profile: name => ({ gitBinary: git, ownedClientRoot: path.join(root, name), commandTimeoutMs: 2000 }),
        barrier() { entered = new Promise(r => enteredResolve = r); return entered; },
        async close(options) {
            for (const socket of sockets) socket.destroy();
            for (const child of children) child.kill('SIGKILL');
            await new Promise(r => server.close(r)); await rest.close(options);
            // Native descriptor/terminal artifacts retained in this owned subtree for diagnostics.
        } };
}
export async function files(directory) {
    const paths = [];
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        const p = path.join(directory, item.name);
        if (item.isDirectory()) paths.push(...await files(p)); else if (item.isFile()) paths.push(p);
    }
    return paths;
}
