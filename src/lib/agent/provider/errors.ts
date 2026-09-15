/** Extract only public error fields; never stringify a provider's request or credentials. */
export function providerErrorMessage(error: unknown): string {
  const messages: string[] = [];
  const codes: string[] = [];
  const seen = new Set<object>();
  function visit(value: unknown, depth = 0): void {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      if (value.trim() && value !== "[object Object]") messages.push(value.trim());
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const field of ["code", "type", "status", "statusCode"]) {
      if (typeof record[field] === "string" || typeof record[field] === "number") codes.push(String(record[field]));
    }
    visit(record.message, depth + 1);
    visit(record.error, depth + 1);
    visit(record.cause, depth + 1);
  }
  visit(error);
  const details = [...codes, ...messages].join(" ");
  // Quota errors also use HTTP 429, so distinguish them before rate limiting.
  if (/insufficient_quota|quota exceeded|余额不足|额度不足/i.test(details)) {
    return "模型服务额度不足，请检查钱包余额或联系支持。";
  }
  if (/rate.?limit|too many requests|\b429\b/i.test(details)) {
    return "模型服务当前请求过多，请稍后重试或切换模型。";
  }
  if (/timeout|timed? out|\b(?:408|504|524)\b/i.test(details)) {
    return "模型服务响应超时，请稍后重试或切换模型。";
  }
  if (/model_not_found|model.*(?:unavailable|not found|does not exist)|no available channel/i.test(details)) {
    return "当前模型暂不可用，请切换模型后重试。";
  }
  if (/invalid_api_key|invalid api key|authentication_error|\b401\b/i.test(details)) {
    return "模型服务认证失败，请联系支持检查工作区凭证。";
  }
  return messages[0]?.slice(0, 500) || "模型请求失败，请稍后重试或切换模型。";
}
