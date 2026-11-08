/** CLI startup only, before any controller/session exists. Never call per view.
 * Embedding hosts own their process environment and must make this same explicit
 * choice before constructing sessions; a Pi preference cannot override this env. */
export function initializeApplicationEnvironment(): void {
    delete process.env.PI_TELEMETRY;
    delete process.env.PI_PACKAGE_DIR;
}
