/** Test-only original-codec wire response; loaded before the actual CLI entry. */
import fs from 'node:fs';
import net from 'node:net';
import { wireResponse } from '../pi/provider-wire-fixture.mjs';
const requests = [];
net.Socket.prototype.connect = function () { throw Error('No network in managed UI fixture'); };
globalThis.fetch = async (url, options) => {
    if (requests.length >= 2) throw Error('Managed UI two-dispatch ceiling');
    const body = JSON.parse(options.body);
    requests.push({ model: body.model, thinking: body.reasoning_effort, messages: body.messages,
        authorization: new Headers(options.headers).get('authorization') });
    fs.writeFileSync(process.env.GITJIG_UI_WIRE_FILE, JSON.stringify(requests), { mode: 0o600 });
    return wireResponse('openai-completions', body.model, { text: 'SYNTHETIC_UI_MANAGED_COMPLETE_' + requests.length });
};
