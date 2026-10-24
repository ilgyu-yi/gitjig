/** Harmless newline-JSON native protocol fixture. No Claude/auth/network imports. */
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
let sent = false;
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
const lines = readline.createInterface({ input: process.stdin });
// Deliberate, bounded-by-parent tail: a typed result alone cannot prove OS cleanup.
const tail = setInterval(() => {}, 1000);
process.once('SIGTERM', () => { clearInterval(tail); lines.close(); process.exit(0); });
lines.on('line', line => {
    if (Buffer.byteLength(line) > 65536) throw Error('Synthetic protocol input oversized');
    const frame = JSON.parse(line);
    if (frame.type === 'control_request') {
        write({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id,
            response: { commands: [], models: [], output_style: 'default', available_output_styles: [] } } });
    }
    if (frame.type !== 'user' || sent) return;
    sent = true;
    fs.writeFileSync(path.join(process.cwd(), 'fixture-observation.json'), JSON.stringify({
        argv: process.argv.slice(2), cwd: process.cwd(), marker: process.env.GITJIG_PROTOCOL_CANARY,
        protocol: '098-original-sdk-synthetic-init-assistant-result', deliberateTail: true
    }), { flag: 'wx', mode: 0o600 });
    write({ type: 'system', subtype: 'init', session_id: 'synthetic-native',
        model: 'claude-opus-5-5', cwd: process.cwd(), tools: [], mcp_servers: [], plugins: [] });
    write({ type: 'assistant', session_id: 'synthetic-native', parent_tool_use_id: null,
        message: { id: 'synthetic-message', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
            content: [{ type: 'text', text: 'SYNTHETIC_CONTROL' }], stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 } } });
    write({ type: 'result', subtype: 'success', is_error: false, session_id: 'synthetic-native',
        duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: 'SYNTHETIC_CONTROL',
        total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } });
});
