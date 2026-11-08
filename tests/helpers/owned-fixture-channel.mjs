/** An unresolved promise does not keep Node alive. The original parent owns this IPC lifetime. */
export function retainFixtureChannel() {
    if (!process.channel || !process.send) throw Error('Owned fixture IPC channel required');
    const receive = message => {
        if (message?.kind === 'fixture-liveness-probe') process.send({kind:'fixture-liveness-reply',nonce:message.nonce});
    };
    process.on('message', receive);
    process.once('disconnect', () => process.off('message', receive));
}
