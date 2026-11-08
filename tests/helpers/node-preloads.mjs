/** Forward only trusted test-runner Node preloads to a separately started UI.
 * Test/debug flags stay with the runner. This never reads provider query arguments.
 */
export function nodePreloads() {
    const result=[];
    for(let index=0;index<process.execArgv.length;index++) {
        const value=process.execArgv[index];
        if(value==='--import')result.push(value,process.execArgv[++index]);
        else if(value.startsWith('--import='))result.push(value);
    }
    return result;
}
