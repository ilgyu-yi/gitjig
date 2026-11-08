import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {acceptanceFixture as scope} from '../../.qualification/github-acceptance-setup.js';
export const base = `/repos/${scope.owner}/${scope.repository}`;
export const user = { id: scope.ownerId, login: scope.owner, type: 'User' };
export const repo = () => ({ id: 91234001, node_id: 'R_ACTUAL_OWNED_FIXTURE', name: scope.repository, full_name: scope.owner + '/' + scope.repository,
    url: 'https://api.github.com' + base, owner: user, private: true, visibility: 'private', fork: false, permissions: { admin: true },
    archived: false, disabled: false, has_issues: true, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true,
    unrelated_private_field: 'must-not-persist-unrelated-response' });
export async function fixture(options = {}) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'acceptance-local-')));
    const root = path.join(directory, 'setup'), state = { repository: options.exists ? repo() : null, calls: [], issues: [], rules: [], stall: false, native: options.native ?? null, failReadback: options.failReadback ?? false };
    const sockets = new Set(); let enter;
    const entered = new Promise(r => enter = r);
    const server = http.createServer(async (request, response) => {
        const bytes = []; for await (const b of request) bytes.push(b);
        const u = new URL(request.url, 'https://api.github.com');
        const body = bytes.length ? JSON.parse(Buffer.concat(bytes)) : null;
        state.calls.push({ method: request.method, path: u.pathname, query: u.search, auth: request.headers.authorization, body });
        response.setHeader('content-type', 'application/json'); response.setHeader('x-oauth-scopes', options.weak || request.headers.authorization === 'Bearer fixture-negative-metadata' ? '' : 'repo');
        const send = (value, status = 200) => { response.statusCode = status; response.end(JSON.stringify(value)); };
        if (state.stall) { enter(); return; }
        if (u.pathname === '/user') return send(options.wrongUser ? { ...user, id: 3 } : user);
        if (request.method === 'POST' && u.pathname === '/user/repos') {
            state.repository = { ...repo(), ...options.createdMutation };
            if (options.dropCreate) return request.socket.destroy();
            return send(state.repository, 201);
        }
        if (u.pathname === base) {
            if (state.repository && state.failReadback) { state.failReadback = false; return send({ message: 'unavailable' }, 503); }
            if (request.method === 'PATCH') Object.assign(state.repository, body);
            return send(state.repository ?? { message: 'Not Found' }, state.repository ? 200 : 404);
        }
        if (u.pathname === base + '/issues' && request.method === 'POST') {
            const n = state.issues.length + 1, row = { id: 100 + n, node_id: 'I' + n, number: n, ...body, user, repository_url: 'https://api.github.com' + base,
                url: 'https://api.github.com' + base + '/issues/' + n, html_url: `https://github.com/${scope.owner}/${scope.repository}/issues/${n}` };
            state.issues.push(row); if (options.dropIssueResponse) return request.socket.destroy(); return send(row, 201);
        }
        if (u.pathname === base + '/issues') return send(state.issues);
        const issue = u.pathname.match(/\/issues\/(\d+)$/);
        if (issue) return send(state.issues.find(row => row.number === Number(issue[1])) ?? {}, state.issues.some(row => row.number === Number(issue[1])) ? 200 : 404);
        if (state.native) {
            if (u.pathname === base + '/git/refs' && request.method === 'POST') {
                const name = body.ref?.slice('refs/heads/'.length);
                if (!['fixture/ordinary','fixture/override','fixture/head','fixture/race','fixture/overlap'].includes(name)) return send({},422);
                try { await state.native.command(['update-ref', body.ref, body.sha, '0000000000000000000000000000000000000000']); } catch { return send({},422); }
                if (state.native.dropRef === name) return request.socket.destroy();
                return send({ref:body.ref,node_id:'REF-'+name,url:'https://api.github.com'+base+'/git/refs/heads/'+name,object:{type:'commit',sha:body.sha}},201);
            }
            const refMatch = u.pathname.startsWith(base + '/git/ref/heads/') ? u.pathname.slice((base + '/git/ref/heads/').length) : null;
            if (refMatch) {
                try { const sha=(await state.native.command(['rev-parse','--verify','refs/heads/'+refMatch])).toString().trim(); return send({ref:'refs/heads/'+refMatch,node_id:'REF-'+refMatch,url:'https://api.github.com'+base+'/git/refs/heads/'+refMatch,object:{type:'commit',sha}}); }
                catch { return send({},404); }
            }
            let sha; try { sha=(await state.native.command(['rev-parse','refs/heads/main'])).toString().trim(); } catch { return send({},404); }
            if (u.pathname === base + '/rules/branches/main') return send([]);
            if (u.pathname === '/graphql') return send({data:{repository:{__typename:'Repository',id:state.repository.node_id,nameWithOwner:state.repository.full_name,ref:{__typename:'Ref',id:'REF-main',name:'main',prefix:'refs/heads/',target:{__typename:'Commit',oid:sha}},branchProtectionRules:{nodes:[],totalCount:0,pageInfo:{hasNextPage:false,endCursor:null}}}}});
        }
        if (u.pathname === base + '/rulesets') return send(state.rules);
        return send({ message: 'Not Found' }, 404);
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const setupOptions = { origin: 'http://127.0.0.1:' + server.address().port, token: 'fixture-literal-original', journalRoot: root };
    return { state, root, directory, entered, setupOptions,
        async close({preserve = false} = {}) { for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); if (!preserve) await fs.rm(directory, { recursive: true, force: true }); } };
}
