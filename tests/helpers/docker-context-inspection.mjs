import fs from 'node:fs/promises';
import path from 'node:path';

/** Owned public context-inspect response, separate from the command under test. */
export async function dockerContextInspection(config, name = 'owned') {
    if (Array.isArray(name)) return (await Promise.all(name.map(value => dockerContextInspection(config, value)))).join('\n');
    const metadata = path.join(config, 'contexts/meta', name);
    const docker = {Host: 'unix:///owned-fixture.sock', SkipTLSVerify: false};
    await fs.mkdir(metadata, {recursive: true, mode: 0o700});
    try {
        await fs.writeFile(path.join(metadata, 'meta.json'), JSON.stringify({Name: name, Endpoints: {docker}}), {flag: 'wx', mode: 0o600});
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return dockerContextResponse(config, name);
}

/** Emit a future owned context without creating its not-yet-prepared directory. */
export function dockerContextResponse(config, name = 'owned') {
    const observed = {Name: name, Docker: {Host: 'unix:///owned-fixture.sock', SkipTLSVerify: false},
        Storage: {MetadataPath: path.join(config, 'contexts/meta', name), TLSPath: path.join(config, 'contexts/tls', name)}};
    return `if(args[2]==='context'&&args[3]==='inspect'&&args[6]===${JSON.stringify(name)}){
        if(args.length!==7||args[0]!=='--config'||args[1]!==${JSON.stringify(config)}||args[4]!=='--format'||args[6]!==${JSON.stringify(name)})throw Error('Unexpected context inspection');
        console.log(${JSON.stringify(JSON.stringify(observed))});process.exit(0);
    }`;
}
