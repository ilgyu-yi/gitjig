import test from 'node:test';
import path from 'node:path';
import {localEvidenceRuntimeJourney} from './local-evidence-runtime-journey.mjs';

test('actual owner local command evidence binds current raw staged source, detects hidden/ignored drift and retains same-work spend',{timeout:90000},async t=>{
 await localEvidenceRuntimeJourney(t,{entry:[process.execPath,'--import',path.resolve('tests/cli/no-sdk-loader.mjs'),path.resolve('dist/cli/main.js')]});
});
