import test from 'node:test';
import assert from 'node:assert/strict';
import {connectBridge} from '../../dist/ui/bridge-setup.js';

function fixture(actions, options = {}) {
    const calls = [], shown = [], notices = [], menus = [];
    let current = true, saved = false, checked = 0, route = '';
    const result = () => ({
        id: 'checked-' + checked, ready: options.ready ?? true,
        client: {label: 'Fixture Claude', version: '1.2.3'},
        account: {email: 'fixture@example.invalid', organization: 'Fixture Org', plan: 'team', loggedIn: true, authMethod: options.authMethod ?? 'claude.ai'},
        routeLabel: route, loginCommand: "env -u CLAUDE_CONFIG_DIR HOME='/fixture/operator' '/fixture/claude' auth login",
        review: {clientPath: '/fixture/claude', sha256: 'a'.repeat(64), managedDirectory: '/fixture/gitjig/connection', accountDirectory: '/fixture/account', policyFile: '/fixture/gitjig/connection/claude-bridge.json'},
        ...(options.repair ? {permissionRepair: {id: 'repair-1', labels: ['/fixture/account · 0755 → 0700']}} : {}),
    });
    const guard = () => { if (!current) throw Error('source changed'); };
    const edit = {
        savedBridge: undefined,
        assertCurrent() { if (saved) throw Error('old byte snapshot'); },
        async discover(g) { g(); calls.push('discover'); return {candidates: [{id: 'client-1', label: 'Fixture Claude', source: 'fixture'}, {id: 'client-2', label: 'Other Claude', source: 'fixture'}], routes: [{id: 'route-1', label: 'Default home', kind: 'home'}, {id: 'route-2', label: 'Explicit directory', kind: 'directory'}]}; },
        async check(client, source, g) { g(); calls.push(['check', client, source]); route = source; checked++; await options.duringCheck?.(() => { current = false; }); return result(); },
        async repairPermissions(id, g) { g(); calls.push(['repair', id]); },
        async connect(id, g) { g(); calls.push(['connect', id]); saved = true; options.afterSave?.(() => { current = false; }); return {saved: true, restartRequired: true}; },
    };
    const host = {
        locale: options.locale ?? 'en', guard,
        async choose() { throw Error('stable choices required'); },
        async chooseItems(title, items) {
            menus.push({title, items});
            const action = actions.shift();
            if (typeof action === 'function') return action(items, () => { current = false; });
            if (action !== undefined) assert.ok(items.some(item => item.value === action), 'Missing action ' + action);
            return action;
        },
        async show(title, text) { shown.push({title, text}); },
        notice(text) { notices.push(text); },
        async inspect() { calls.push('inspect'); return {restartRequired: saved, effective: {}}; },
        restartCommand: "gitjig conversation ui --conversation fixture",
        async execute(command) { calls.push(['execute', command]); },
    };
    return {host, edit, calls, shown, notices, menus, run: () => connectBridge(host, edit)};
}

for (const locale of ['en', 'ko']) {
    test('guided connection reviews account and effects, then inspects fresh saved state · ' + locale, async () => {
        const f = fixture(['discover', 'check', 'review', 'connect', 'restart', 'close'], {locale});
        assert.equal(await f.run(), 'completed');
        assert.deepEqual(f.calls.filter(Array.isArray), [['check', 'client-1', 'route-1'], ['connect', 'checked-1']]);
        assert.equal(f.calls.filter(call => call === 'inspect').length, 2);
        assert.equal(f.notices.length, 1);
        assert.ok(f.shown.some(view => view.text.includes('fixture@example.invalid') && view.text.includes('/fixture/gitjig/connection/claude-bridge.json') && view.text.includes('a'.repeat(64))));
        assert.ok(f.shown.some(view => view.text.includes(f.host.restartCommand)));
        const postSave = f.menus.find(menu => menu.items.some(item => item.value === 'restart'));
        assert.ok(!postSave.items.some(item => item.value === 'model'), 'pending bridge cannot select an inactive model');
    });
}

test('opening and returning before discovery has no native checks or writes', async () => {
    const f = fixture(['close']);
    assert.equal(await f.run(), 'cancelled');
    assert.deepEqual(f.calls, ['inspect']);
});

test('review back and cancellation cannot connect', async () => {
    const f = fixture(['discover', 'check', 'review', 'back', 'close']);
    assert.equal(await f.run(), 'cancelled');
    assert.ok(!f.calls.some(call => Array.isArray(call) && call[0] === 'connect'));
});

for (const field of ['client', 'route']) {
    test('changing ' + field + ' invalidates checked account identity', async () => {
        const f = fixture(['discover', 'check', field, 'option-1', items => {
            assert.ok(!items.some(item => item.value === 'review'));
            return 'check';
        }, 'review', 'connect', 'close']);
        assert.equal(await f.run(), 'completed');
        assert.deepEqual(f.calls.filter(call => Array.isArray(call) && call[0] === 'connect'), [['connect', 'checked-2']]);
        const checks = f.calls.filter(call => Array.isArray(call) && call[0] === 'check');
        assert.deepEqual(checks[1], ['check', field === 'client' ? 'client-2' : 'client-1', field === 'route' ? 'route-2' : 'route-1']);
    });
}

test('source drift during native login check refuses before review or connect', async () => {
    const f = fixture(['discover', 'check'], {duringCheck: async stale => stale()});
    await assert.rejects(f.run(), /source changed/u);
    assert.ok(!f.calls.some(call => Array.isArray(call) && call[0] === 'connect'));
});

test('separate permission repair needs confirmation and another explicit check', async () => {
    const f = fixture(['discover', 'check', 'repair', 'repair', items => {
        assert.ok(!items.some(item => item.value === 'review'));
        return 'close';
    }], {ready: false, repair: true});
    assert.equal(await f.run(), 'cancelled');
    assert.deepEqual(f.calls.filter(Array.isArray), [['check', 'client-1', 'route-1'], ['repair', 'repair-1']]);
});

test('navigation after committed save returns completion without late notices or stale-byte refusal', async () => {
    const f = fixture(['discover', 'check', 'review', 'connect'], {afterSave: stale => stale()});
    assert.equal(await f.run(), 'completed');
    assert.equal(f.notices.length, 0);
    assert.equal(f.calls.filter(call => call === 'inspect').length, 1);
});

test('missing client offers rediscovery and advanced setup without a native check', async () => {
    const f = fixture(['discover', 'advanced']);
    f.edit.discover = async guard => { guard(); return {candidates: [], routes: []}; };
    assert.equal(await f.run(), 'completed');
    assert.deepEqual(f.calls.filter(Array.isArray), [['execute', '/setup bridge']]);
});


test('source navigation in post-save actions keeps the committed outcome', async () => {
    const f = fixture(['discover', 'check', 'review', 'connect', (_items, stale) => { stale(); return 'restart'; }]);
    assert.equal(await f.run(), 'completed');
    assert.equal(f.notices.length, 1);
    assert.ok(!f.shown.some(view => view.text.includes(f.host.restartCommand)));
});

test('failed Connect keeps selection but requires a new explicit account check', async () => {
    const f = fixture(['discover', 'check', 'review', 'connect', items => {
        assert.ok(!items.some(item => item.value === 'review'));
        return 'close';
    }]);
    f.edit.connect = async (_id, guard) => { guard(); throw Error('Fixture account changed'); };
    assert.equal(await f.run(), 'cancelled');
    assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'check').length, 1);
    assert.ok(f.shown.some(view => view.text === 'Fixture account changed'));
    assert.equal(f.notices.length, 0);
});

test('native check and Connect use cancellable progress with bridge-specific scope', async () => {
    const f = fixture(['discover', 'check', 'review', 'connect', 'close']);
    const controllers = [];
    f.host.runPreparation = async (title, task, presentation) => {
        assert.match(title, /no model request/u);
        assert.match(presentation.cancelHint, /private setup files/u);
        assert.doesNotMatch(presentation.cancelHint, /packages|VM|engine/u);
        const abort = new AbortController();
        controllers.push(abort);
        return task(abort.signal, () => {});
    };
    const originalCheck = f.edit.check, originalConnect = f.edit.connect;
    f.edit.check = async (candidate, route, guard, signal) => {
        assert.equal(signal, controllers.at(-1).signal);
        return originalCheck(candidate, route, guard);
    };
    f.edit.connect = async (id, guard, signal) => {
        assert.equal(signal, controllers.at(-1).signal);
        return originalConnect(id, guard);
    };
    assert.equal(await f.run(), 'completed');
    assert.equal(controllers.length, 2);
});


test('unsupported native login shows the exact selected-route login command without invoking it', async () => {
    const f = fixture(['discover', 'check', 'close'], {ready: false, authMethod: 'api_key'});
    assert.equal(await f.run(), 'cancelled');
    assert.ok(f.shown.some(view => view.text.includes("env -u CLAUDE_CONFIG_DIR HOME='/fixture/operator' '/fixture/claude' auth login")));
    assert.deepEqual(f.calls.filter(Array.isArray), [['check', 'client-1', 'route-1']]);
});

test('an active bridge can enter model selection without discovery, account probes or new setup', async () => {
    const f = fixture(['model']);
    f.host.inspect = async () => ({restartRequired: false, effective: {bridge: {}}});
    assert.equal(await f.run(), 'completed');
    assert.deepEqual(f.calls, [['execute', '/model']]);
});

test('a validated pending bridge offers restart instructions without reconnecting', async () => {
    const f = fixture(['restart']);
    f.host.inspect = async () => ({restartRequired: true, saved: {bridge: {}}, effective: {}});
    assert.equal(await f.run(), 'completed');
    assert.deepEqual(f.calls, []);
    assert.ok(f.shown.some(view => view.text.includes(f.host.restartCommand)));
});

test('invalid saved bridge presence is not displayed as configured', async () => {
    const f = fixture(['close']);
    f.edit.savedBridge = {profile: {}};
    f.host.inspect = async () => ({restartRequired: false, saved: null, effective: {}, diagnostic: 'Saved bridge prerequisite unavailable'});
    assert.equal(await f.run(), 'cancelled');
    assert.ok(f.shown[0].text.includes('Saved for next launch: Not configured'));
    assert.ok(f.shown[0].text.includes('Saved bridge prerequisite unavailable'));
    assert.ok(!f.menus[0].items.some(item => item.value === 'restart'));
});
