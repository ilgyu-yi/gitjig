import net from 'node:net';
globalThis.fetch = async () => { throw Error('No fetch in account UI fixture'); };
net.Socket.prototype.connect = function () { throw Error('No socket in account UI fixture'); };
