import test from 'node:test';
import {sourceDiscoveryProfile} from './source-discovery-runtime-fixture.mjs';
test('public large-project procedure discovers off-seed source at the installed model limits',{timeout:120000},()=>sourceDiscoveryProfile({contextWindow:128000,maxTokens:16384,hold:false}));
