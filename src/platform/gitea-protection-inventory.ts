import { RepositoryReadError, type RepositoryResponse } from './repository-inspect-transport.js';
const fail = (message: string) => new RepositoryReadError(message);
export function giteaProtectionName(row: Record<string, unknown>): string {
    const name = row.rule_name ?? row.branch_name;
    if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 2048 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(name))
        throw fail('Native protection rule identity unavailable');
    return name;
}
/** Gitea repoListBranchProtection returns one complete, unpaginated array.
 * Do not apply GitLab's offset protocol or infer completeness from a short page.
 * The caller owns finite request/byte/item accounting and allowlisted projection.
 */
export async function readGiteaProtectionInventory(read: (route: string) => Promise<RepositoryResponse>, route: string, chargeItems: (count: number) => void) {
    const response = await read(route);
    if (response.status !== 200 || !Array.isArray(response.data))
        throw fail('Native protection inventory unavailable (HTTP ' + response.status + '); no empty inventory is inferred');
    chargeItems(response.data.length);
    // This endpoint has no continuation contract. Do not follow a link or treat a
    // paginated/contradictory response as the documented complete native array.
    const terminalPageCount = response.totalPages === null || response.totalPages === '1' || !response.data.length && response.totalPages === '0';
    if (response.link !== null || response.nextPage !== null && response.nextPage !== '' || response.page !== null && response.page !== '1' || !terminalPageCount)
        throw fail('Unexpected continuation on the unpaginated Gitea protection inventory; complete inventory unavailable');
    if (response.total !== null && (!/^\d+$/u.test(response.total) || !Number.isSafeInteger(Number(response.total)) || Number(response.total) !== response.data.length))
        throw fail('Gitea protection inventory differs from its declared total');
    const seen = new Set<string>();
    return response.data.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw fail('Native protection inventory row unavailable');
        const row = value as Record<string, unknown>, name = giteaProtectionName(row);
        if (seen.has(name))
            throw fail('Duplicate native protection inventory identity; complete inventory unavailable');
        seen.add(name);
        return row;
    });
}
