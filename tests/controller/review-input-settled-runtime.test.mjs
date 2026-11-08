import test from 'node:test';
import {reviewInputBoundary} from './review-input-runtime-fixture.mjs';
test('review delivery stops changed input before judgment effects: settled-capture',{timeout:60000},()=>reviewInputBoundary('settled-capture'));
