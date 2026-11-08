import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export async function heldInitializer(f,stage){
 const binary=path.join(f.root,'held-initializer-'+stage),marker=binary+'.entered',pids=binary+'.pids';
 await fs.writeFile(binary,'#!/bin/sh\nfor arg do\n if [ "$arg" = '+stage+' ]; then\n  '+quote(process.execPath)+' -e '+quote('setInterval(()=>{},1000)')+' &\n  child=$!\n  printf "%s %s\\n" "$$" "$child" > '+quote(pids)+'\n  printf entered > '+quote(marker)+'\n  wait\n  exit $?\n fi\ndone\nexec '+quote(f.git)+' "$@"\n',{mode:0o700});
 return {binary,marker,pids};
}
export async function assertGone(pids){
 const ids=/^([1-9][0-9]*) ([1-9][0-9]*)\n$/.exec(await fs.readFile(pids,'utf8'));assert.ok(ids);
 for(const pid of ids.slice(1))assert.throws(()=>process.kill(Number(pid),0),error=>error.code==='ESRCH');
 assert.throws(()=>process.kill(-Number(ids[1]),0),error=>error.code==='ESRCH');
}
