import { RepositoryReadError, type RepositoryResponse } from './repository-inspect-transport.js';
const fail = (message: string) => new RepositoryReadError(message);
/** Validate continuation without ever forwarding credentials to a server-supplied endpoint. */
export function validateContinuation(response: RepositoryResponse, current: URL) {
    const page = Number(current.searchParams.get('page'));
    let next: number | null = null, last: number | null = null;
    if (response.page !== null && response.page !== String(page))
        throw fail('Native pagination changed page identity');
    if (response.nextPage !== null && response.nextPage !== '') {
        if (response.nextPage !== String(page + 1))
            throw fail('Native next-page header did not advance exactly once');
        next = page + 1;
    }
    if (response.totalPages !== null) {
        if (!/^\d+$/u.test(response.totalPages) || !Number.isSafeInteger(Number(response.totalPages)))
            throw fail('Invalid native page total');
        last = Number(response.totalPages);
    }
    const relations = new Set<string>();
    if (response.link !== null) {
        if (!response.link.trim())
            throw fail('Empty native pagination header');
        for (const part of response.link.split(',')) {
            const match = /^\s*<([^<>\s]+)>;\s*rel="(next|prev|first|last)"\s*$/u.exec(part);
            if (!match || relations.has(match[2]!))
                throw fail('Ambiguous or unsupported native pagination header');
            relations.add(match[2]!);
            let url: URL;
            try {
                url = new URL(match[1]!);
            }
            catch {
                throw fail('Invalid native pagination URL');
            }
            const keys = [...url.searchParams.keys()];
            if (url.origin !== current.origin || url.pathname !== current.pathname || url.username || url.password || url.hash || new Set(keys).size !== keys.length || keys.length !== [...current.searchParams.keys()].length || keys.some(k => !current.searchParams.has(k) || k !== 'page' && url.searchParams.get(k) !== current.searchParams.get(k)))
                throw fail('Native pagination changed endpoint or query scope');
            const target = url.searchParams.get('page');
            if (!target || !/^[1-9]\d*$/u.test(target) || !Number.isSafeInteger(Number(target)))
                throw fail('Invalid native pagination page');
            const number = Number(target);
            if (match[2] === 'next') {
                if (number !== page + 1 || response.nextPage === '')
                    throw fail('Conflicting native continuation');
                next = number;
            }
            if (match[2] === 'last') {
                if (last !== null && last !== number)
                    throw fail('Conflicting native last page');
                last = number;
            }
            if (match[2] === 'first' && number !== 1 || match[2] === 'prev' && number !== page - 1)
                throw fail('Contradictory native page relation');
        }
    }
    if (last !== null && (next !== null && last < next || response.nextPage === '' && last > page || response.data instanceof Array && response.data.length > 0 && last < page))
        throw fail('Contradictory native page total');
    return { next, last };
}
/** Native GitLab offset collection, sharing the caller's complete-operation budget. */
export async function readGitLabCollection(get: (route: string) => Promise<RepositoryResponse>, base: URL, path: string, key: (row: Record<string, unknown>) => string, chargeItems: (count: number) => void) {
    const result: Record<string, unknown>[] = [], seen = new Set<string>();
    let total: string | null = null;
    for (let page = 1;; page++) {
        const url = new URL(base.href + path);
        url.searchParams.set('per_page', '100');
        url.searchParams.set('page', String(page));
        const response = await get(url.pathname.slice(base.pathname.length) + url.search);
        if (response.status !== 200 || !Array.isArray(response.data))
            throw fail('Native collection unavailable (HTTP ' + response.status + '); no empty inventory is inferred');
        chargeItems(response.data.length);
        const next = validateContinuation(response, url);
        if (response.total !== null) {
            if (!/^\d+$/u.test(response.total) || !Number.isSafeInteger(Number(response.total)) || total !== null && total !== response.total)
                throw fail('Native collection total changed or is invalid');
            total = response.total;
        }
        for (const value of response.data) {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                throw fail('Native collection row unavailable');
            const row = value as Record<string, unknown>, id = key(row);
            if (seen.has(id))
                throw fail('Duplicate native collection identity or ignored pagination; complete inventory unavailable');
            seen.add(id);
            result.push(row);
        }
        if (!response.data.length) {
            if (next.next !== null || next.last !== null && next.last > page || total !== null && Number(total) !== result.length)
                throw fail('Native collection ended with contradictory continuation or total');
            return result;
        }
        if (total !== null && result.length > Number(total))
            throw fail('Native collection exceeds its declared total');
    }
}
