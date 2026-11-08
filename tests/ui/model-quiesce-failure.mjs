// Owned fault injection: a goal interruption record fails, while all UI/account cleanup must run.
import fs from 'node:fs/promises';
import {Goals} from '../../dist/controller/goals.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
const quiesce=Goals.prototype.quiesce,close=ApplicationAccounts.prototype.close;
Goals.prototype.quiesce=function(){
 const store=this.h.store,run=store.run.bind(store);run("UPDATE goals SET state='ACTIVE' WHERE id=?",process.env.GITJIG_TEST_QUIESCE_GOAL);
 store.run=(sql,...args)=>{if(sql.startsWith('UPDATE goals SET'))throw Error('CONTROLLED_GOAL_INTERRUPTION_WRITE');return run(sql,...args);};
 return quiesce.call(this);
};
ApplicationAccounts.prototype.close=async function(){try{return await close.call(this);}finally{await fs.writeFile(process.env.GITJIG_TEST_ACCOUNT_CLOSED,'closed');}};
