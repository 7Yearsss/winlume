import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({admin:vi.fn(),content:vi.fn(),read:vi.fn(),update:vi.fn()}));
vi.mock("@/lib/platform/admin",()=>({requirePlatformAdmin:mocks.admin,PlatformAdminError:class extends Error {constructor(message:string,public status:number){super(message)}}}));
vi.mock("@/lib/portal/content-config",()=>({getPortalContent:mocks.content}));
vi.mock("@/lib/newapi/admin-client",()=>({updateNewApiModelPricing:mocks.update}));
vi.mock("@/lib/newapi/pricing",async()=>({...await vi.importActual("@/lib/newapi/pricing"),readNewApiPricing:mocks.read}));
import { GET, PUT } from "./route";
import { pricingRevision } from "@/lib/newapi/pricing";
import { PlatformAdminError } from "@/lib/platform/admin";
const model = {model_name:"deepseek-v4-flash",quota_type:0,model_ratio:.5,completion_ratio:4,model_price:0,enable_groups:["domestic"]};
const catalog = {models:[model],groups:{domestic:.3},quotaPerUnit:500000};
function request(patch={}) {return new Request("https://app.test/api/admin/model-pricing",{method:"PUT",body:JSON.stringify({name:model.model_name,mode:"tokens",input:2,output:6,revision:pricingRevision(model),...patch})})}
describe("model pricing administration",()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.admin.mockResolvedValue({platformRole:"admin"});mocks.content.mockResolvedValue({modelVendors:[{models:[{name:model.model_name}]}]});mocks.read.mockResolvedValue(catalog);mocks.update.mockResolvedValue(undefined)});
  it("requires an admin before reading or updating billing",async()=>{
    mocks.admin.mockRejectedValue(new PlatformAdminError("Denied",403));
    expect((await GET()).status).toBe(403);expect((await PUT(request())).status).toBe(403);expect(mocks.read).not.toHaveBeenCalled();expect(mocks.update).not.toHaveBeenCalled();
  });
  it("exposes managed rates and revisions without credentials",async()=>{
    const body=await(await GET()).json();expect(body.models[0]).toMatchObject({name:model.model_name,input:1,output:4,revision:pricingRevision(model)});
  });
  it("updates actual billing and verifies the persisted values",async()=>{
    mocks.read.mockResolvedValueOnce(catalog).mockResolvedValueOnce({...catalog,models:[{...model,model_ratio:1,completion_ratio:3}]});
    expect((await PUT(request())).status).toBe(200);expect(mocks.update).toHaveBeenCalledWith(model.model_name,{quota_type:0,model_ratio:1,completion_ratio:3});
  });
  it("rejects stale rates, unmanaged names and invalid prices without a write",async()=>{
    expect((await PUT(request({revision:"old"}))).status).toBe(409);
    expect((await PUT(request({name:"other"}))).status).toBe(400);
    expect((await PUT(request({input:-1}))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not report success when the actual rate fails to update",async()=>{
    expect((await PUT(request())).status).toBe(502);
  });
});
