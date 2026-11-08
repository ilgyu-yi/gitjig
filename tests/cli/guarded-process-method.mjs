import {promisify} from 'node:util';

/** Keep execFile's public Promise ABI while every call still crosses the guard. */
export function guardedProcessMethod(original, invoke) {
    function wrapped(...args) { return Reflect.apply(invoke, this, args); }
    if (typeof original[promisify.custom] === 'function') {
        Object.defineProperty(wrapped, promisify.custom, {value: function (...args) {
            let child;
            const receiver = this;
            const promise = new Promise((resolve, reject) => {
                child = Reflect.apply(wrapped, receiver, [...args, (error, stdout, stderr) => {
                    if (error) {
                        Object.assign(error, {stdout, stderr});
                        reject(error);
                    } else resolve({stdout, stderr});
                }]);
            });
            promise.child = child;
            return promise;
        }, configurable: true});
    }
    return wrapped;
}
