/** Explicit synthetic retained records; no model, engine or accepted plan evidence. */
export function seedPlanningFailure(c,workId,role='planner',launch='failed-planner') {
 const s=c.store,row=s.one('SELECT * FROM change_state WHERE work=?',workId),data=JSON.parse(row.data),work=s.one('SELECT * FROM works WHERE id=?',workId);
 const stage={planner:'planning',challenger:'planning-challenge',adjudicator:'planning-adjudication'}[role];
 if(!stage)throw Error('Unsupported fixture planning role');
 const run=launch+'-run',output=launch+'-output',issues=['Error: Role deadline exceeded'];
 const inputVersions={contracts:data.contractsVersion,requirements:data.requirementVersion??null,base:row.base,candidate:row.candidate,plan:row.plan,verification:row.verification};
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,workId,work.epoch,work.generation,'SETTLED','not-read','consumed',JSON.stringify({kind:'governed-role',launchId:launch,cleanup:'removed'}));
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,workId,run,role,work.epoch,'UNUSABLE',role==='planner'?'none':'consumed',JSON.stringify({stage,inputVersions,cleanup:'removed'}));
 s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',output,launch,null,'unusable',JSON.stringify({issues,terminal:'aborted',protocol:null}));
 s.run('INSERT INTO obligations VALUES(?,?,?)','diagnostic-'+launch,workId,JSON.stringify({kind:'diagnostic',launchId:launch,output,state:'pending',issues}));
 s.run("UPDATE budgets SET consumed=consumed+1 WHERE lineage=? AND kind='execution'",work.lineage);
 if(role!=='planner')s.run("UPDATE budgets SET consumed=consumed+1 WHERE lineage=? AND kind='resolution'",work.lineage);
 s.run('UPDATE change_state SET phase=?,data=? WHERE work=?','BLOCKED',JSON.stringify({...data,resumeStage:'plan',blocked:['ControllerError: '+issues.join('; ')],nextAction:'Explicit same-W run/resume with corrected verification cases or targeted owner clarification'}),workId);
 return {workId,launch,run,output};
}

/** Synthetic owned quota metadata; actual SDK capture is tested by adapter-native-format. */
export function seedPlanningQuota(c,workId,role='planner') {
 const f=seedPlanningFailure(c,workId,role),s=c.store,issues=['PROVIDER:Original account limit rejection'];
 const providerFailure={version:1,kind:'usage-limit',ownerSessionId:'owner-session',nativeSessionId:'native-session',queryId:'original-query',intentEntryId:'intent-entry',eventEntryId:'quota-entry',eventId:'quota-event',window:'seven_day',resetsAt:1794020400};
 s.run("UPDATE role_outputs SET data=json_set(data,'$.issues',json(?),'$.terminal','error','$.providerFailure',json(?)) WHERE id=?",JSON.stringify(issues),JSON.stringify(providerFailure),f.output);
 s.run("UPDATE obligations SET data=json_set(data,'$.issues',json(?)) WHERE id=?",JSON.stringify(issues),'diagnostic-'+f.launch);
 s.run("UPDATE change_state SET data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify(['ControllerError: '+issues.join('; ')]),workId);
 s.run("UPDATE role_launches SET data=json_set(data,'$.nativeSessionId',?) WHERE id=?",providerFailure.ownerSessionId,f.launch);
 s.run("UPDATE runs SET data=json_set(data,'$.nativeCheckpoint',json(?)) WHERE id=?",JSON.stringify({sha256:'a'.repeat(64),leafId:'checkpoint'}),f.run);
 return {...f,providerFailure};
}

/** Normal nonplanning stage projection only; no actual accepted plan or native dispatch. */
export const normalQuotaStages=[
 ['implementer','implementation','implement','implementChange'],
 ['repairer','substantive-repair','repair','repairChange'],
 ['reviewer','fresh-review','review','reviewChange'],
 ['adjudicator','review-adjudication','resolve','resolveChange'],
 ['confirmer','exact-nit-confirmation','confirm','confirmNit / affected fresh review'],
];
export function seedNormalQuota(c,workId,role='implementer') {
 const tuple=normalQuotaStages.find(row=>row[0]===role);if(!tuple)throw Error('Unsupported normal quota role');
 const f=seedPlanningQuota(c,workId),s=c.store,[,stage,resume,nextAction]=tuple;
 s.run("UPDATE role_launches SET role=?,data=json_set(data,'$.stage',?) WHERE id=?",role,stage,f.launch);
 s.run("UPDATE change_state SET data=json_set(data,'$.resumeStage',?,'$.nextAction',?) WHERE work=?",resume,nextAction,workId);
 return {...f,role,stage,resume,nextAction};
}
