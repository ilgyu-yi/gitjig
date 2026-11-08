import test from 'node:test';
import {reviewInputBoundary} from './review-input-runtime-fixture.mjs';
test('review delivery stops changed input before judgment effects: capacity-body',{timeout:60000},()=>reviewInputBoundary('capacity-body'));
