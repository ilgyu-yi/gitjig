import test from 'node:test';
import assert from 'node:assert/strict';
import { failurePresentation, FailureDetails } from '../../dist/ui/failure-details.js';
import { ControllerError } from '../../dist/controller/index.js';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { createNativeEditorFactory } from '../../dist/ui/native-editor.js';

test('failure presentation retains only explicit guidance and identity; sanitizes and bounds display',()=>{
    const error=new ControllerError('PENDING_INPUT','Input remains pending','Reconcile retained input before retry','original-work','original-run');
    Object.assign(error,{credentials:'MUST_NOT_RENDER',cause:{secret:'MUST_NOT_RENDER'}});
    const shown=failurePresentation(error);
    assert.equal(shown.code,'PENDING_INPUT');
    assert.match(shown.summary,/\/error/);
    for(const text of ['PENDING_INPUT','Reconcile retained input','original-work','original-run'])assert.ok(shown.detail.includes(text));
    assert.ok(!shown.detail.includes('MUST_NOT_RENDER'));
    assert.equal(error.workId,'original-work');assert.equal(shown.workId,'original-work');
    assert.match(failurePresentation(Error('Plain error')).detail,/Plain error/);
    assert.match(failurePresentation(null).detail,/Operation unavailable/);
    const malicious=failurePresentation({message:'\x1b[2JMessage\x00',recovery:'x'.repeat(100000),workId:'work\x1b]52;c;CLIPBOARD\x07'});
    assert.equal(malicious.workId,undefined);assert.ok(!/[\x00\x1b\x07]/u.test(malicious.detail));assert.ok(malicious.detail.length<20000);assert.match(malicious.detail,/Display shortened/);
});

test('error details is read-only, scrolls via public SDK and closes once',()=>{
    initTheme('dark',false);createNativeEditorFactory();let closed=0;
    const details=new FailureDetails('Retained original work\n'.repeat(100),()=>closed++);
    details.handleInput('ordinary text');details.handleInput('\x1b[6~');details.handleInput('\x1b');details.handleInput('\r');
    assert.equal(closed,1);
});
