// @ts-check
/** Compatibility is separate from the exact runtime identity of an offline bundle. */
export const requiredNodeRange = '>=22.19.0';
export function isCompatibleNode(version = process.versions.node) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) return false;
    const major = Number(match[1]), minor = Number(match[2]);
    return major > 22 || (major === 22 && minor >= 19);
}
export function assertCompatibleNode() {
    if (!isCompatibleNode()) throw new Error(`Node ${requiredNodeRange} is required; found ${process.version}. Use a current compatible Node release.`);
}
