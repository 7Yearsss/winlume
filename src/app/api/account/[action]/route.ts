import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthContext } from "@/lib/auth/session";
import { getAuthMode, hashPassword, passwordWouldBeTruncatedByBcrypt, verifyPassword } from "@/lib/platform/auth";
import {
  getPlatformDb,
  getPlatformRepositories,
} from "@/lib/platform";
import { provisionPlatformUser } from "@/lib/platform/provision";
import {
  IdentifierAuthError,
  completePasswordReset,
  identifyAccount,
  resendSignupCode,
  startPasswordReset,
  startSignup,
  verifySignup,
} from "@/lib/platform/identifier-auth";
import { consumeRateLimit } from "@/lib/platform/rate-limit";

// The response depends on the Auth.js session cookie and must never be
// statically rendered or reused between visitors.
export const dynamic = "force-dynamic";

function legacyGatewayUrl(): string | undefined {
  const configured = process.env.NEW_API_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : undefined;
}

function jsonBody(response: Response, body: string) {
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

async function register(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.json({ success: false, message: "Method not allowed" }, { status: 405 });
  }
  if (getAuthMode() !== "legacy") {
    try {
      const body = await request.json() as Record<string, unknown>;
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const displayName = typeof body.display_name === "string" ? body.display_name.trim() : username;
      if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
        return NextResponse.json({ success: false, message: "用户名需为 3 至 64 位，仅可使用小写字母、数字、点、下划线或连字符。" }, { status: 400 });
      }
      if (password.length < 8 || password.length > 128 || passwordWouldBeTruncatedByBcrypt(password)) {
        return NextResponse.json({ success: false, message: "密码需为 8 至 72 个 UTF-8 字节。" }, { status: 400 });
      }
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) {
        return NextResponse.json({ success: false, message: "请输入有效的邮箱地址。" }, { status: 400 });
      }
      if (!displayName || displayName.length > 120) {
        return NextResponse.json({ success: false, message: "显示名称需为 1 至 120 个字符。" }, { status: 400 });
      }
      const database = getPlatformDb();
      if (!database) {
        return NextResponse.json({ success: false, message: "平台数据库尚未配置。" }, { status: 503 });
      }
      const passwordHash = await hashPassword(password);
      const user = await provisionPlatformUser(database, {
        username,
        email,
        displayName,
        passwordHash,
      });
      return NextResponse.json({ success: true, data: { id: user.id, username: user.username } }, { status: 201 });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
      if (code === "23505") {
        return NextResponse.json({ success: false, message: "用户名或邮箱已被使用。" }, { status: 409 });
      }
      console.error("Reizo account registration failed", error);
      return NextResponse.json({ success: false, message: "注册未完成，请稍后重试。" }, { status: 500 });
    }
  }
  const gatewayUrl = legacyGatewayUrl();
  if (!gatewayUrl) {
    return NextResponse.json({ success: false, message: "旧账户网关未配置。" }, { status: 503 });
  }
  try {
    const upstream = await fetch(`${gatewayUrl}/api/user/register`, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
    return jsonBody(upstream, await upstream.text());
  } catch {
    return NextResponse.json({ success: false, message: "账户网关暂时不可访问，请稍后重试。" }, { status: 502 });
  }
}

function clientKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

function identifierAuthFailed(error: unknown) {
  if (error instanceof IdentifierAuthError) {
    return NextResponse.json(
      { success: false, message: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("Reizo identifier auth failed", error);
  return NextResponse.json({ success: false, message: "请求未完成，请稍后重试。" }, { status: 500 });
}

function requireIdentifierRepos() {
  const repositories = getPlatformRepositories();
  if (!repositories) {
    throw new IdentifierAuthError("平台数据库尚未配置。", 503, "database_missing");
  }
  return repositories;
}

async function identify(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.json({ success: false, message: "Method not allowed" }, { status: 405 });
  }
  if (!consumeRateLimit(`identify:${clientKey(request)}`, 20, 60_000)) {
    return NextResponse.json({ success: false, message: "尝试过于频繁，请稍后再试。" }, { status: 429 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const identifier = typeof body.identifier === "string" ? body.identifier : "";
    const result = await identifyAccount(identifier, requireIdentifierRepos().users);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return identifierAuthFailed(error);
  }
}

async function signup(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.json({ success: false, message: "Method not allowed" }, { status: 405 });
  }
  if (!consumeRateLimit(`signup:${clientKey(request)}`, 8, 60_000)) {
    return NextResponse.json({ success: false, message: "尝试过于频繁，请稍后再试。" }, { status: 429 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const repositories = requireIdentifierRepos();
    const result = await startSignup({
      email: typeof body.email === "string" ? body.email : "",
      username: typeof body.username === "string" ? body.username : "",
      password: typeof body.password === "string" ? body.password : "",
      users: repositories.users,
      challenges: repositories.challenges,
      database: getPlatformDb(),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return identifierAuthFailed(error);
  }
}

async function signupVerify(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.json({ success: false, message: "Method not allowed" }, { status: 405 });
  }
  if (!consumeRateLimit(`signup-verify:${clientKey(request)}`, 12, 60_000)) {
    return NextResponse.json({ success: false, message: "尝试过于频繁，请稍后再试。" }, { status: 429 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const repositories = requireIdentifierRepos();
    const result = await verifySignup({
      email: typeof body.email === "string" ? body.email : "",
      code: typeof body.code === "string" ? body.code : "",
      users: repositories.users,
      challenges: repositories.challenges,
      database: getPlatformDb(),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return identifierAuthFailed(error);
  }
}

async function signupResend(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.json({ success: false, message: "Method not allowed" }, { status: 405 });
  }
  if (!consumeRateLimit(`signup-resend:${clientKey(request)}`, 6, 60_000)) {
    return NextResponse.json({ success: false, message: "尝试过于频繁，请稍后再试。" }, { status: 429 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const repositories = requireIdentifierRepos();
    const result = await resendSignupCode({
      email: typeof body.email === "string" ? body.email : "",
      challenges: repositories.challenges,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return identifierAuthFailed(error);
  }
}

async function recover(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.json({ success: false, message: "Method not allowed" }, { status: 405 });
  }
  if (!consumeRateLimit(`recover:${clientKey(request)}`, 6, 60_000)) {
    return NextResponse.json({ success: false, message: "尝试过于频繁，请稍后再试。" }, { status: 429 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const repositories = requireIdentifierRepos();
    const result = await startPasswordReset({
      identifier: typeof body.identifier === "string" ? body.identifier : "",
      users: repositories.users,
      challenges: repositories.challenges,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return identifierAuthFailed(error);
  }
}

async function recoverComplete(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.json({ success: false, message: "Method not allowed" }, { status: 405 });
  }
  if (!consumeRateLimit(`recover-complete:${clientKey(request)}`, 8, 60_000)) {
    return NextResponse.json({ success: false, message: "尝试过于频繁，请稍后再试。" }, { status: 429 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const repositories = requireIdentifierRepos();
    await completePasswordReset({
      identifier: typeof body.identifier === "string" ? body.identifier : "",
      code: typeof body.code === "string" ? body.code : "",
      password: typeof body.password === "string" ? body.password : "",
      users: repositories.users,
      challenges: repositories.challenges,
    });
    return NextResponse.json({ success: true, data: { reset: true } });
  } catch (error) {
    return identifierAuthFailed(error);
  }
}

async function changePassword(request: NextRequest) {
  if (getAuthMode() === "legacy") {
    return NextResponse.json({ success: false, message: "当前账户由旧账户系统管理，请在原账户系统修改密码。" }, { status: 400 });
  }
  const auth = await getCurrentAuthContext();
  if (!auth) return NextResponse.json({ success: false, message: "请先登录。" }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const nextPassword = typeof body.nextPassword === "string" ? body.nextPassword : "";
    if (!currentPassword) {
      return NextResponse.json({ success: false, message: "请输入当前密码。" }, { status: 400 });
    }
    if (nextPassword.length < 8 || nextPassword.length > 128 || passwordWouldBeTruncatedByBcrypt(nextPassword)) {
      return NextResponse.json({ success: false, message: "新密码需为 8 至 72 个 UTF-8 字节。" }, { status: 400 });
    }
    if (currentPassword === nextPassword) {
      return NextResponse.json({ success: false, message: "新密码不能与当前密码相同。" }, { status: 400 });
    }
    const repositories = getPlatformRepositories();
    if (!repositories) return NextResponse.json({ success: false, message: "平台账户服务暂不可用。" }, { status: 503 });
    const user = await repositories.users.findById(auth.userId);
    if (!user?.passwordHash) {
      return NextResponse.json({ success: false, message: "当前登录方式未设置密码，请使用原登录方式继续访问。" }, { status: 400 });
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ success: false, message: "当前密码不正确。" }, { status: 400 });
    }
    await repositories.users.setPasswordHash(auth.userId, await hashPassword(nextPassword));
    return NextResponse.json({ success: true, data: { changed: true } });
  } catch (error) {
    console.error("Reizo password change failed", error);
    return NextResponse.json({ success: false, message: "密码修改失败，请稍后重试。" }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: RouteContext<"/api/account/[action]">) {
  const { action } = await context.params;
  if (action !== "self") {
    return NextResponse.json({ success: false, message: "Unknown account action" }, { status: 404 });
  }

  const user = await getCurrentAuthContext();
  if (!user) {
    return NextResponse.json({ success: false, message: "请先登录。" }, { status: 401 });
  }

  if (getAuthMode() === "legacy") {
    return NextResponse.json({
      success: true,
      data: {
        id: user.userId,
        username: user.username,
        display_name: user.displayName,
        email: user.email ?? "",
        platform_role: user.platformRole,
      },
    }, { headers: { "cache-control": "no-store" } });
  }

  const repositories = getPlatformRepositories();
  const database = getPlatformDb();
  if (!repositories || !database) {
    return NextResponse.json({ success: false, message: "平台数据库尚未配置。" }, { status: 503 });
  }
  const platformUser = await repositories.users.findById(user.userId);
  if (!platformUser?.currentOrganizationId) {
    return NextResponse.json({ success: false, message: "账户尚未关联工作区。" }, { status: 409 });
  }
  const mapping = await repositories.teamNewApiMapping.findByOrganizationId(platformUser.currentOrganizationId);
  if (!mapping) {
    return NextResponse.json({ success: false, message: "工作区未关联额度账户。" }, { status: 409 });
  }
  const { getNewApiUserQuota } = await import("@/lib/newapi/admin-client");
  // Balance synchronization is optional account metadata, not authentication.
  // Leave it absent on failure so the UI shows syncing instead of a false zero.
  let balance: { quota?: number; used_quota?: number } = {};
  try {
    const { quota, usedQuota } = await getNewApiUserQuota(mapping.newApiUserId);
    balance = { quota, used_quota: usedQuota };
  } catch (error) {
    console.error("Reizo account balance sync failed", {
      status: typeof error === "object" && error !== null && "status" in error
        ? error.status : undefined,
      kind: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      id: user.userId,
      username: user.username,
      display_name: user.displayName,
      email: user.email ?? "",
      ...balance,
      group: "personal",
      platform_role: user.platformRole,
    },
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest, context: RouteContext<"/api/account/[action]">) {
  const { action } = await context.params;
  if (action === "register") return register(request);
  if (action === "password") return changePassword(request);
  if (action === "identify") return identify(request);
  if (action === "signup") return signup(request);
  if (action === "signup-verify") return signupVerify(request);
  if (action === "signup-resend") return signupResend(request);
  if (action === "recover") return recover(request);
  if (action === "recover-complete") return recoverComplete(request);
  return NextResponse.json({ success: false, message: "Unknown account action" }, { status: 404 });
}
