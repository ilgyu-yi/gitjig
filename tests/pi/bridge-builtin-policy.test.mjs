/** Native runtime origin and effect-admission metadata; no native process or provider request. */
import '../normal-hosted/no-external.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const entry = import.meta.resolve('@gitjig/pi-claude-bridge-host');
const { BridgeHost } = await import(new URL('./host.js', entry));
const settings = () => ({
    disableAllHooks: true, autoMemoryEnabled: false, syncClaudeAiSkills: false, syncClaudeAiPlugins: false, enabledPlugins: {
        'agents-md@builtin': false, 'plugin-authoring@builtin': false
    }
});
const options = () => ({
    cwd: '/owned-host', pathToClaudeCodeExecutable: '/owned-native', env: {}, settingSources: [], settings: settings(), spawnNative() {
        assert.fail('No native birth in policy inspection');
    }, observeNative() {
    }
});
const builtin = {
    name: 'cc-plugin-sec-default', path: 'builtin'
};
const privacy = {
    name: 'cc-plugin-privacy', path: 'builtin', source: 'cc-plugin-privacy@builtin'
};
const component = name => ({
    name, path: 'builtin', source: name + '@builtin'
});
function subject(t) {
    const input = options(), host = new BridgeHost(input);
    host.bind('policy-session');
    t.after(() => host.close());
    return {
        host, query: host.query('policy-session')
    };
}
const init = plugins => ({
    type: 'system', subtype: 'init', tools: [], mcp_servers: [], plugins
});
for (const change of [
    'missing', 'enabled'
])
    test(`host policy refuses ${change} optional plugin-authoring suppression`, () => {
        const input = options();
        if (change === 'missing')
            delete input.settings.enabledPlugins['plugin-authoring@builtin'];
        else
            input.settings.enabledPlugins['plugin-authoring@builtin'] = true;
        assert.throws(() => new BridgeHost(input), /BRIDGE_HOST_POLICY_UNAVAILABLE/);
    });
for (const name of [
    'sec-default@builtin', 'cc-plugin-sec-default@builtin', 'privacy@builtin', 'cc-plugin-privacy@builtin'
])
    test(`fixed native policy refuses an override for ${name}`, () => {
        const input = options();
        input.settings.enabledPlugins[name] = false;
        assert.throws(() => new BridgeHost(input), /BRIDGE_HOST_POLICY_UNAVAILABLE/);
    });
test('provider and summary options preserve optional-plugin suppression without overriding native security policy', async () => {
    const input = options(), host = new BridgeHost(input);
    host.bind('policy-provider');
    host.bind('policy-summary');
    const scope = host.openSummaryOperation('policy-summary', new AbortController().signal, async () => {
    });
    try {
        const provider = host.query('policy-provider'), summary = (await host.summary('policy-summary')).query;
        for (const query of [
            provider, summary
        ]) {
            assert.deepEqual(query.options().settings.enabledPlugins, input.settings.enabledPlugins);
            assert.equal(Object.hasOwn(query.options().settings.enabledPlugins, 'sec-default@builtin'), false);
            assert.equal(Object.hasOwn(query.options().settings.enabledPlugins, 'privacy@builtin'), false);
            assert.equal(Object.hasOwn(query.options().settings.enabledPlugins, 'cc-plugin-privacy@builtin'), false);
            assert.doesNotThrow(() => query.observe(init([
                {
                    ...builtin, source: 'cc-plugin-sec-default@builtin'
                }, privacy
            ])));
        }
    }
    finally {
        await scope.close().catch(() => {
        });
        await host.close();
    }
});
const acceptedOrigins = [
    [
        'no plugins', []
    ], [
        'only exact mandatory builtin', [
            builtin
        ]
    ], [
        'observed builtin source metadata', [
            {
                ...builtin, source: 'cc-plugin-sec-default@builtin'
            }
        ]
    ], [
        'observed privacy policy', [
            privacy
        ]
    ], [
        'observed security and privacy policies', [
            {
                ...builtin, source: 'cc-plugin-sec-default@builtin'
            }, privacy
        ]
    ], [
        'reversed native components', [
            privacy, builtin
        ]
    ], [
        'future native component', [
            component('runtime-component-next')
        ]
    ], [
        'three native components', [
            builtin, privacy, component('another-runtime-feature')
        ]
    ], [
        'bounded native catalogue', Array.from({
            length: 128
        }, (_, i) => component('native-' + i))
    ], [
        'bounded component name', [
            component('n'.repeat(128))
        ]
    ]
];
for (const [label, plugins] of acceptedOrigins)
    test(`native initialization accepts ${label}`, t => {
        const { query } = subject(t);
        assert.doesNotThrow(() => query.observe(init(plugins)));
    });
const refusedOrigins = [
    [
        'missing privacy source', [
            {
                name: privacy.name, path: 'builtin'
            }
        ]
    ],
    [
        'wrong privacy source', [
            {
                ...privacy, source: 'cc-plugin-privacy@external'
            }
        ]
    ],
    [
        'external privacy path', [
            {
                ...privacy, path: '/external/cc-plugin-privacy'
            }
        ]
    ],
    [
        'wrong security source', [
            {
                ...builtin, source: 'cc-plugin-sec-default@external'
            }
        ]
    ],
    [
        'null security source', [
            {
                ...builtin, source: null
            }
        ]
    ],
    [
        'duplicate privacy', [
            privacy, privacy
        ]
    ],
    [
        'unidentified component among native components', [
            builtin, privacy, {
                name: 'cc-plugin-plugin-authoring', path: 'builtin'
            }
        ]
    ],
    [
        'oversized native catalogue', Array.from({
            length: 129
        }, (_, i) => component('native-' + i))
    ],
    [
        'oversized component name', [
            component('n'.repeat(129))
        ]
    ],
    [
        'ambiguous component name', [
            component('native@external')
        ]
    ],
    [
        'path-like component name', [
            component('../native')
        ]
    ],
    [
        'spoofed origin', [
            {
                ...component('native-feature'), source: 'other-feature@builtin'
            }
        ]
    ],
    [
        'external extension', [
            {
                name: 'personal-feature', path: '/plugins/personal-feature', source: 'personal-feature@marketplace'
            }
        ]
    ],
    [
        'primitive row', [
            1
        ]
    ],
    [
        'null row', [
            null
        ]
    ],
    [
        'optional component without native origin', [
            {
                name: 'cc-plugin-plugin-authoring', path: 'builtin'
            }
        ]
    ],
    [
        'unidentified component', [
            {
                name: 'unknown', path: 'builtin'
            }
        ]
    ],
    [
        'legacy alias', [
            {
                name: 'sec-default', path: 'builtin'
            }
        ]
    ],
    [
        'external path', [
            {
                name: builtin.name, path: '/owned/external-plugin'
            }
        ]
    ],
    [
        'missing path', [
            {
                name: builtin.name
            }
        ]
    ],
    [
        'duplicate builtin', [
            builtin, builtin
        ]
    ],
    [
        'malformed plugins', null
    ],
];
for (const [label, plugins] of refusedOrigins)
    test(`native initialization refuses ${label}`, t => {
        const { query } = subject(t);
        assert.throws(() => query.observe(init(plugins)), /BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: plugins/);
    });
test('mandatory builtin cannot permit an unexpected native tool', t => {
    const { query } = subject(t);
    assert.throws(() => query.observe({
        ...init([
            builtin, privacy
        ]), tools: [
            'Bash'
        ]
    }), /BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: tools/);
});
test('mandatory builtin cannot permit an unexpected MCP server', t => {
    const { query } = subject(t);
    assert.throws(() => query.observe({
        ...init([
            builtin, privacy
        ]), mcp_servers: [
            {
                name: 'unselected', status: 'connected'
            }
        ]
    }), /BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: MCP-servers/);
});
test('accepted mandatory builtin cannot admit a second native initialization', t => {
    const { query } = subject(t);
    query.observe(init([
        builtin
    ]));
    assert.throws(() => query.observe(init([])), /BRIDGE_HOST_NATIVE_PROFILE_MISMATCH: duplicate-init/);
});
