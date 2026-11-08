import fs, { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { NativeGitNamespaceProof, NativeGitOwnerIdentity, NativeGitInitializedProof, NativeGitFileMetadata, NativeGitDirectoryMetadata, ObjectFormat } from './types.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keys = (v: unknown, fields: string[]) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === fields.sort().join();
const directoryFields = ['device','inode','ownerUid','mode'];
const fileFields = [...directoryFields,'nlink','size','mtimeMs','ctimeMs'];
const controlFields = [...fileFields,'sha256'];
export function nativeDirectoryMetadata(stat: Stats): NativeGitDirectoryMetadata {
    return { device: String(stat.dev), inode: String(stat.ino), ownerUid: stat.uid, mode: stat.mode };
}
function metadata(stat: Stats): NativeGitFileMetadata {
    return { ...nativeDirectoryMetadata(stat), nlink: stat.nlink, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
function directory(file: string, privateMode = true) {
    const stat = fs.lstatSync(file);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(file) !== file || stat.uid !== process.getuid?.() || stat.mode & (privateMode ? 0o077 : 0o022))
        throw Error('Original initialized directory unavailable');
    return nativeDirectoryMetadata(stat);
}
function empty(file: string) {
    const handle = fs.opendirSync(file);
    try { if (handle.readSync() !== null) throw Error('Original initialized support directory is not empty'); }
    finally { handle.closeSync(); }
}
/** Fixed small control files, same FD/hash/identity. Never a caller path reader. */
function control(file: string, max: number, privateMode: boolean, flush: boolean) {
    const named = fs.lstatSync(file);
    if (fs.realpathSync(file) !== file) throw Error('Initialized control path is not canonical');
    const fd = fs.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const initial = fs.fstatSync(fd);
        if (!initial.isFile() || initial.nlink !== 1 || initial.uid !== process.getuid?.() || initial.mode & (privateMode ? 0o077 : 0o022) || initial.size > max || !equal(metadata(named), metadata(initial)))
            throw Error('Original initialized control file unavailable');
        const buffer = Buffer.alloc(initial.size + 1); let count = 0;
        while (count < buffer.length) { const n = fs.readSync(fd, buffer, count, buffer.length - count, count); if (!n) break; count += n; }
        if (flush) fs.fsyncSync(fd);
        if (count !== initial.size || !equal(metadata(initial), metadata(fs.fstatSync(fd))) || !equal(metadata(initial), metadata(fs.lstatSync(file))))
            throw Error('Original initialized control file changed');
        return { bytes: buffer.subarray(0, count), proof: { ...metadata(initial), sha256: digest(buffer.subarray(0, count)) } };
    } finally { fs.closeSync(fd); }
}
function binary(file: string) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file || ![0,process.getuid?.()].includes(stat.uid) || stat.mode & 0o022 || !(stat.mode & 0o111))
        throw Error('Original initialized binary metadata unavailable');
    return metadata(stat);
}
function syncDirectory(file: string) {
    const fd = fs.openSync(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function assertInitializedProofShape(proof: NativeGitInitializedProof, expected: { clientRoot: string; gitBinary: string; objectFormat: ObjectFormat }): void {
    if (!keys(proof,['protocol','namespace','owner','repository','marker','config','attributes','binary','home','hooks']) || proof.protocol !== 'owned-native-git-initialized/v1' ||
        !keys(proof.namespace,['protocol','clientRoot','device','inode','ownerUid','runsDirectory','runsDevice','runsInode','runsOwnerUid','gitBinary']) ||
        !keys(proof.owner,['version','root','rootDevice','rootInode','repoDevice','repoInode','gitBinary','binaryDevice','binaryInode','objectFormat','metadataDate','configHash','attributesHash']) ||
        !keys(proof.repository,directoryFields) || !keys(proof.home,directoryFields) || !keys(proof.hooks,directoryFields) ||
        !keys(proof.marker,controlFields) || !keys(proof.config,controlFields) || !keys(proof.attributes,controlFields) || !keys(proof.binary,fileFields))
        throw Error('Original initialized proof shape unavailable');
    const n=proof.namespace,o=proof.owner;
    if (!path.isAbsolute(expected.clientRoot) || path.resolve(expected.clientRoot)!==expected.clientRoot || !path.isAbsolute(expected.gitBinary) ||
        n.protocol!=='owned-native-git-prebirth/v1' || n.clientRoot!==expected.clientRoot || n.runsDirectory!==path.join(expected.clientRoot,'runs') || n.gitBinary!==expected.gitBinary ||
        o.version!==1 || o.root!==n.clientRoot || o.rootDevice!==n.device || o.rootInode!==n.inode || o.gitBinary!==n.gitBinary || o.objectFormat!==expected.objectFormat ||
        !['sha1','sha256'].includes(o.objectFormat) || !Number.isFinite(Date.parse(o.metadataDate)) || new Date(o.metadataDate).toISOString()!==o.metadataDate ||
        o.repoDevice!==proof.repository.device || o.repoInode!==proof.repository.inode || o.binaryDevice!==proof.binary.device || o.binaryInode!==proof.binary.inode ||
        o.configHash!==proof.config.sha256 || o.attributesHash!==proof.attributes.sha256)
        throw Error('Original initialized proof/profile correspondence differs');
    for(const fact of [proof.repository,proof.marker,proof.config,proof.attributes,proof.binary,proof.home,proof.hooks]) {
        if(typeof fact.device!=='string'||!/^\d+$/u.test(fact.device)||typeof fact.inode!=='string'||!/^\d+$/u.test(fact.inode)||!Number.isSafeInteger(fact.ownerUid)||fact.ownerUid<0||!Number.isSafeInteger(fact.mode)||fact.mode<0)
            throw Error('Original initialized metadata malformed');

    }
    for(const fact of [proof.marker,proof.config,proof.attributes,proof.binary])
        if(!Number.isSafeInteger(fact.size)||fact.size<0||!Number.isSafeInteger(fact.nlink)||fact.nlink<1||!Number.isFinite(fact.mtimeMs)||!Number.isFinite(fact.ctimeMs))
            throw Error('Original initialized leaf metadata malformed');
    for(const fact of [proof.marker,proof.config,proof.attributes])
        if(typeof fact.sha256!=='string'||!/^[a-f0-9]{64}$/u.test(fact.sha256))throw Error('Original initialized control hash malformed');

}
/** No process, writes or repair. The caller binds expected root/profile to its actual original. */
export function assertInitializedNativeGitProof(proof: NativeGitInitializedProof, expected: { clientRoot: string; gitBinary: string; objectFormat: ObjectFormat }): void {
    assertInitializedProofShape(proof,expected);
    const root=expected.clientRoot,n=proof.namespace;
    const r=directory(root),runs=directory(path.join(root,'runs'));
    if(r.device!==n.device||r.inode!==n.inode||r.ownerUid!==n.ownerUid||runs.device!==n.runsDevice||runs.inode!==n.runsInode||runs.ownerUid!==n.runsOwnerUid||
        !equal(directory(path.join(root,'client.git'),false),proof.repository)||!equal(directory(path.join(root,'home')),proof.home)||!equal(directory(path.join(root,'no-hooks')),proof.hooks)||
        !equal(binary(expected.gitBinary),proof.binary))throw Error('Original initialized namespace changed');
    empty(path.join(root,'home'));empty(path.join(root,'no-hooks'));
    const marker=control(path.join(root,'native-owner.json'),16384,true,false),config=control(path.join(root,'client.git/config'),256*1024,false,false),attributes=control(path.join(root,'client.git/info/attributes'),1024,false,false);
    if(!equal(marker.proof,proof.marker)||!equal(config.proof,proof.config)||!equal(attributes.proof,proof.attributes)||!equal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(marker.bytes)),proof.owner))
        throw Error('Original initialized marker/control bytes changed');
}
/** Called only with the actual successful gated-fresh initialization's in-memory identity. */
export function captureInitializedNativeGitProof(namespace: NativeGitNamespaceProof, owner: NativeGitOwnerIdentity): NativeGitInitializedProof {
    const root=namespace.clientRoot;
    const marker=control(path.join(root,'native-owner.json'),16384,true,true),config=control(path.join(root,'client.git/config'),256*1024,false,true),attributes=control(path.join(root,'client.git/info/attributes'),1024,false,true);
    if(!equal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(marker.bytes)),owner))throw Error('Successful initialized marker differs from original factory identity');
    syncDirectory(path.join(root,'client.git/info'));
    syncDirectory(path.join(root,'client.git'));
    syncDirectory(root);
    const proof: NativeGitInitializedProof={protocol:'owned-native-git-initialized/v1',namespace:structuredClone(namespace),owner:structuredClone(owner),repository:directory(path.join(root,'client.git'),false),
        marker:marker.proof,config:config.proof,attributes:attributes.proof,binary:binary(namespace.gitBinary),home:directory(path.join(root,'home')),hooks:directory(path.join(root,'no-hooks'))};
    assertInitializedNativeGitProof(proof,{clientRoot:root,gitBinary:namespace.gitBinary,objectFormat:owner.objectFormat});
    return proof;
}
