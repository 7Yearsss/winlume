import { describe, expect, it } from "vitest";
import { providerErrorMessage } from "./errors";

describe("providerErrorMessage", () => {
  it("extracts wrapped errors and Error instances", () => {
    expect(providerErrorMessage({ error: { message: "Specific upstream failure" } })).toBe("Specific upstream failure");
    expect(providerErrorMessage(new Error("Network disconnected"))).toBe("Network disconnected");
  });
  it("distinguishes quota from rate limits for status 429", () => {
    expect(providerErrorMessage({ statusCode: 429, error: { code: "insufficient_quota" } })).toContain("额度不足");
    expect(providerErrorMessage({ statusCode: 429 })).toContain("请求过多");
  });
  it("handles unknown and cyclic objects without leaking request details", () => {
    const error: Record<string, unknown> = { requestBody: "PRIVATE PROMPT", headers: { Authorization: "SECRET" } };
    error.cause = error;
    expect(providerErrorMessage(error)).toBe("模型请求失败，请稍后重试或切换模型。");
    expect(providerErrorMessage(null)).toBe("模型请求失败，请稍后重试或切换模型。");
  });
});
