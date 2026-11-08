import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
const roots = ['/work', '/input', '/scratch'];
const inside = (p, r) => p === r || p.startsWith(r + '/');
let bytes = 0; const chunks = [];
try {
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 24 * 1024 * 1024) throw new Error('request exceeds limit');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const target = path.resolve(request.path);
  const writable = ['write', 'mkdir'].includes(request.op) || request.mode === 'read-write';
  if (!roots.some(r => inside(target, r)) || (writable && inside(target, '/input'))) throw new Error('path outside declared access');
  let existing = target;
  while (true) {
    try { existing = await fs.realpath(existing); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; const parent = path.dirname(existing); if (parent === existing) throw e; existing = parent; }
  }
  if (!roots.some(r => inside(existing, r)) || (writable && inside(existing, '/input'))) throw new Error('effective path outside declared access');
  let result = {ok:true};
  switch (request.op) {
    case 'read': {
      if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1 || request.maxBytes > 16 * 1024 * 1024) throw new Error('invalid read limit');
      const handle = await fs.open(target, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > request.maxBytes) throw new Error('file unsupported or exceeds read limit');
        const data = Buffer.alloc(request.maxBytes + 1);
        let length = 0;
        while (length < data.length) { const got = await handle.read(data, length, data.length-length, null); if (!got.bytesRead) break; length += got.bytesRead; }
        if (length > request.maxBytes) throw new Error('file exceeds read limit');
        result.data = data.subarray(0,length).toString('base64');
      } finally { await handle.close(); }
      break;
    }
    case 'write': await fs.writeFile(target, Buffer.from(request.data, 'base64')); break;
    case 'mkdir': await fs.mkdir(target, {recursive:true}); break;
    case 'access': await fs.access(target, request.mode === 'read-write' ? 6 : 4); break;
    default: throw new Error('unsupported operation');
  }
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ok:false,error:String(error.message),code:error.code ?? 'IO_ERROR'}));
  process.exitCode=1;
}
