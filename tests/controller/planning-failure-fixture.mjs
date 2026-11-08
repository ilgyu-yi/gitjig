/** Explicit synthetic retained records; no model, engine or accepted plan evidence. */
export function seedPlanningFailure(c,workId,role='planner',launch='failed-planner', {
 issues=['Error: Role deadline exceeded'], terminal='aborted', nativeSessionId, checkpointSession=nativeSessionId,
} = {}) {
 const s=c.store,row=s.one('SELECT * FROM change_state WHERE work=?',workId),data=JSON.parse(row.data),work=s.one('SELECT * FROM works WHERE id=?',workId);
 const stage={planner:'planning',challenger:'planning-challenge',adjudicator:'planning-adjudication'}[role];
 if(!stage)throw Error('Unsupported fixture planning role');
 const run=launch+'-run',output=launch+'-output';
 const inputVersions={contracts:data.contractsVersion,requirements:data.requirementVersion??null,base:row.base,candidate:row.candidate,plan:row.plan,verification:row.verification};
 s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)',run,workId,work.epoch,work.generation,'SETTLED','not-read','consumed',JSON.stringify({kind:'governed-role',launchId:launch,cleanup:'removed',
  ...(checkpointSession ? {nativeCheckpoint:{sessionId:checkpointSession,sha256:'a'.repeat(64)}} : {})}));
 s.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,workId,run,role,work.epoch,'UNUSABLE',role==='planner'?'none':'consumed',JSON.stringify({stage,inputVersions,cleanup:'removed',nativeSessionId}));
 s.run('INSERT INTO role_outputs VALUES(?,?,?,?,?)',output,launch,null,'unusable',JSON.stringify({issues,terminal,protocol:null}));
 s.run('INSERT INTO obligations VALUES(?,?,?)','diagnostic-'+launch,workId,JSON.stringify({kind:'diagnostic',launchId:launch,output,state:'pending',issues}));
 s.run("UPDATE budgets SET consumed=consumed+1 WHERE lineage=? AND kind='execution'",work.lineage);
 if(role!=='planner')s.run("UPDATE budgets SET consumed=consumed+1 WHERE lineage=? AND kind='resolution'",work.lineage);
 s.run('UPDATE change_state SET phase=?,data=? WHERE work=?','BLOCKED',JSON.stringify({...data,resumeStage:'plan',blocked:['ControllerError: '+issues.join('; ')],nextAction:'Explicit same-W run/resume with corrected verification cases or targeted owner clarification'}),workId);
 return {workId,launch,run,output};
}

export function seedPlanningToolMismatch(c, workId) {
 return seedPlanningFailure(c, workId, 'adjudicator', 'failed-tool-verification', {
  terminal:'error', nativeSessionId:'original-native-session', issues:['PROVIDER:BRIDGE_HOST_TOOL_INVOCATION_MISMATCH'],
 });
}

/** Synthetic owned quota metadata; actual SDK capture is tested by adapter-native-format. */
export function seedPlanningQuota(c,workId,role='planner',launch) {
 const f=seedPlanningFailure(c,workId,role,launch),s=c.store,issues=['PROVIDER:Original account limit rejection'];
 const providerFailure={version:1,kind:'usage-limit',ownerSessionId:'owner-session',nativeSessionId:'native-session',queryId:'original-query',intentEntryId:'intent-entry',eventEntryId:'quota-entry',eventId:'quota-event',window:'seven_day',resetsAt:1794020400};
 s.run("UPDATE role_outputs SET data=json_set(data,'$.issues',json(?),'$.terminal','error','$.providerFailure',json(?)) WHERE id=?",JSON.stringify(issues),JSON.stringify(providerFailure),f.output);
 s.run("UPDATE obligations SET data=json_set(data,'$.issues',json(?)) WHERE id=?",JSON.stringify(issues),'diagnostic-'+f.launch);
 s.run("UPDATE change_state SET data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify(['ControllerError: '+issues.join('; ')]),workId);
 s.run("UPDATE role_launches SET data=json_set(data,'$.nativeSessionId',?) WHERE id=?",providerFailure.ownerSessionId,f.launch);
 s.run("UPDATE runs SET data=json_set(data,'$.nativeCheckpoint',json(?)) WHERE id=?",JSON.stringify({sha256:'a'.repeat(64),leafId:'checkpoint'}),f.run);
 return {...f,providerFailure};
}

export function seedEarlierFindings(c,workId) {
 const {output}=seedPlanningFailure(c,workId,'challenger','earlier-challenger');
 for (const [index,state] of ['pending','pending','resolved'].entries()) {
  const id='earlier-finding-'+index;
  c.store.run('INSERT INTO finding_occurrences VALUES(?,?,?,?,?)',id,output,index,workId,
   JSON.stringify({requirementId:'owner-request',severity:'blocking',repair:'substantive',description:'Earlier judgment '+index,evidence:['Controlled fixture']}));
  c.store.run('INSERT INTO obligations VALUES(?,?,?)',id,workId,JSON.stringify({kind:'finding',occurrence:id,state}));
 }
 c.store.run('INSERT INTO obligations VALUES(?,?,?)','unbound-finding',workId,
  JSON.stringify({kind:'finding',occurrence:'unbound-finding',state:'pending'}));
}

export function seedLocalRoleRequestLimit(c,workId,role='challenger') {
 const f=seedPlanningFailure(c,workId,role),s=c.store;
 const requestLimit={version:1,kind:'role-request-limit',used:16,limit:16};
 const issues=['PROVIDER:HOST_CONTEXT_GUARD:Error: Provider request cap exceeded:16'];
 s.run("UPDATE role_launches SET data=json_set(data,'$.bounds.maxProviderRequests',16) WHERE id=?",f.launch);
 s.run("UPDATE role_outputs SET data=json_set(data,'$.issues',json(?),'$.requestLimit',json(?),'$.terminal','error','$.providerRequests',16) WHERE id=?",JSON.stringify(issues),JSON.stringify(requestLimit),f.output);
 s.run("UPDATE obligations SET data=json_set(data,'$.issues',json(?)) WHERE id=?",JSON.stringify(issues),'diagnostic-'+f.launch);
 s.run("UPDATE change_state SET data=json_set(data,'$.blocked',json(?)) WHERE work=?",JSON.stringify(['ControllerError: '+issues.join('; ')]),workId);
 return {...f,requestLimit};
}

/** Normal nonplanning stage projection only; no actual accepted plan or native dispatch. */
export const normalQuotaStages=[
 ['implementer','implementation','implement','implementChange'],
 ['repairer','substantive-repair','repair','repairChange'],
 ['reviewer','fresh-review','review','reviewChange'],
 ['reviewer','consumer-control-proposal','review','reviewChange'],
 ['adjudicator','review-adjudication','resolve','resolveChange'],
 ['confirmer','exact-nit-confirmation','confirm','confirmNit / affected fresh review'],
];
export function seedNormalQuota(c,workId,role='implementer',launch,stageName) {
 const tuple=normalQuotaStages.find(row=>row[0]===role && (!stageName || row[1]===stageName));if(!tuple)throw Error('Unsupported normal quota role and stage');
 const f=seedPlanningQuota(c,workId,'planner',launch),s=c.store,[,stage,resume,nextAction]=tuple;
 s.run("UPDATE role_launches SET role=?,data=json_set(data,'$.stage',?) WHERE id=?",role,stage,f.launch);
 s.run("UPDATE change_state SET data=json_set(data,'$.resumeStage',?,'$.nextAction',?) WHERE work=?",resume,nextAction,workId);
 return {...f,role,stage,resume,nextAction};
}
