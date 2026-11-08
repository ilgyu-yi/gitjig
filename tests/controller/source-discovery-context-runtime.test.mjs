import test from 'node:test';
import {sourceDiscoveryProfile} from './source-discovery-runtime-fixture.mjs';
test('narrower model context holds after real allocation and retains actual charge and cleanup',{timeout:120000},()=>sourceDiscoveryProfile({contextWindow:100000,maxTokens:20000,hold:true}));
