#!/usr/bin/env node
// Source/npm launcher: establish one application-owned temporary root before SDK loading.
// The versioned offline installation keeps its separate bound launcher and integrity checks.
import { join } from 'node:path';
import { resolveApplicationHome } from '../app/home.js';
import { assertCompatibleNode } from '../app/runtime-requirements.js';
import { parseInvocation, UsageError } from './arguments.js';
try {
    assertCompatibleNode();
    const args = process.argv.slice(2);
    const informational = args.length === 1 && ['--help', '--version'].includes(args[0]!);
    if (!informational && args.length) {
        const invocation = parseInvocation(args);
        if (invocation.command !== 'doctor' && invocation.command !== 'repo recommend') {
            process.env.TMPDIR = join(resolveApplicationHome(invocation.options.get('home')), 'artifacts');
        }
    }
    else if (!args.length) {
        process.env.TMPDIR = join(resolveApplicationHome(), 'artifacts');
    }
    await import('./main.js');
}
catch (error) {
    console.error(JSON.stringify({ error: error instanceof UsageError ? 'USAGE' : 'STARTUP_UNAVAILABLE', message: String((error as Error).message) }));
    process.exitCode = 2;
}
