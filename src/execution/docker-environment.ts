// The built-in default context derives its endpoint and TLS from these variables.
const dockerDefaultEndpointVariables = ['DOCKER_HOST', 'DOCKER_CERT_PATH', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY'];
export function dockerDefaultRouteInheritsEndpoint(context: string, env: NodeJS.ProcessEnv = process.env): boolean {
    return context === 'default' && dockerDefaultEndpointVariables.some(key => !!env[key]);
}
/** The explicit --context (and --config) select the route; ambient Docker/Node overrides must not redirect it. */
export function dockerEnvironment(args: readonly string[], env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    // Unlike runtime/setup.mjs, keep the owner's DOCKER_CONFIG without --config: it locates the named context store.
    // Docker's built-in `default` context is itself defined by the ambient endpoint/TLS variables.
    // Only the leading route (dockerRoute + --context) selects the client; container/command payload arguments never do.
    const route = args.slice(0, args[0] === '--config' ? 4 : 2), result = { ...env }, explicitConfig = route[0] === '--config', context = route[route.indexOf('--context') + 1];
    const keep = (key: string) => !explicitConfig && key === 'DOCKER_CONFIG' || context === 'default' && dockerDefaultEndpointVariables.includes(key);
    for (const key of Object.keys(result))
        if (/^(DOCKER_|BUILDX_|BUILDKIT_|COLIMA_|LIMA_)/u.test(key) && !keep(key))
            delete result[key];
    delete result.NODE_OPTIONS;
    delete result.NODE_PATH;
    return result;
}
export function assertDockerPreparationRoute(context: string | undefined): void {
    if (context !== undefined && dockerDefaultRouteInheritsEndpoint(context))
        throw Error('The default Docker context inherits endpoint or TLS settings. Choose a named Docker context so preparation matches project execution.');
}
