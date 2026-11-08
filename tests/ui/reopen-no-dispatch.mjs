// Actual CLI startup must not invoke dependency resumption merely to register models.
import './readiness-no-execution.mjs';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const entry = realpathSync(process.argv[1]);
const directory = path.dirname(entry);
const cli = path.basename(directory) === 'cli' && path.basename(path.dirname(directory)) === 'dist';
const controller = cli ? new URL('../controller/ordinary.js', pathToFileURL(entry))
    : new URL('../../dist/controller/ordinary.js', import.meta.url);
const {Ordinary} = await import(controller.href);
let attempts=0;
Ordinary.prototype.resumeAuthorized=function(){attempts++;throw Error('View-only startup attempted dependency resumption');};
process.on('exit',()=>{if(attempts)process.exitCode=1;});
