import test from 'node:test';
import {scenario} from './continuation-repair-fixture.mjs';
test('actual repairer unauthorized README edit remains zero-send despite passing fixture judgments',{timeout:45000},t=>scenario(t,true));
