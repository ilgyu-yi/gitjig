export const nativeHistoryByteLimit=32*1024*1024;
/** One owned vocabulary for physical records and logical SDK projection. */
export const nativeRoleEntries = Object.freeze({ intent: 'gitjig.native-role-intent/v1', sdk: 'gitjig.native-role-sdk/v1',
    settlement: 'gitjig.native-role-settlement/v1', material: 'gitjig.native-role-material/v1', final: 'gitjig.native-role-final/v1',
    recovery: 'gitjig.native-role-recovery/v1', staging: 'gitjig.native-role-staging/v1', capture: 'gitjig.native-role-capture/v2' });
export interface NativeRecord { id:string; parentId?:string|null; type:string; customType?:string; data?:any; message?:any }
