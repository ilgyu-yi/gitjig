import test from 'node:test';
import assert from 'node:assert/strict';
import { HStack, ScrollView, Text, visibleWidth } from '@earendil-works/pi-tui';
import { createNativeScreen } from '../../dist/ui/native-screen.js';

test('native body drag copies Unicode text through the platform writer and reports writer failure', {timeout: 5000}, async () => {
    let input, fail = false;
    const writes = [], copied = [];
    const terminal = {columns: 80, rows: 16, kittyProtocolActive: false, start(fn) {input = fn;}, stop() {}, async drainInput() {}, write(data) {writes.push(data);}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {}};
    const screen = createNativeScreen(terminal, async text => {if (fail) throw Error('Owned clipboard writer unavailable'); copied.push(text);});
    const text = 'Body 한국어 copy';
    const left = new ScrollView(new Text('\x1b[31m' + text + '\x1b[0m', 0, 0), {follow: 'end', primary: true});
    const right = new ScrollView(new Text('OTHER PANE EXCLUDED', 0, 0), {follow: 'end'});
    screen.setLayoutRoot(new HStack([{component: left, basis: 0, grow: 1}, {component: right, basis: 0, grow: 1}]));
    const settle = async predicate => {
        const until = Date.now() + 1000;
        while (!predicate()) {assert.ok(Date.now() < until, 'Native frame/copy acknowledgement missing'); await new Promise(resolve => setTimeout(resolve, 5));}
    };
    try {
        screen.start(); screen.requestRender();
        await settle(() => screen.getScreenLines().join('\n').includes(text));
        const row = screen.getScreenLines().findIndex(line => line.includes(text)) + 1;
        input(`\x1b[<0;1;${row}M`);
        input(`\x1b[<32;${visibleWidth(text)};${row}M`);
        input(`\x1b[<0;${visibleWidth(text)};${row}m`);
        await settle(() => copied.length === 1);
        assert.equal(copied[0], text);
        assert.doesNotMatch(copied[0], /\x1b|OTHER PANE/);
        assert.doesNotMatch(writes.join(''), /\x1b\]52;/, 'Product callback must not use the unverified bare OSC52 fallback');
        assert.equal(await screen.copyActiveSelectionToClipboard(), true);
        fail = true;
        assert.equal(await screen.copyActiveSelectionToClipboard(), false);
        await settle(() => screen.getScreenLines().join('\n').includes('Owned clipboard writer unavailable'));
        screen.resetTextSelection();
        const count = copied.length;
        assert.equal(await screen.copyActiveSelectionToClipboard(), false);
        assert.equal(copied.length, count);
    } finally {await screen.stop();}
});
