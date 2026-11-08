#!/usr/bin/env node
// Pin one source/npm payload before loading any product modules. This also
// handles Node's symlink-preservation flags and an atomically switched alias.
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
try {
    const entry = pathToFileURL(realpathSync(fileURLToPath(import.meta.url)));
    await import(new URL('./source-entry.js', entry).href);
}
catch (error) {
    console.error(JSON.stringify({ error: 'STARTUP_UNAVAILABLE', message: String((error as Error).message) }));
    process.exitCode = 2;
}
