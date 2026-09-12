import { desc, eq, and } from "drizzle-orm";
import { requirePlatformDb } from "../src/lib/platform/db/client";
import { users, teamNewApiMapping, apiKeys } from "../src/lib/platform/db/schema";
import { decryptSecret } from "../src/lib/newapi/crypto";
async function main() {
  const db = requirePlatformDb();
  const base = process.env.NEW_API_URL!.replace(/\/+$/, "");
  async function get(path:string, token:string) {
    const response = await fetch(base+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
    if (!response.ok) return {status:response.status};
    return response.json();
  }
  const accounts = await db.select({id:users.id,org:users.currentOrganizationId}).from(users).orderBy(desc(users.createdAt)).limit(4);
  for (let index=0;index<accounts.length;index++) {
    const account=accounts[index];
    if(!account.org) continue;
    const [mapping]=await db.select().from(teamNewApiMapping).where(eq(teamNewApiMapping.organizationId,account.org));
    if(!mapping) continue;
    const pat=decryptSecret(mapping.newApiPatCiphertext);
    const self=await get('/api/user/self',pat);
    const groups=await get('/api/user/self/groups',pat);
    const auto=await get('/api/token/auto-groups',pat);
    const keys=await db.select().from(apiKeys).where(and(eq(apiKeys.organizationId,account.org),eq(apiKeys.status,'active')));
    console.log(JSON.stringify({recentAccount:index,group:self.data?.group,availableGroups:groups.data,autoGroups:auto.data}));
    for(const key of keys.slice(0,4)) {
      if(!key.newApiKeyCiphertext) continue;
      const catalog=await get('/v1/models',decryptSecret(key.newApiKeyCiphertext));
      console.log(JSON.stringify({recentAccount:index,studio:key.isStudioHidden,models:catalog.data?.map((m:any)=>m.id),status:catalog.status}));
    }
  }
  const admin=process.env.NEW_API_ADMIN_TOKEN!;
  const options=await get('/api/option/',admin);
  console.log(JSON.stringify({routingOptions:Array.isArray(options.data)?options.data.filter((x:any)=>/^(AutoGroups|UserUsableGroups|GroupRatio)$/.test(x.key)):null}));
  const channels=await get('/api/channel/?p=0&page_size=100',admin);
  console.log(JSON.stringify({claudeChannels:channels.data?.items?.filter((c:any)=>String(c.models).includes('claude')).map((c:any)=>({id:c.id,status:c.status,group:c.group,models:c.models}))}));
}
main().then(()=>process.exit(0)).catch(e=>{console.error({kind:e?.name,status:e?.status});process.exit(1)});
