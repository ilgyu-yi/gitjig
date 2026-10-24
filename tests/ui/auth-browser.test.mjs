import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {authBrowserNotifications,openAuthBrowser} from '../../dist/app/auth-browser.js';

test('OAuth launcher keeps URL as one argv operand and rejects non-web URLs; cancellation stops its helper',async t=>{
    const calls=[];let complete=true;
    t.mock.method(cp,'spawn',(file,args,options)=>{
        const child=new EventEmitter();child.kill=signal=>{calls.push({kill:signal});return true;};
        calls.push({file,args,options});if(complete)queueMicrotask(()=>child.emit('exit',0));return child;
    });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
    const signal=new AbortController();const url='https://login.example/auth?state=a&literal=$(ignored)';
    assert.equal(await openAuthBrowser(url,signal.signal),true);assert.deepEqual(calls[0].args,[url]);assert.equal(calls[0].options.shell,false);
    for(const bad of ['file:///tmp/login','javascript:alert(1)','https://user:secret@example.com','https://example.com/\n--flag'])assert.equal(await openAuthBrowser(bad,signal.signal),false);
    assert.equal(calls.length,1);complete=false;const waiting=openAuthBrowser(url,signal.signal);signal.abort();assert.equal(await waiting,false);assert.equal(calls.at(-1).kill,'SIGKILL');
});

test('auth notifications open once per attempt, retain manual fallback and never open informational links',async()=>{
    const stopping=new AbortController(),opened=[];let fallback=0;
    const open=async url=>{opened.push(url);return false;};
    const notify=authBrowserNotifications(stopping.signal,()=>fallback++,open);
    const event={type:'auth_url',url:'https://login.example/authorize',instructions:'Not an executable instruction'};
    notify(event);notify(event);notify({type:'info',message:'Info',links:[{url:'https://do-not-open.example'}]});
    notify({type:'device_code',verificationUri:'https://login.example/device',userCode:'PUBLIC-CODE'});
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(opened,[event.url,'https://login.example/device']);assert.equal(fallback,2);
    stopping.abort();notify({type:'auth_url',url:'https://late.example'});assert.equal(opened.length,2);
    const retry=authBrowserNotifications(new AbortController().signal,()=>{},open);retry(event);await Promise.resolve();assert.equal(opened.length,3);
});
