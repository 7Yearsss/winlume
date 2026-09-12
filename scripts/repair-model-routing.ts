/** Repairs only locally managed native Reizo keys, using each workspace's own PAT. */
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { requirePlatformDb } from "../src/lib/platform/db/client";
import { apiKeys, teamNewApiMapping } from "../src/lib/platform/db/schema";
import { decryptSecret } from "../src/lib/newapi/crypto";
import { updateTeamToken, createTeamToken, findTeamTokenIdByName, fetchTeamTokenKey, revokeTeamToken } from "../src/lib/newapi/team-client";
async function main() {
  const db=requirePlatformDb();
  const base=process.env.NEW_API_URL!.replace(/\/+$/,"");
  const keys=await db.select().from(apiKeys).where(eq(apiKeys.status,"active"));
  const folder=`/var/lib/reizo/operations/routing-${Date.now()}`;
  mkdirSync(folder,{recursive:true,mode:0o700});
  let repaired=0,claudeVisible=0,skipped=0;
  let verifiedCreation=false;
  async function models(key:string) {
    const response=await fetch(base+'/v1/models',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok || !Array.isArray(data.data)) throw new Error('Model verification failed');
    return data.data.map((m:{id:string})=>m.id) as string[];
  }
  for(const key of keys) {
    if(!key.organizationId || !key.newApiTokenId || !key.newApiKeyCiphertext || key.metadata?.imported || (key.expiresAt && key.expiresAt.getTime()<=Date.now())) {skipped++;continue;}
    const [mapping]=await db.select().from(teamNewApiMapping).where(eq(teamNewApiMapping.organizationId,key.organizationId));
    if(!mapping) throw new Error('Missing workspace mapping');
    const pat=decryptSecret(mapping.newApiPatCiphertext);
    const response=await fetch(`${base}/api/token/${key.newApiTokenId}`,{headers:{Authorization:`Bearer ${pat}`},signal:AbortSignal.timeout(15000)});
    const original=await response.json();
    if(!response.ok || !original.success) throw new Error('Cannot read original routing');
    const before=original.data;
    if(before.status!==1 || (before.expired_time>0 && before.expired_time*1000<=Date.now())) {skipped++;continue;}
    // Snapshot only routing and restrictions; never persist raw key material.
    const fields=['id','name','group','auto_groups','cross_group_retry','remain_quota','unlimited_quota','expired_time','model_limits_enabled','model_limits','allow_ips'];
    writeFileSync(`${folder}/${key.id}.json`,JSON.stringify(Object.fromEntries(fields.map(f=>[f,before[f]]))),{mode:0o600});
    try {
      await updateTeamToken(pat,key.newApiTokenId,{name:before.name,allAvailableGroups:true});
    } catch (error: any) {
      // The gateway rejects some independently granted legacy groups before
      // writing. Preserve those keys rather than narrowing their existing route.
      if (error?.status === 400 && /Auto 分组 .*不可用或无权访问/.test(error.message)) {
        skipped++;
        console.log(JSON.stringify({legacyGrantedRoutingPreserved:true}));
        continue;
      }
      throw error;
    }
    const visible=await models(decryptSecret(key.newApiKeyCiphertext));
    const afterResponse=await fetch(`${base}/api/token/${key.newApiTokenId}`,{headers:{Authorization:`Bearer ${pat}`},signal:AbortSignal.timeout(15000)});
    const after=await afterResponse.json();
    if(!afterResponse.ok || !after.success) throw new Error('Cannot verify token restrictions');
    for(const field of ['status','unlimited_quota','expired_time','model_limits_enabled','allow_ips']) {
      if(after.data[field]!==before[field]) throw new Error('Token restriction changed unexpectedly');
    }
    if(before.model_limits_enabled && before.model_limits!==after.data.model_limits) throw new Error('Model restriction changed');
    repaired++;
    if(visible.includes('claude-sonnet-5')) claudeVisible++;
    if(!verifiedCreation && visible.includes('claude-sonnet-5')) {
      const name=`routing-check-${Date.now()}`;
      try {
        await createTeamToken(pat,name,{allAvailableGroups:true});
        const id=await findTeamTokenIdByName(pat,name);
        if(!id) throw new Error('Verification key missing');
        const available=await models(await fetchTeamTokenKey(pat,id));
        if(!available.includes('claude-sonnet-5') || !available.some(m=>m.startsWith('gpt-'))) throw new Error('New key lacks expected models');
        verifiedCreation=true;
        console.log(JSON.stringify({newKeyHasClaudeAndGpt:true,modelCount:available.length}));
      } finally {
        const id=await findTeamTokenIdByName(pat,name);
        if(id) await revokeTeamToken(pat,id);
      }
    }
  }
  console.log(JSON.stringify({repaired,claudeVisible,skipped,verifiedCreation,globalRoutingUnchanged:true}));
  if(!verifiedCreation || !claudeVisible) throw new Error('Claude routing not verified');
}
main().then(()=>process.exit(0)).catch(e=>{console.error({kind:e?.name,status:e?.status,message:e?.message});process.exit(1)});
