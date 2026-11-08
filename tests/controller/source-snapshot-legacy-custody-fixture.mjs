import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {SourceBranchPreviews} from '../../dist/controller/source-branch-previews.js';
import {writeSourceProposalArtifact} from '../../dist/controller/source-proposal-artifact.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Controlled pre-initialized-proof host producer over actual current standing/native ownership.
 * This reconstructs the exact retained v1 recipe/body protocol, not an old installed binary.
 * It deliberately does not call the new initializedProof getter or claim action authority.
 */
export async function retainLegacySourceCustody(c,home,workId,original){
 const snapshot=await c.changeCore.captureSourceSaveInput(workId),proposalId=randomUUID(),basis=original.basis,profile=original.profile,route=original.target.environment;
 const destinationRef='refs/heads/legacy-captured-snapshot',proposedDeltaPaths=original.proposedDeltaPaths;
 const inputDigest=hash({proposalId,snapshot,basis,profile,route,destinationRef,proposedDeltaPaths,publicationConsent:'unconfirmed'}),registry=new SourceBranchPreviews(c.store,home);
 const validate=()=>c.changeCore.assertSourceSaveInput(snapshot);
 const result=await c.sourcePreviews.run({workId,sourceId:snapshot.sourceId,epoch:snapshot.evidence.epoch,generation:snapshot.evidence.generation,inputDigest,profile:{...profile,objectFormat:basis.objectFormat},validate},async tools=>{
  const target=await tools.observeSourceBranchTarget({targetId:'source-proposal',path:snapshot.projectRoot,destinationRef},route);await tools.fetchSourceBasis(target,basis.commit);
  const projected=await tools.projectSourceSnapshot({base:snapshot.base,candidate:snapshot.candidate,basisCommit:basis.commit,authorizedDeltaPaths:proposedDeltaPaths});
  if(projected.kind!=='projected'||projected.receipt.relation.kind!=='identical')throw Error('Legacy controlled producer requires actual identity result');
  const row=registry.inspect(projected.receipt.previewId),body={protocol:'source-snapshot-proposal/v1',proposalId,publicationConsent:'unconfirmed',input:snapshot,basis,target,profile,proposedDeltaPaths,admissionSourceId:row.admission_source,rootSourceId:row.root_source,projection:projected.receipt};
  return{body,artifact:await writeSourceProposalArtifact(home,body,validate)};
 });
 validate();const row=registry.inspect(result.previewId),{body,artifact}=result.value;
 const header={protocol:body.protocol,proposalId,status:'prepared',publicationConsent:'unconfirmed',workId,sourceId:snapshot.sourceId,scopeDigest:snapshot.scopeDigest,evidenceFingerprint:snapshot.evidence.fingerprint,previewId:row.id,admissionSourceId:row.admission_source,rootSourceId:row.root_source,terminalSourceId:row.terminal_source,operationId:body.projection.operationId,previewDigest:hash(row),artifact,destinationRef};
 c.store.tx(()=>{validate();c.store.run('INSERT INTO change_versions VALUES(?,?,?,?,?,?,?)',proposalId,workId,'source-snapshot-proposal',snapshot.candidate.versionId,path.join(home,'artifacts/source-snapshot-proposals',artifact.hash+'.json'),artifact.hash,JSON.stringify(header));});
 return{proposalId,body,header};
}
