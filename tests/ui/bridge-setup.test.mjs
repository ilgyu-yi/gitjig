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
        async show(title, text, primary) {
            shown.push({title, text});
            if (primary && !options.closeReview?.(primary.label)) await primary.run();
        },
        notice(text) { notices.push(text); },
        async inspect() { calls.push('inspect'); return {restartRequired: saved, activation: {runtime: "current", bridge: saved ? "relaunch" : "current"}, saved: saved ? {bridge: {}} : null, effective: options.active ? {bridge: {}} : {}}; },
        restartCommand: "gitjig conversation ui --conversation fixture",
        async execute(command) {
            calls.push(['execute', command]);
            return options.execute?.(command, () => { current = false; }) ?? 'completed';
        },
    };
    return {host, edit, calls, shown, notices, menus, run: () => connectBridge(host, edit)};
}

for (const locale of ['en', 'ko']) {
    test('guided connection reviews account and effects, then inspects fresh saved state · ' + locale, async () => {
        const f = fixture(['discover', 'check', 'review', 'connect', 'restart', 'close'], {locale});
        assert.equal(await f.run(), 'completed');
        assert.deepEqual(f.calls.filter(Array.isArray), [['check', 'client-1', 'route-1'], ['connect', 'checked-1']]);
        assert.equal(f.calls.filter(call => call === 'inspect').length, 3);
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
    assert.deepEqual(f.shown, []);
    assert.match(f.menus[0].title, /Active in this process/);
});

test('connection details return to the same entry before native discovery', async () => {
    const f = fixture(['details', 'close']);
    assert.equal(await f.run(), 'cancelled');
    assert.deepEqual(f.calls, ['inspect']);
    assert.equal(f.shown.length, 1);
    assert.match(f.shown[0].text, /Discovery checks local metadata only/);
    assert.deepEqual(f.menus[0], f.menus[1]);
});

test('a saved runtime repair closes the old bridge edit before native login', async () => {
    let saved = false;
    const f = fixture(['runtime'], {execute:command=>{
        assert.equal(command,'/setup runtime');
        saved = true;
        return 'completed';
    }});
    f.edit.runtimeConfigurationRequired = 'saved';
    f.edit.assertCurrent = () => { if (saved) throw Error('Runtime changed the original settings snapshot'); };
    assert.equal(await f.run(),'completed');
    assert.deepEqual(f.calls,['inspect',['execute','/setup runtime']]);
    assert.match(f.menus[0].title,/Saved runtime needs a Docker configuration directory/);
    assert.match(f.notices[0],/reopen \/bridge/);
});

test('cancelled current runtime repair refuses to return to a changed source', async () => {
    const f = fixture(['discover','runtime'], {execute:(command,stale)=>{
        assert.equal(command,'/setup runtime current');
        stale();
        return 'cancelled';
    }});
    f.edit.runtimeConfigurationRequired = 'current';
    await assert.rejects(f.run(),/source changed/);
    assert.deepEqual(f.calls,['inspect','discover',['execute','/setup runtime current']]);
});

test('cancelled model selection returns to the connection entry without discovery', async () => {
    const f = fixture(['model', 'close'], {active: true, execute: () => 'cancelled'});
    assert.equal(await f.run(), 'cancelled');
    assert.deepEqual(f.calls, ['inspect', ['execute', '/model']]);
    assert.deepEqual(f.menus[0], f.menus[1]);
});

test('a readiness action that starts work leaves the picker without checking an old source', async () => {
    const f = fixture(['ready'], {execute: (_command, stale) => { stale(); return 'started'; }});
    assert.equal(await f.run(), 'started');
    assert.deepEqual(f.calls, ['inspect', ['execute', '/ready']]);
    assert.equal(f.menus.length, 1);
});

test('returning from a cancelled nested action requires the original source', async () => {
    const f = fixture(['advanced'], {execute: (_command, stale) => { stale(); return 'cancelled'; }});
    await assert.rejects(f.run(), /source changed/u);
    assert.equal(f.menus.length, 1);
});

test('cancelled advanced fields return to the missing-client picker without rediscovery', async () => {
    const f = fixture(['discover', 'advanced', 'close'], {execute: () => 'cancelled'});
    f.edit.discover = async guard => { guard(); f.calls.push('discover'); return {candidates: [], routes: []}; };
    assert.equal(await f.run(), 'cancelled');
    assert.deepEqual(f.calls, ['inspect', 'discover', ['execute', '/setup bridge']]);
    assert.deepEqual(f.menus[1], f.menus[2]);
});

for (const outcome of ['cancelled', 'started']) {
    test('post-save readiness preserves the save and the nested outcome · ' + outcome, async () => {
        const f = fixture(['discover', 'check', 'review', 'connect', 'ready', 'close'], {execute: () => outcome});
        assert.equal(await f.run(), outcome === 'started' ? 'started' : 'completed');
        assert.deepEqual(f.calls.filter(Array.isArray), [['check', 'client-1', 'route-1'], ['connect', 'checked-1'], ['execute', '/ready']]);
        assert.equal(f.calls.filter(call => call === 'inspect').length, outcome === 'started' ? 2 : 3);
        assert.equal(f.notices.length, 1);
    });
}

test('selected native check explains its effects before running the client', async () => {
    const f = fixture(['discover', 'close']);
    assert.equal(await f.run(), 'cancelled');
    assert.deepEqual(f.calls, ['inspect', 'discover']);
    assert.match(f.menus[1].title, /account status only.*account store may refresh.*private gitjig folder and policy file/);
});

for (const phase of ['check','connect']) test(`joined ${phase} cancellation returns to the selected bridge route`, async () => {
    const f = fixture(['discover','route','option-1','check',...(phase==='connect'?['review','connect']:[]),items=>{
        assert.ok(!items.some(item=>item.value==='review'),'A cancelled attempt must not leave old Connect approval');
        return 'close';
    }],{locale:'ko'});
    const aborted = Error('Original phase-local cancellation');
    f.edit[phase] = async (...args) => { throw args.at(-1).reason; };
    f.host.runPreparation=async (title,task)=>task(title.includes(phase==='check'?'확인 중':'연결 중')?AbortSignal.abort(aborted):new AbortController().signal,()=>{});
    assert.equal(await f.run(),'cancelled');
    assert.match(f.menus.at(-1).title,phase==='check'?/로그인 확인 취소/:/연결 취소/);
    assert.match(f.menus.at(-1).title,/Explicit directory/);
    assert.ok(!f.shown.some(view=>view.text.includes(aborted.message)));
});

test('unconfirmed native bridge cleanup escapes with original process recovery even when the source moved', async () => {
    const f = fixture(['discover','check','close']);
    const original=Object.assign(Error('Cleanup unknown'),{code:'CLAUDE_SETUP_CLEANUP_UNKNOWN',recovery:'Inspect original process group 3981'});
    f.edit.check=async()=>{f.host.guard=()=>{throw Error('Source moved');};throw original;};
    await assert.rejects(f.run(),error=>error===original);
    assert.deepEqual(f.shown,[]);
});

test('an earlier rejected bridge observation remains a failure despite late Escape', async () => {
    const f=fixture(['discover','check','close']);
    const owner=new AbortController(), failure=Error('Original Claude observation failed');
    f.host.runPreparation=async(_title,task)=>task(owner.signal,()=>{});
    f.edit.check=()=>{
        const pending=Promise.reject(failure);
        queueMicrotask(()=>owner.abort());
        return pending;
    };
    assert.equal(await f.run(),'cancelled');
    assert.match(f.shown[0].text,/Original Claude observation failed/);
    assert.doesNotMatch(f.menus.at(-1).title,/Login check cancelled/);
});

test('a Connect save resolved during Escape is reported as saved', async () => {
    const f=fixture(['discover','check','review','connect','close']);
    const original=f.edit.connect, owner=new AbortController();
    f.host.runPreparation=async(title,task)=>task(title.startsWith('Connecting')?owner.signal:new AbortController().signal,()=>{});
    f.edit.connect=async(...args)=>{const result=await original(...args);owner.abort();return result;};
    assert.equal(await f.run(),'completed');
    assert.equal(f.notices.length,1);
});

test('review back and cancellation cannot connect', async () => {
    const f = fixture(['discover', 'check', 'review', 'back', 'close']);
    assert.equal(await f.run(), 'cancelled');
    assert.ok(!f.calls.some(call => Array.isArray(call) && call[0] === 'connect'));
});

for (const kind of ['review', 'repair']) {
    test('Escape preserves the checked connection without opening confirmation · ' + kind, async () => {
        const repair = kind === 'repair';
        let reviews = 0;
        const f = fixture(['discover', 'check', kind, items => {
            assert.ok(items.some(item => item.value === 'check'));
            return kind;
        }, items => {
            assert.equal(items[0].value, 'back');
            return 'back';
        }, 'close'], {
            ready: !repair, repair, locale: repair ? 'ko' : 'en',
            closeReview(label) {
                assert.equal(label, repair ? '권한 수정 확인 화면 열기' : 'Open settings confirmation');
                return ++reviews === 1;
            },
        });
        assert.equal(await f.run(), 'cancelled');
        assert.equal(reviews, 2);
        assert.deepEqual(f.calls.filter(Array.isArray), [['check', 'client-1', 'route-1']]);
    });
}

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
    f.host.inspect = async () => ({restartRequired: false, activation: {runtime: "current", bridge: "current"}, effective: {bridge: {}}});
    assert.equal(await f.run(), 'completed');
    assert.deepEqual(f.calls, [['execute', '/model']]);
});

test('a validated pending bridge offers restart instructions without reconnecting', async () => {
    const f = fixture(['restart']);
    f.host.inspect = async () => ({restartRequired: true, activation: {runtime: "current", bridge: "relaunch"}, saved: {bridge: {}}, effective: {}});
    assert.equal(await f.run(), 'completed');
    assert.deepEqual(f.calls, []);
    assert.ok(f.shown.some(view => view.text.includes(f.host.restartCommand)));
});

test('invalid saved bridge presence is not displayed as configured', async () => {
    const f = fixture(['details', 'close']);
    f.edit.savedBridge = {profile: {}};
    f.host.inspect = async () => ({restartRequired: false, activation: {runtime: "unknown", bridge: "unknown"}, saved: null, effective: {}, diagnostic: 'Saved bridge prerequisite unavailable'});
    assert.equal(await f.run(), 'cancelled');
    assert.ok(f.menus[0].title.includes('Saved for next launch: saved setup requires repair'));
    assert.ok(!f.menus[0].title.includes('Saved bridge prerequisite unavailable'));
    assert.ok(f.shown[0].text.includes('Saved bridge prerequisite unavailable'));
    assert.ok(!f.menus[0].items.some(item => item.value === 'restart'));
});

for (const locale of ['en', 'ko']) test('post-save invalidation keeps the saved outcome but exposes the fresh repair state · ' + locale, async () => {
    const f = fixture(['discover', 'check', 'review', 'connect', 'close'], {locale});
    let inspections = 0;
    f.host.inspect = async () => ++inspections === 1
        ? {activation: {runtime: 'current', bridge: 'current'}, saved: null, effective: {}}
        : {activation: {runtime: 'unknown', bridge: 'unknown'}, saved: null, effective: {}, diagnostic: 'Owned new bridge policy disappeared'};
    assert.equal(await f.run(), 'completed');
    const menu = f.menus.at(-1);
    assert.match(menu.title, /Owned new bridge policy disappeared/);
    assert.ok(menu.title.includes(locale === 'ko' ? '저장된 설정 복구 필요' : 'saved setup requires repair'));
    assert.ok(!menu.items.some(item => ['restart', 'model'].includes(item.value)));
    assert.ok(menu.items.some(item => item.value === 'inspect'));
    assert.doesNotMatch(f.notices[0], /relaunch|다시 실행/u);
});

test('pending replacement keeps model selection for the existing active session', async () => {
    const f = fixture(['discover', 'check', 'review', 'connect', 'model']);
    let inspections = 0;
    f.host.inspect = async () => ({
        activation: {runtime: 'current', bridge: ++inspections === 1 ? 'current' : 'relaunch'},
        effective: {bridge: {}}, saved: {bridge: {}},
    });
    assert.equal(await f.run(), 'completed');
    assert.deepEqual(f.calls.at(-1), ['execute', '/model']);
    const actions = f.menus.at(-1).items;
    assert.ok(actions.some(item => item.value === 'restart'));
    assert.equal(actions.find(item => item.value === 'model').label, 'Choose a model for this session');
});

test('restart instructions for a removed bridge do not offer its model after relaunch', async () => {
    const f = fixture(['restart']);
    f.host.inspect = async () => ({activation: {runtime: 'current', bridge: 'relaunch'}, saved: {version: 1}, effective: {bridge: {}}});
    assert.equal(await f.run(), 'completed');
    const restart = f.shown.at(-1).text;
    assert.match(restart, /fixture/);
    assert.doesNotMatch(restart, /choose a Claude Code model/);
});

for(const locale of ['en','ko'])test('bridge menu uses bridge activation alone in '+locale,async()=>{
 const f=fixture(['close']);f.host.locale=locale;
 f.host.inspect=async()=>({activation:{runtime:'apply',bridge:'current'},restartRequired:false,saved:{runtime:{}},effective:{bridge:{}}});
 await f.run();assert.ok(!f.menus[0].items.some(item=>item.value==='restart'));
 const removed=fixture(['close']);removed.host.locale=locale;
 removed.host.inspect=async()=>({activation:{runtime:'current',bridge:'relaunch'},restartRequired:true,saved:{version:1},effective:{bridge:{}}});
 await removed.run();assert.ok(removed.menus[0].items.some(item=>item.value==='restart'));assert.ok(!removed.calls.includes('discover'));
});

for(const locale of ['en','ko'])test('bridge inspection explicitly presents unknown activation in '+locale,async()=>{
 const f=fixture(['close']);f.host.locale=locale;
 f.host.inspect=async()=>({activation:{runtime:'unknown',bridge:'unknown'},restartRequired:false,saved:{version:1},effective:null});
 await f.run();assert.ok(f.menus[0].title.includes(locale==='en'?'activation could not be determined':'적용 상태 확인 불가'));assert.ok(!f.menus[0].items.some(item=>item.value==='restart'));
});
