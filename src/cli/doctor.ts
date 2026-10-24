import { isCompatibleNode, requiredNodeRange } from '../app/runtime-requirements.js';
import { spawnSync } from 'node:child_process';
export async function diagnose(context?: string): Promise<{
    exitCode: number;
    report: unknown;
}> {
    let sqliteAvailable = false;
    let piSdkFactoryAvailable = false;
    try {
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(':memory:');
        try {
            sqliteAvailable = db.prepare('SELECT 1 AS value').get()?.value === 1;
        }
        finally {
            db.close();
        }
    }
    catch { /* A missing prerequisite remains unavailable. */ }
    try {
        const { createAgentSession } = await import('@earendil-works/pi-coding-agent');
        piSdkFactoryAvailable = typeof createAgentSession === 'function';
    }
    catch { /* Diagnosis must report a missing SDK without enabling anything. */ }
    const engine = context ? spawnSync('docker', ['--context', context, 'version', '--format', '{{json .Server.Version}}'], {
        encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, shell: false,
    }) : undefined;
    let engineVersion: string | undefined;
    if (engine?.status === 0) {
        try {
            const value: unknown = JSON.parse(engine.stdout);
            if (typeof value === 'string' && value.trim())
                engineVersion = value;
        }
        catch { /* Malformed output is unavailable. */ }
    }
    const expectedNode = requiredNodeRange;
    const nodeCompatible = isCompatibleNode();
    const applicationReady = nodeCompatible && sqliteAvailable && piSdkFactoryAvailable;
    const projectExecutionReady = applicationReady && engineVersion !== undefined;
    const prerequisitesReady = applicationReady && (!context || projectExecutionReady);
    return { exitCode: prerequisitesReady ? 0 : 2, report: {
            schemaVersion: 1, scope: 'Read-only prerequisites; not runtime restriction or product maturity acceptance',
            node: { expected: expectedNode, observed: process.version, compatible: nodeCompatible }, sqliteApiAvailable: sqliteAvailable, piSdkFactoryAvailable,
            engine: { context: context ?? null, version: engineVersion ?? null, available: engineVersion !== undefined,
                probe: context ? { client: 'docker', resolution: 'PATH', configuration: 'ambient Docker configuration and environment', selectedRuntimeProfileChecked: false } : null,
            }, applicationReady, projectExecutionReady, prerequisitesReady,
            agentExecution: 'Requires a restricted scope and applicable endpoint prerequisites; diagnosis grants no execution',
            nextAction: !nodeCompatible ? `Use Node ${expectedNode}, then rerun this prerequisite diagnosis.`
                : !sqliteAvailable || !piSdkFactoryAvailable ? 'Restore compatible Node/package dependencies and rerun this prerequisite diagnosis.'
                    : !context ? 'Application prerequisites are ready. For project execution, select an explicit Docker context and runtime image.'
                        : engineVersion === undefined ? 'Select a Docker-compatible engine and supply its explicit context.'
                            : 'Use an explicit project and runtime profile; this diagnosis does not certify workflow eligibility.',
        } };
}
