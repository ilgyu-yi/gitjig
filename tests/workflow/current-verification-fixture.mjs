/** Independent controlled producer encoding of the declared per-subject wire.
 * Invalid duplicate/overlapping canonical choices stay invalid, never overwrite. */
export function writeFixtureVerificationDomain(result, context) {
    if(context?.planningVerificationProfile?.version>=6)for(const key of ['plan','acceptedPlan']){
        const plan=result[key];
        if(plan&&typeof plan==='object'&&!Array.isArray(plan)&&Object.hasOwn(plan,'requirements')&&!Object.hasOwn(plan,'verificationRequirements')){
            const {requirements,...rest}=plan;result={...result,[key]:{...rest,verificationRequirements:requirements}};
        }
    }
    return result;
}

export function writeFixtureSubjectActions(result, context) {
    result = writeFixtureVerificationDomain(result, context);
    if (![1,2].includes(context?.subjectActionsInput?.version) || Object.hasOwn(result,'decisionActions') || Object.hasOwn(result,'ordinaryText')) return result;
    if (!Array.isArray(result.decisions) || !Array.isArray(context.subjectActionsView?.subjects)) return result;
    const subjects=context.subjectActionsView.subjects,keys=new Map(subjects.map(row=>[row.occurrenceId,row.key])),actions={};
    for (const [index,decision] of result.decisions.entries()) {
        const key=keys.get(decision.occurrenceId)??'invalid-'+index;
        if(Object.hasOwn(actions,key))return result;
        const {occurrenceId,...body}=decision;
        actions[key]={...body,...(Object.hasOwn(body,'equivalentTo')?{equivalentTo:keys.get(body.equivalentTo)??body.equivalentTo}:{})};
    }
    for(const id of result.retainedDispositions??[]) {
        const key=subjects.find(row=>row.retainDispositionId===id)?.key;
        if(!key||Object.hasOwn(actions,key))return result;
        actions[key]='retain';
    }
    const {decisions,retainedDispositions,...rest}=result;
    return {...rest,subjectActionsHash:context.subjectActionsView.responseHash,decisionActions:actions};
}

/** Controlled producer protocol only; never selects or manufactures host evidence. */
function readFixtureIdentityContext(context) {
    if (!context?.metadataIdentityInput || !context.metadataIdentityEncoding) return context;
    const {metadataIdentityEncoding: encoding,...decoded} = structuredClone(context);
    if (![1,2,3].includes(encoding.version) || encoding.version !== decoded.metadataIdentityInput.version || !Array.isArray(encoding.ids)) throw Error('Unknown controlled identity protocol');
    if(encoding.version===3 && (decoded.subjectActionsInput?.version!==1 || !['planning-adjudication','review-adjudication'].includes(decoded.stage)))throw Error('Unknown controlled subject protocol');
    const paths = [], add = (prefix,keys) => keys.forEach(key=>paths.push([...prefix,key]));
    add(['occurrences','*'],['id','output','work']);add(['occurrences','*','data'],['launchId']);
    add(['dispositions','*'],['id','occurrence','launch']);add(['dispositions','*','data'],['occurrenceId','equivalentTo']);
    add(['pendingObligations','*'],['id','occurrence']);
    add(['obligationStates','*'],['id','work']);add(['obligationStates','*','data'],['occurrence']);
    const scope = prefix => {
        add(prefix,['workId','launchId','runId','outputId']);
        add([...prefix,'inputVersions'],['contracts','requirements','base','candidate','plan','verification']);
        for(const key of ['occurrenceIds','findingBodyOmittedIds','findingBodySuppliedIds'])paths.push([...prefix,key,'*']);
        paths.push([...prefix,'selectedSources','*','version']);
    };
    scope(['plannerInputScope']);scope(['challengerInputScope']);
    const h=['historicalPlanningOperands'];
    add([...h,'links','*'],['occurrenceId','observationOutputId','producerOutputId','plannerOutputId']);
    add([...h,'producers','*'],['outputId','launchId','runId','nativeSessionId']);
    add([...h,'producers','*','inputVersions'],['contracts','requirements','base','candidate','plan','verification']);
    paths.push([...h,'producers','*','checkpoint','sessionId']);scope([...h,'producers','*','initialView']);
    paths.push([...h,'censusEncoding','occurrenceIds','*'],[...h,'censusEncoding','sourceSets','*','*','version']);
    if(encoding.version===2 || encoding.version===3 && decoded.stage==='review-adjudication'){
        add([],['ownerSource','baseVersion','candidateVersion','planVersion','verificationVersion']);paths.push(['requirementSourceIds','*']);
        for(const key of ['historicalPlansInput','dispositionHistoryInput','workflowCriteriaInput'])add([key],['id']);
        const manifest=p=>add(p,['id','workId','sha256','arraySha256']);manifest(['dispositionHistory']);manifest([...h,'planBodyEncoding','manifest']);
        add([...h,'links','*'],['planHash']);add([...h,'plans','*'],['planHash']);add([...h,'plans','*','record'],['id','sha256']);
        add([...h,'producers','*'],['outputRawSha256']);add([...h,'producers','*','checkpoint'],['sha256']);add([...h,'producers','*','initialView'],['textSha256']);
        add([...h,'producers','*','initialView','metadataIdentities'],['fieldFootprintSha256']);add([...h,'producers','*','materialSource'],['corroboratingOutputId']);
        add([...h,'producers','*','materialSource','source'],['nativeSessionId','rawSha256']);
        paths.push([...h,'censusEncoding','occurrenceIdDictionary','*'],[...h,'censusEncoding','sourceSets','*','*','sha256']);
        paths.push(['sourceInventory','completeManifestRefs','*']);for(const key of ['baseSample','candidateSample'])add(['sourceInventory',key,'*'],['sha256']);
        for(const key of ['checks','verificationEvidence']){const p=[key,'*'];add(p,['id','work','run','candidate','verification']);add([...p,'data'],['inputHash']);
            add([...p,'data','boundVersions'],['contracts','requirements','base','candidate','plan','verification']);add([...p,'data','target'],['versionId','digest','candidateAtDispatch']);
            add([...p,'data','caseResults'],['checkBinding','descriptorHash']);add([...p,'data','caseDescriptor'],['checkBinding']);
            for(const files of ['consumerFiles','fixtureFiles'])add([...p,'data','caseDescriptor',files,'*'],['sha256']);}
        add(['selectedReviewEvidence'],['binding']);const p=['selectedReviewEvidence','reviews','*'];add(p,['launchId','runId','outputId','rawSha256']);
        add([...p,'inputVersions'],['contracts','requirements','base','candidate','plan','verification']);add([...p,'native'],['sessionId']);add([...p,'native','checkpoint'],['sessionId','sha256']);
    }
    const apply = (parent,parts) => {
        if (!parent || !parts.length) return;
        const [key,...rest]=parts;
        if(key==='*'){if(Array.isArray(parent))parent.forEach((_,i)=>apply(parent,[i,...rest]));return;}
        if(!Object.hasOwn(parent,key))return;
        if(rest.length){apply(parent[key],rest);return;}
        const ref=parent[key];if(ref&&typeof ref==='object'&&Object.keys(ref).join(',')==='ref'){
            if(!Number.isSafeInteger(ref.ref)||typeof encoding.ids[ref.ref]!=='string')throw Error('Unknown controlled identity reference');
            parent[key]=encoding.ids[ref.ref];
        }
    };
    paths.forEach(parts=>apply(decoded,parts));return decoded;
}

/** Independent controlled-producer decoder. Raw wire stays separate in callers. */
function readFixtureFindingContext(context) {
    const identities = readFixtureIdentityContext(context);
    if (!identities?.findingBodyEncoding) return identities;
    const {findingBodyEncoding: encoding, ...decoded} = structuredClone(identities);
    if (![1,2,3,4].includes(encoding.version) || !Array.isArray(encoding.bodies)) throw Error('Unknown controlled body protocol');
    if (encoding.version===4 && (decoded.findingBodyInput?.version!==4 || !['planning','planning-challenge'].includes(decoded.stage))) throw Error('Unknown controlled planning body protocol');
    const expand = value => {
        if (![3,4].includes(encoding.version) || !value || typeof value !== 'object' || Object.keys(value).join(',') !== 'valueRef') return value;
        if (!Number.isSafeInteger(value.valueRef) || value.valueRef < 0 || value.valueRef >= encoding.values.length) throw Error('Unknown controlled value reference');
        return structuredClone(encoding.values[value.valueRef]);
    };
    decoded.occurrences = decoded.occurrences.map(row => {
        if (!Object.hasOwn(row.data, 'findingBodyIndex')) return row;
        const {findingBodyIndex} = row.data;
        if (!Number.isSafeInteger(findingBodyIndex) || !Object.hasOwn(encoding.bodies, findingBodyIndex)) throw Error('Unknown controlled body reference');
        const finding = structuredClone(encoding.bodies[findingBodyIndex]);
        if (finding && typeof finding === 'object' && !Array.isArray(finding)) {
            if (Object.hasOwn(finding,'mechanicalPatch')) finding.mechanicalPatch=expand(finding.mechanicalPatch);
            if (Array.isArray(finding.evidence)) finding.evidence=finding.evidence.map(expand);
            if (finding.reproduction && typeof finding.reproduction==='object' && !Array.isArray(finding.reproduction)) {
                if (Object.hasOwn(finding.reproduction,'command')) finding.reproduction.command=expand(finding.reproduction.command);
                if (Array.isArray(finding.reproduction.assertions)) finding.reproduction.assertions=finding.reproduction.assertions.map(expand);
            }
        }
        // Preserve the original data field order, including unknown metadata.
        return {...row,data:Object.fromEntries(Object.entries(row.data).map(([key,value])=>key==='findingBodyIndex'?['finding',finding]:[key,value]))};
    });
    return decoded;
}

/** Independent controlled decoding of the declared current planning views. */
function readFixturePlanningDomains(context) {
    if(![7,8,9,10,11,12].includes(context?.planningVerificationProfile?.version))return {context};
    const decoded=structuredClone(context),view=decoded.requirementsView;
    if(!view||!Object.hasOwn(view,'planVersion')||view.planVersion!==null&&typeof view.planVersion!=='string'||view.kind!==(view.planVersion===null?'task-request-and-constraints':'selected-plan-verification-requirements'))throw Error('Unknown controlled requirement view');
    const rename=(object,names)=>{
        if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(names).some(key=>!Object.hasOwn(object,key))||Object.values(names).some(key=>Object.hasOwn(object,key)))throw Error('Unknown controlled planning domain');
        return Object.fromEntries(Object.entries(object).map(([key,value])=>[names[key]??key,value]));
    };
    decoded.planningVerificationProfile.baseline=rename(decoded.planningVerificationProfile.baseline,{newObservationAllowed:'newObservation',crossPlanReuseAllowed:'crossPlanReuse',retainedDutyPresent:'priorDuty'});
    if(Object.hasOwn(decoded,'plannerPlanReference')){
        if(![8,9,10,11,12].includes(decoded.planningVerificationProfile.version)||decoded.stage!=='planning-challenge'||decoded.plannerPlanReference!==1||
            JSON.stringify(decoded.plannerOutput?.plan)!==JSON.stringify({$ref:'context.planProposal'}))throw Error('Unknown controlled planner plan reference');
        decoded.plannerOutput.plan=decoded.planProposal;
    }
    const paths=decoded.stage==='planning-challenge'?[['planProposal'],['plannerOutput','plan']]:decoded.stage==='planning-adjudication'?[['planProposal']]:[];
    for(const path of paths){const parent=path.length===1?decoded:decoded[path[0]],key=path.at(-1);if(parent&&Object.hasOwn(parent,key)&&parent[key]!==null)parent[key]=rename(parent[key],{verificationRequirements:'requirements'});}
    const diagnostics=decoded.currentProposalDiagnostics;
    if(diagnostics?.referenceDiagnostics){
        const ref=diagnostics.referenceDiagnostics;if(diagnostics.version!==2||diagnostics.kind!=='current-proposal-validation'||ref.version!==1||ref.pointerDomain!=='current-planning-view'||!Array.isArray(ref.problems))throw Error('Unknown controlled current diagnostic pointers');
        const pointer=value=>{if(typeof value!=='string'||value==='/requirements'||value.startsWith('/requirements/'))throw Error('Mixed controlled diagnostic pointer domain');return value==='/verificationRequirements'||value.startsWith('/verificationRequirements/')?'/requirements'+value.slice('/verificationRequirements'.length):value;};
        diagnostics.referenceDiagnostics={...ref,pointerDomain:'canonical-plan',problems:ref.problems.map(problem=>({...problem,pointer:pointer(problem.pointer),expectedPointer:pointer(problem.expectedPointer)}))};
    }
    delete decoded.requirementsView;return {context:decoded,view};
}

/** Independent finite decoder; current requests and unknown positions stay literal. */
export function readFixtureMetadataContext(context) {
    const domain = readFixturePlanningDomains(context), decoded = readFixtureFindingContext(domain.context);
    if(domain.view&&decoded.planVersion!==domain.view.planVersion)throw Error('Controlled selected requirement view changed');
    if (!decoded?.historicalPlanningOperands?.requirementsEncoding) return decoded;
    const restored = structuredClone(decoded), history = restored.historicalPlanningOperands, encoding = history.requirementsEncoding;
    if (restored.historicalRequirementsInput?.version !== 1 || encoding.version !== 1 || !Array.isArray(encoding.values)) throw Error('Unknown controlled historical requirements');
    delete history.requirementsEncoding;
    for (const plan of history.plans) {
        const value=plan?.inlinePlan?.requirements;
        if (!value || typeof value!=='object' || Array.isArray(value) || !Object.hasOwn(value,'requirementsRef')) continue;
        if (Object.keys(value).join(',')!=='requirementsRef' || !Number.isSafeInteger(value.requirementsRef) || value.requirementsRef<0 || !Array.isArray(encoding.values[value.requirementsRef])) throw Error('Unknown controlled requirement reference');
        plan.inlinePlan.requirements=structuredClone(encoding.values[value.requirementsRef]);
    }
    return restored;
}

export function applyCurrentVerificationFixture(result, context) {
    if (context?.planningVerificationProfile?.supported === true && result.plan?.verification &&
        Array.isArray(result.plan.requirements) && Array.isArray(result.plan.verification.checks) &&
        !Object.hasOwn(result.plan.verification, 'strategies')) {
        result.plan.verification.strategies = result.plan.requirements.map(requirement => ({
            requirementId: requirement.id,
            kind: 'consumer-cases',
            checkIds: result.plan.verification.checks.filter(check => check.guaranteeIds.includes(requirement.id)).map(check => check.id),
        }));
    }
    if (Array.isArray(context?.verificationReviewRequirements) &&
        !Object.hasOwn(result, 'verificationDecisions')) {
        result.verificationDecisions = context.verificationReviewRequirements.map(requirement => ({
            requirementId: requirement.requirementId,
            strategyDigest: requirement.strategyDigest,
            witnessIds: [...requirement.witnessIds],
            verdict: 'satisfied',
            reason: 'Controlled fixture assessment of the exact supplied host-selected verification witnesses; not semantic qualification.',
        }));
    }
    return result;
}

/** Serialize controlled claims for the role's declared response carrier. */
export function fixtureRoleText(result, context) {
    const json = JSON.stringify(writeFixtureSubjectActions(applyCurrentVerificationFixture(result, context), context));
    return (context?.reviewResolutionInput?.version ?? 0) >= 2 ? '```json\n' + json + '\n```' : json;
}
