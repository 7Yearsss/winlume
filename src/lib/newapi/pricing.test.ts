import { describe, expect, it } from "vitest";
import { applyActualPricing, pricingUpdate } from "./pricing";
import { modelPriceLines } from "@/lib/catalog/plaza-display";

const model = { model_name: "deepseek-v4-flash", quota_type: 0, model_ratio: .5, completion_ratio: 4, model_price: 0, enable_groups: ["domestic"] };
describe("actual billing prices", () => {
  it("converts input/output USD amounts into the billing engine's ratios", () => {
    expect(pricingUpdate({ mode:"tokens", input:1, output:4 },500000)).toEqual({quota_type:0,model_ratio:.5,completion_ratio:4});
    expect(pricingUpdate({ mode:"fixed", price:.08 },500000)).toEqual({quota_type:1,model_price:.08});
    expect(()=>pricingUpdate({mode:"tokens",input:0,output:4},500000)).toThrow();
    for(const price of [-1,Infinity,NaN,"",null]) expect(()=>pricingUpdate({mode:"fixed",price},500000)).toThrow();
  });
  it("uses actual group pricing, currency and zero prices instead of defaults", () => {
    const catalog = {models:[model],groups:{domestic:.3},quotaPerUnit:500000};
    const result = applyActualPricing([model],catalog)[0];
    expect(modelPriceLines(result)).toEqual({kind:"ratio",input:"输入：$0.300 /1M tokens",output:"输出：$1.20 /1M tokens"});
    expect(modelPriceLines({...result,group_ratio:0})).toEqual({kind:"ratio",input:"输入：$0 /1M tokens",output:"输出：$0 /1M tokens"});
    expect(modelPriceLines({...result,quota_type:1,model_price:1})).toEqual({kind:"fixed",text:"价格：$0.300 /次"});
    expect(applyActualPricing([{...model,model_name:"unknown"}],catalog)[0].pricing_unavailable).toBe(true);
  });
});
