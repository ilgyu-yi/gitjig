import test from 'node:test';
import {runRecovery} from './publication-recovery-fixture.mjs';
test('explicit WAIT resume inspects actual payload finding, submits corrected bytes through SAME native coordinator/op, fresh J repairs only that payload and normal software evidence is restored',{timeout:20000},()=>runRecovery());
