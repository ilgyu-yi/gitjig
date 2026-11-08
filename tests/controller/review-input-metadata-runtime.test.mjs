import test from 'node:test';
import {reviewInputBoundary} from './review-input-runtime-fixture.mjs';
test('review receipt metadata drift stops before model entry',{timeout:60000},()=>reviewInputBoundary('capacity-metadata'));
