import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { createHash } from 'node:crypto';
const select = (text: string, prefix: string, ids: string[]) => {
    const sections = text.split(/(?=^## )/m);
    for (const id of ids) {
        if (sections.filter(section => section.startsWith(`## ${prefix}${id}.`)).length !== 1)
            throw new Error(`Required owned workflow criteria section missing/duplicate: ${prefix}${id}`);
    }
    return sections.filter(section => ids.some(id => section.startsWith(`## ${prefix}${id}.`))).join('\n');
};
function criteriaFrom(texts: Record<string, string>) {
    const assets: Record<string, {
        sha256: string;
        selected: string;
    }> = {};
    for (const name of ['MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md']) {
        const text = texts[name]!;
        if (!text?.trim())
            throw new Error(`Required owned workflow criteria empty: ${name}`);
        const selected = name === 'DESIGN.md' ? select(text, 'D', ['2', '4', '5', '6', '7', '10']) : name === 'CONTRACTS.md' ? select(text, 'C', ['0', '1', '2', '3', '4', '8', '9', '10']) : text;
        if (!selected)
            throw new Error(`Required owned workflow criteria missing: ${name}`);
        assets[name] = { sha256: createHash('sha256').update(text).digest('hex'), selected };
    }
    const text = 'Product normative workflow criteria. These govern this product; the adopter is not required to author these files. Owner task requirements/rules remain separate authoritative inputs.\n' + Object.entries(assets).map(([name, a]) => `\n# ${name}\n${a.selected}`).join('\n');
    return { text, assets, hash: createHash('sha256').update(JSON.stringify(assets)).digest('hex') };
}
export async function loadCriteria() {
    const texts: Record<string, string> = {};
    for (const name of ['MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md'])
        texts[name] = await fs.readFile(new URL(`../../${name}`, import.meta.url), 'utf8');
    return criteriaFrom(texts);
}
export function loadCriteriaSync() {
    const texts: Record<string, string> = {};
    for (const name of ['MISSION.md', 'PRINCIPLES.md', 'DESIGN.md', 'CONTRACTS.md'])
        texts[name] = fsSync.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
    return criteriaFrom(texts);
}
