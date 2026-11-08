import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {guardedProcessMethod} from './guarded-process-method.mjs';

test('actual promisified execFile keeps child, receiver and Buffer outputs through the guard',async()=>{
    const owner={},seen=[];
    const wrapped=guardedProcessMethod(execFile,function(...args){seen.push({receiver:this,args});return Reflect.apply(execFile,this,args);});
    const pending=promisify(wrapped).call(owner,process.execPath,['-e',"process.stdout.write('out');process.stderr.write('err')"],{encoding:null});
    assert.ok(Number.isSafeInteger(pending.child.pid)&&pending.child.pid>0);
    const result=await pending;
    assert.ok(Buffer.isBuffer(result.stdout)&&Buffer.isBuffer(result.stderr));
    assert.equal(result.stdout.toString(),'out');assert.equal(result.stderr.toString(),'err');
    assert.equal(pending.child.exitCode,0);assert.equal(seen.length,1);assert.equal(seen[0].receiver,owner);
    assert.equal(seen[0].args[0],process.execPath);assert.equal(typeof seen[0].args.at(-1),'function');
});
test('actual execFile failure preserves error outputs and the original failed child',async()=>{
    let calls=0;
    const wrapped=guardedProcessMethod(execFile,function(...args){calls++;return Reflect.apply(execFile,this,args);});
    const pending=promisify(wrapped)(process.execPath,['-e',"process.stdout.write('partial');process.stderr.write('failure');process.exit(7)"]);
    await assert.rejects(pending,error=>error.code===7&&error.stdout==='partial'&&error.stderr==='failure');
    assert.equal(pending.child.exitCode,7);assert.equal(calls,1);
});
test('promisification cannot bypass a synchronous guard refusal or allocate a child',async()=>{
    const refusal=Error('Fixture process denied');let calls=0;
    const wrapped=guardedProcessMethod(execFile,()=>{calls++;throw refusal;});
    const pending=promisify(wrapped)(process.execPath,['-e','process.exit(99)']);
    await assert.rejects(pending,error=>error===refusal);assert.equal(pending.child,undefined);assert.equal(calls,1);
});
