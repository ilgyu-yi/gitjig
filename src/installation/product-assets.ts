import type { Asset } from './tree.js';
/** Qualification is external tooling, not an installed product capability.
 * Reject stale compiler output as well as accidentally copied sidecars. */
export function assertProductAssets(assets: readonly Asset[]): void {
    const forbidden = /^(?:(?:\.qualification|qualification)(?:\/|$)|controller\/(?:testing|acceptance)\.|platform\/github-acceptance\.|effects\/acceptance-synthetic\.)/;
    for (const asset of assets)
        if (forbidden.test(asset.path))
            throw Error('Qualification artifact is not a product asset: ' + asset.path);
}
