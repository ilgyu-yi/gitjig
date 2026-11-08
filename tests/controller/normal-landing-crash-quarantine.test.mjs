import test from 'node:test';import {crash} from './normal-landing-crash-fixture.mjs';
test('normal prelauncher SIGKILL preserves original quarantine while isolated weak-scope observation validates fresh read identity',{timeout:90000},t=>crash(t,'before-launcher'));
