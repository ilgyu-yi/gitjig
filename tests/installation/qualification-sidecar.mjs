/** Test-only sidecar materialization. Installed payloads stay immutable; all sidecar
 * product imports bind to the selected installed modules, never checkout dist. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const bindings = new Map();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function installedQualification(payload) {
    payload = fs.realpathSync(payload);
    if (bindings.has(payload)) return bindings.get(payload);
    for (const forbidden of ['dist/controller/testing.js','dist/controller/acceptance.js','.qualification']) {
        if (fs.existsSync(path.join(payload, forbidden))) throw Error('Qualification artifact shipped in product: '+forbidden);
    }
    const source = fileURLToPath(new URL('../../.qualification/', import.meta.url));
    const base = path.resolve('.runtime-fixtures'); fs.mkdirSync(base,{recursive:true});
    const root = fs.mkdtempSync(path.join(base,'installed-qualification-'));
    const files = [];
    for (const name of fs.readdirSync(source).filter(name=>name.endsWith('.js')).sort()) {
        const original = fs.readFileSync(path.join(source,name),'utf8');
        const bound = original.replace(/(['"])\.\.\/dist\/([^'"\n]+)\1/g, (_,quote,relative)=>quote+pathToFileURL(path.join(payload,'dist',relative)).href+quote);
        fs.writeFileSync(path.join(root,name),bound,{mode:0o600});
        files.push({name,sourceSha256:hash(original),boundSha256:hash(bound)});
    }
    const requested = pathToFileURL(path.join(payload,'.qualification')+path.sep).href;
    const destination = pathToFileURL(root+path.sep).href;
    const preload = path.join(root,'preload.mjs');
    fs.writeFileSync(preload,`import {registerHooks} from 'node:module';\nregisterHooks({resolve(specifier,context,next){let target;try{target=new URL(specifier,context.parentURL).href;}catch{}if(target?.startsWith(${JSON.stringify(requested)}))return next(${JSON.stringify(destination)}+target.slice(${requested.length}),context);return next(specifier,context);}});\n`,{mode:0o600});
    const record = {payload,root,files,scope:'External qualification code bound to immutable installed product; not a shipped product module'};
    fs.writeFileSync(path.join(root,'bindings.json'),JSON.stringify(record,null,2)+'\n');
    const result = {url:name=>pathToFileURL(path.join(root,name)).href,preload: pathToFileURL(preload).href,record};
    bindings.set(payload,result);return result;
}
export function installedQualificationModule(payload,name) { return installedQualification(payload).url(name); }
