import test from 'node:test';import {crash} from './normal-landing-crash-fixture.mjs';
test('normal accepted-response SIGKILL recovers through weak-scope fresh read identity without rewriting sender or resending',{timeout:90000},t=>crash(t,'after-accept'));
