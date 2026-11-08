import fs from 'node:fs/promises';

export async function replacePathAfterReview(root,arm,changed,file,target) {
 for await (const _event of fs.watch(root,{signal:AbortSignal.timeout(13000)})) {
  if (!await fs.stat(arm).then(()=>true,()=>false)) continue;
  const next=file+'.next';
  await fs.symlink(target,next);
  await fs.rename(next,file);
  await fs.writeFile(changed,'changed');
  return;
 }
}
