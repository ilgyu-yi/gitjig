/** Fixed reviewed synthetic acceptance bytes; no project/file input. */
import { createHash } from 'node:crypto';
export const acceptanceSyntheticVersion = "014-exact-three-v1";
export const acceptanceSyntheticFiles = Object.freeze({ "README.md": "# Synthetic acceptance fixture\n\nNo real project data. No workflows, hooks or submodules.\n", "consumer.json": "{\"value\":2}\n", "check.mjs": "import { readFileSync } from 'node:fs';\nconst actual = JSON.parse(readFileSync(new URL('./consumer.json', import.meta.url), 'utf8')).value;\nconst descriptor = JSON.parse(readFileSync('/input/verification-cases.json', 'utf8'));\nconst cases = descriptor.cases.map(c => ({ id: c.id, inputDigest: c.inputDigest, observed: { kind: actual === Number(c.declaration.input.literalUtf8) ? 'return' : 'rejection', value: String(actual) } }));\nconsole.log(JSON.stringify({ version: 1, cases, assertions: [{ id: 'required-value', passed: actual === 3, actual: String(actual) }] }));\n" });
const hashes = { "README.md": "8b6b0026b82f4dfef0e030e68871843e4e16d2e6a9d78278e68be2789a0b2c5c", "consumer.json": "6e0d9d0268c35e8b9c620e4f529378b20d9e71af3a03cd57ad43c1f74a9ebc40", "check.mjs": "49b9c73c86a25e1dd268a1645f5d65d097f1efdd5c9644a4351031cd1db3111e" };
export function assertAcceptanceSynthetic(): void { for (const [name, bytes] of Object.entries(acceptanceSyntheticFiles))
    if (createHash("sha256").update(bytes).digest("hex") !== hashes[name as keyof typeof hashes])
        throw Error("Fixed acceptance assets differ"); }
export const acceptancePeerReadmeSuffix = "\nSynthetic controlled race peer.\n";
