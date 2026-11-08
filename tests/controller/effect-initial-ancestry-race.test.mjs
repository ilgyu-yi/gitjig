import test from 'node:test';
import {scenario} from './continuation-repair-fixture.mjs';
test('initial projection refuses actual non-FF receiver rewrite after checked native ancestry',{timeout:45000},t=>scenario(t,false,true));
