// Exact synthetic readiness seam; native projection/materialization remain real.
import {fixtureDist} from './integration-read-native-only.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {ChangeCore}=await import(pathToFileURL(path.join(fixtureDist,'controller/change-core.js')).href);
const fixture=JSON.parse(fs.readFileSync(process.env.GITJIG_TEST_PREPARATION_CHECKPOINT,'utf8'));
ChangeCore.prototype.currentEvidence=async function(work){assert.equal(work,fixture.workId);return structuredClone(fixture.evidence);};
ChangeCore.prototype.assertCurrentEvidence=function(value){assert.deepEqual(value,fixture.evidence);};
