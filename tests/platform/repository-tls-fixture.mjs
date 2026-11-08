import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export async function repositoryTlsFixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'gitjig-repository-tls-'))),key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem'),configuration=path.join(root,'openssl.cnf');
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(configuration,'[req]\ndistinguished_name=dn\n[dn]\n[v3]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n',{mode:0o600});
 await promisify(execFile)('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=owned-repository-fixture','-config',configuration,'-extensions','v3'],{timeout:10000,maxBuffer:16384});
 return {root,cert,tls:{key:await fs.readFile(key),cert:await fs.readFile(cert)}};
}
