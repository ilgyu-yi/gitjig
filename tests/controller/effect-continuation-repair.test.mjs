import test from 'node:test';
import {scenario} from './continuation-repair-fixture.mjs';
test('actual derived repair deletion and lineage guards preserve current candidate before conditional send',{timeout:90000},t=>scenario(t));
