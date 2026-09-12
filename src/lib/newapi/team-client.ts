export class NewApiTeamError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "NewApiTeamError";
  }
}

function baseUrl(): string {
  const configured = process.env.NEW_API_URL?.trim();
  if (!configured) throw new Error("NEW_API_URL is not configured.");
  return configured.replace(/\/+$/, "");
}

interface NewApiEnvelope<T> {
  success?: boolean;
  code?: boolean;
  message?: string;
  data?: T;
}

/**
 * Parse a new-api JSON envelope.
 * Success-only responses (no `data`) are allowed; callers that need a payload
 * must check for undefined (login / token create / revoke return success only).
 */
async function parseEnvelope<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  let payload: NewApiEnvelope<T>;
  try {
    payload = JSON.parse(text) as NewApiEnvelope<T>;
  } catch {
    throw new NewApiTeamError(`new-api returned non-JSON response (${response.status})`, response.status);
  }
  const ok = payload.success ?? payload.code ?? false;
  if (!response.ok || !ok) {
    throw new NewApiTeamError(payload.message || `new-api request failed (${response.status})`, response.status);
  }
  return payload.data;
}

function requireData<T>(data: T | undefined, status: number): T {
  if (data === undefined) throw new NewApiTeamError("new-api returned no data", status);
  return data;
}

/**
 * Logs in as the team's new-api user, then mints and returns a fresh PAT for it.
 *
 * Corrected against live production behavior (2026-08-11): `POST /api/user/login`
 * does NOT authenticate follow-up calls via its `Set-Cookie` (that cookie is scoped
 * to `/api/user/auth` — session refresh only, confirmed 401 when replayed as a
 * bearer-equivalent). The actual dashboard session credential is the JWT in the
 * login response body's `data.access_token`, sent as `Authorization: Bearer <jwt>`.
 * The PAT-mint endpoint is also `GET /api/user/token`, not `/api/user/self/token`
 * (router/api-router.go: `selfRoute := userRoute.Group("/")` has no "/self" prefix
 * of its own — individual routes spell out "self" only where their own path needs
 * it, e.g. `/self/groups`; `GenerateAccessToken` is registered at plain `/token`).
 */
export async function loginAndMintPat(username: string, password: string): Promise<string> {
  const loginResponse = await fetch(`${baseUrl()}/api/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const loginData = requireData(
    await parseEnvelope<{ access_token?: string }>(loginResponse),
    loginResponse.status,
  );
  if (!loginData.access_token) {
    throw new NewApiTeamError("new-api login did not return an access token", loginResponse.status);
  }

  const patResponse = await fetch(`${baseUrl()}/api/user/token`, {
    method: "GET",
    headers: { Authorization: `Bearer ${loginData.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return requireData(await parseEnvelope<string>(patResponse), patResponse.status);
}

function teamHeaders(pat: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${pat}` };
}

// `auto` is NewAPI's pseudo-group: it selects from the server's configured
// AutoGroups. A token remains model-agnostic while the relay owns routing.
// Deployments can override this if their relay has not enabled auto routing.
function defaultTokenGroup(): string {
  return process.env.NEW_API_TOKEN_GROUP?.trim() || "auto";
}

export type TeamTokenSettings = {
  expiredTime?: number;
  modelLimits?: string[];
  allowIps?: string[];
};

function tokenLimitFields(settings?: TeamTokenSettings) {
  const modelLimits = settings?.modelLimits ?? [];
  const allowIps = settings?.allowIps ?? [];
  return {
    expired_time: settings?.expiredTime ?? -1,
    model_limits_enabled: modelLimits.length > 0,
    model_limits: modelLimits.join(","),
    allow_ips: allowIps.join(","),
  };
}

export async function createTeamToken(
  pat: string,
  name: string,
  settings?: TeamTokenSettings,
): Promise<void> {
  const group = defaultTokenGroup();
  const response = await fetch(`${baseUrl()}/api/token/`, {
    method: "POST",
    headers: teamHeaders(pat),
    body: JSON.stringify({
      name,
      group,
      remain_quota: 0,
      unlimited_quota: true,
      cross_group_retry: group === "auto",
      ...tokenLimitFields(settings),
    }),
    cache: "no-store",
  });
  await parseEnvelope(response);
}

export type TeamTokenSnapshot = {
  id: number;
  name: string;
  group: string;
  remainQuota: number;
  unlimitedQuota: boolean;
  expiredTime: number;
  modelLimitsEnabled: boolean;
  modelLimits: string;
  allowIps: string;
  crossGroupRetry: boolean;
};

export async function fetchTeamToken(pat: string, tokenId: number): Promise<TeamTokenSnapshot> {
  const response = await fetch(`${baseUrl()}/api/token/${tokenId}`, {
    method: "GET",
    headers: teamHeaders(pat),
    cache: "no-store",
  });
  const data = requireData(
    await parseEnvelope<{
      id: number;
      name: string;
      group: string;
      remain_quota: number;
      unlimited_quota: boolean;
      expired_time: number;
      model_limits_enabled: boolean;
      model_limits: string;
      allow_ips: string | null;
      cross_group_retry?: boolean;
    }>(response),
    response.status,
  );
  return {
    id: data.id,
    name: data.name,
    group: data.group,
    remainQuota: data.remain_quota,
    unlimitedQuota: data.unlimited_quota,
    expiredTime: data.expired_time,
    modelLimitsEnabled: data.model_limits_enabled,
    modelLimits: data.model_limits,
    allowIps: data.allow_ips ?? "",
    crossGroupRetry: data.cross_group_retry ?? false,
  };
}

export async function updateTeamToken(
  pat: string,
  tokenId: number,
  settings: { name: string } & TeamTokenSettings,
): Promise<void> {
  const current = await fetchTeamToken(pat, tokenId);
  const response = await fetch(`${baseUrl()}/api/token/`, {
    method: "PUT",
    headers: teamHeaders(pat),
    body: JSON.stringify({
      id: tokenId,
      name: settings.name,
      group: current.group || defaultTokenGroup(),
      remain_quota: current.remainQuota,
      unlimited_quota: current.unlimitedQuota,
      cross_group_retry: current.crossGroupRetry,
      ...tokenLimitFields({
        expiredTime: settings.expiredTime ?? current.expiredTime,
        modelLimits: settings.modelLimits ?? current.modelLimits.split(",").filter(Boolean),
        allowIps: settings.allowIps ?? current.allowIps.split(",").filter(Boolean),
      }),
    }),
    cache: "no-store",
  });
  await parseEnvelope(response);
}

export async function findTeamTokenIdByName(pat: string, name: string): Promise<number | null> {
  const response = await fetch(`${baseUrl()}/api/token/search?keyword=${encodeURIComponent(name)}`, {
    method: "GET",
    headers: teamHeaders(pat),
    cache: "no-store",
  });
  const data = requireData(
    await parseEnvelope<{ items: { id: number; name: string }[] }>(response),
    response.status,
  );
  return data.items.find((item) => item.name === name)?.id ?? null;
}

export async function fetchTeamTokenKey(pat: string, tokenId: number): Promise<string> {
  const response = await fetch(`${baseUrl()}/api/token/${tokenId}/key`, {
    method: "POST",
    headers: teamHeaders(pat),
    cache: "no-store",
  });
  const data = requireData(await parseEnvelope<{ key: string }>(response), response.status);
  return `sk-${data.key}`;
}

export async function revokeTeamToken(pat: string, tokenId: number): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/token/${tokenId}`, {
    method: "DELETE",
    headers: teamHeaders(pat),
    cache: "no-store",
  });
  await parseEnvelope(response);
}

export type NewApiUserLog = {
  created_at?: number;
  type?: number;
  content?: string;
  token_name?: string;
  model_name?: string;
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  use_time?: number;
  is_stream?: boolean;
  request_id?: string;
};

export async function getUserLogs(
  pat: string,
  query: {
    page?: number;
    pageSize?: number;
    type?: number;
    modelName?: string;
    tokenName?: string;
    requestId?: string;
    startTimestamp?: number;
    endTimestamp?: number;
  } = {},
): Promise<{ page: number; pageSize: number; total: number; items: NewApiUserLog[] }> {
  const params = new URLSearchParams();
  params.set("p", String(query.page ?? 1));
  params.set("page_size", String(Math.min(Math.max(query.pageSize ?? 100, 1), 100)));
  if (query.type) params.set("type", String(query.type));
  if (query.modelName) params.set("model_name", query.modelName);
  if (query.tokenName) params.set("token_name", query.tokenName);
  if (query.requestId) params.set("request_id", query.requestId);
  if (query.startTimestamp) params.set("start_timestamp", String(query.startTimestamp));
  if (query.endTimestamp) params.set("end_timestamp", String(query.endTimestamp));
  const response = await fetch(`${baseUrl()}/api/log/self?${params}`, {
    method: "GET",
    headers: teamHeaders(pat),
    cache: "no-store",
  });
  const data = requireData(
    await parseEnvelope<{ page: number; page_size: number; total: number; items: NewApiUserLog[] }>(response),
    response.status,
  );
  return {
    page: data.page,
    pageSize: data.page_size,
    total: data.total,
    items: Array.isArray(data.items) ? data.items : [],
  };
}

export type NewApiQuotaDate = {
  model_name?: string;
  created_at?: number;
  count?: number;
  quota?: number;
  token_used?: number;
};

export async function getUserQuotaDates(
  pat: string,
  query: { startTimestamp: number; endTimestamp: number },
): Promise<NewApiQuotaDate[]> {
  const params = new URLSearchParams();
  params.set("start_timestamp", String(query.startTimestamp));
  params.set("end_timestamp", String(query.endTimestamp));
  const response = await fetch(`${baseUrl()}/api/data/self?${params}`, {
    method: "GET",
    headers: teamHeaders(pat),
    cache: "no-store",
  });
  const data = requireData(await parseEnvelope<NewApiQuotaDate[]>(response), response.status);
  return Array.isArray(data) ? data : [];
}

export type NewApiRedeemResult = {
  type: string;
  quota: number | null;
};

export async function redeemTeamCode(pat: string, key: string): Promise<NewApiRedeemResult> {
  const response = await fetch(`${baseUrl()}/api/user/topup`, {
    method: "POST",
    headers: teamHeaders(pat),
    body: JSON.stringify({ key }),
    cache: "no-store",
  });
  const data = await parseEnvelope<number | { type?: string; quota?: number }>(response);
  if (typeof data === "number") return { type: "quota", quota: data };
  if (data && typeof data === "object") {
    return {
      type: data.type ?? "quota",
      quota: typeof data.quota === "number" ? data.quota : null,
    };
  }
  return { type: "quota", quota: null };
}

export async function getTokenUsage(
  tokenSk: string,
): Promise<{ totalGranted: number; totalUsed: number; totalAvailable: number }> {
  const response = await fetch(`${baseUrl()}/api/usage/token/`, {
    method: "GET",
    headers: { Authorization: `Bearer ${tokenSk}` },
    cache: "no-store",
  });
  const data = requireData(
    await parseEnvelope<{ total_granted: number; total_used: number; total_available: number }>(response),
    response.status,
  );
  return {
    totalGranted: data.total_granted,
    totalUsed: data.total_used,
    totalAvailable: data.total_available,
  };
}
