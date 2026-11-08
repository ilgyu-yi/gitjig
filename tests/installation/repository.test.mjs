import test from 'node:test';
import {installedRepositoryJourney} from './repository-journey.mjs';

// Current npm snapshot; native hosting responses are owned synthetic fixtures.
test('installed repository forms customize native policy and guide developers with original UNKNOWN reconciliation',{timeout:150000},async t=>installedRepositoryJourney(t));
