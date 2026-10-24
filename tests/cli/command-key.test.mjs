import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseInvocation} from '../../dist/cli/arguments.js';
const execute=promisify(execFile);

test('command key accepts the fixed profile and refuses reserved/unknown bindings before SDK/state acquisition',async()=>{
 for(const value of ['ctrl+g','ctrl+q','ctrl+p'])assert.equal(parseInvocation(['conversation','ui','--command-key',value]).options.get('command-key'),value);
 for(const value of ['ctrl+z','ctrl+x','ctrl+c','ctrl+v','ctrl+space','alt+g','cmd+g','ctrl+unknown'])assert.throws(()=>parseInvocation(['conversation','ui','--command-key',value]),/--command-key must be/);
 const root=await fs.realpath(await fs.mkdtemp(path.resolve('.runtime-fixtures/command-key-'))),home=path.join(root,'must-not-open');
 await assert.rejects(execute(process.execPath,['--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js'),'conversation','ui','--home',home,'--command-key','ctrl+c']),error=>{
  assert.equal(error.code,2);assert.match(error.stderr,/--command-key must be/);assert.doesNotMatch(error.stderr,/SDK_LOADED_ON_LOCAL_PATH/);return true;
 });
 await assert.rejects(fs.stat(home),{code:'ENOENT'});
});
