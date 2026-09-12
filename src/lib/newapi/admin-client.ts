export class NewApiAdminError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "NewApiAdminError";
  }
}

function baseUrl(): string {
  const configured = process.env.NEW_API_URL?.trim();
  if (!configured) throw new Error("NEW_API_URL is not configured.");
  return configured.replace(/\/+$/, "");
}

function adminHeaders(): Record<string, string> {
  const token = process.env.NEW_API_ADMIN_TOKEN?.trim();
  if (!token) throw new Error("NEW_API_ADMIN_TOKEN is not configured.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

interface NewApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

async function adminRequest<T>(path: string, init: RequestInit): Promise<T | undefined> {
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers: adminHeaders(), cache: "no-store" });
  const text = await response.text();
  let payload: NewApiEnvelope<T>;
  try {
    payload = JSON.parse(text) as NewApiEnvelope<T>;
  } catch {
    throw new NewApiAdminError(`new-api returned non-JSON response (${response.status})`, response.status);
  }
  if (!response.ok || !payload.success) {
    throw new NewApiAdminError(payload.message || `new-api admin request failed (${response.status})`, response.status);
  }
  return payload.data;
}

export async function updateNewApiModelPricing(model: string, pricing: { quota_type: number; model_ratio?: number; completion_ratio?: number; model_price?: number }): Promise<void> {
  await adminRequest(`/api/pricing/admin/models/${model.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PATCH", body: JSON.stringify(pricing), signal: AbortSignal.timeout(15_000),
  });
}

export async function createNewApiUser(input: {
  username: string;
  password: string;
  displayName: string;
}): Promise<void> {
  await adminRequest("/api/user/", {
    method: "POST",
    body: JSON.stringify({
      username: input.username,
      password: input.password,
      display_name: input.displayName,
      role: 1,
    }),
  });
}

export async function findNewApiUserIdByUsername(username: string): Promise<number | null> {
  const data = await adminRequest<{ items: { id: number; username: string }[] }>(
    `/api/user/search?keyword=${encodeURIComponent(username)}`,
    { method: "GET" },
  );
  const match = data?.items.find((item) => item.username === username);
  return match?.id ?? null;
}

export async function disableNewApiUser(newApiUserId: number): Promise<void> {
  await adminRequest("/api/user/manage", {
    method: "POST",
    body: JSON.stringify({ id: newApiUserId, action: "disable" }),
  });
}

export async function addNewApiUserQuota(newApiUserId: number, amount: number): Promise<void> {
  await adminRequest("/api/user/manage", {
    method: "POST",
    body: JSON.stringify({ id: newApiUserId, action: "add_quota", mode: "add", value: amount }),
  });
}

export async function getNewApiUserQuota(newApiUserId: number): Promise<{ quota: number; usedQuota: number }> {
  const data = await adminRequest<{ quota: number; used_quota: number }>(`/api/user/${newApiUserId}`, {
    method: "GET",
  });
  if (!data) throw new NewApiAdminError("new-api returned no user data", 502);
  return { quota: data.quota, usedQuota: data.used_quota };
}
