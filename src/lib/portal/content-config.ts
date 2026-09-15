import { defaultToolPresentation, normalizeToolPresentation, type ToolPresentation } from "./application-tools";
import { getPlatformRepositories } from "@/lib/platform/repositories";
import { PORTAL_IMAGE_MAX_DATA_URL_LENGTH } from "@/lib/portal/content-limits";
import { createHash } from "node:crypto";
import { getVendorByKey } from "@/lib/catalog/vendors";

export const PORTAL_CONTENT_KEY = "public-portal";
const PORTAL_CONTENT_CACHE_MS = 60_000;
let portalContentCache: { expiresAt: number; value: PortalContentConfig } | null = null;
export const PORTAL_MODEL_CATEGORIES = ["llm", "image", "audio", "video", "embed", "other"] as const;
export type PortalModelCategory = (typeof PORTAL_MODEL_CATEGORIES)[number];

export type PortalCarouselSlide = { id: string; imageUrl: string; alt: string; href: string; enabled: boolean };
export type PortalNotification = { id: string; title: string; body: string; href: string; enabled: boolean; createdAt: string };
export type PortalVendorModel = { name: string; endpointTypes: string[]; description?: string };
export type PortalModelVendor = { id: string; name: string; key: string; logoUrl: string; category: PortalModelCategory; enabled: boolean; models: PortalVendorModel[] };
export type PortalApplicationShowcaseItem = { id: string; title: string; href: string; imageUrl: string; group: "popular" | "latest"; enabled: boolean };
export type PortalCapabilityShowcaseItem = { id: string; title: string; eyebrow: string; href: string; imageUrl: string; tone: "models" | "agent" | "usage"; enabled: boolean };
export type PortalContentConfig = { toolDirectory: ToolPresentation[]; carousel: PortalCarouselSlide[]; notifications: PortalNotification[]; modelVendors: PortalModelVendor[]; applicationShowcase: PortalApplicationShowcaseItem[]; capabilityShowcase: PortalCapabilityShowcaseItem[] };

export const defaultPortalContent: PortalContentConfig = {
  toolDirectory: defaultToolPresentation,
  carousel: [
    { id: "claude-fable-5", imageUrl: "/figma-home/featured/slide-claude-fable-5.png", alt: "Model Review · Claude Fable 5", href: "/products?cate=api", enabled: true },
    { id: "gpt-5-6-sol", imageUrl: "/figma-home/featured/slide-gpt-5-6-sol.png", alt: "Model Review · GPT-5.6 Sol", href: "/products?cate=api", enabled: true },
  ],
  notifications: [
    { id: "welcome", title: "Reizo 门户已更新", body: "热门应用工具、API 模型与智能体入口已完成升级。", href: "/", enabled: true, createdAt: "2026-08-26T00:00:00.000Z" },
  ],
  modelVendors: [],
  applicationShowcase: [
    { id: "finance-assistant", title: "AI财务分析助手", href: "/studio/skills?scene=growth-commerce", imageUrl: "", group: "popular", enabled: true },
    { id: "copywriting", title: "AI文案创作", href: "/studio/skills?scene=content-office", imageUrl: "", group: "popular", enabled: true },
    { id: "video-generate", title: "AI视频生成", href: "/studio?preset=video-default", imageUrl: "", group: "popular", enabled: true },
    { id: "image-design", title: "AI图片设计", href: "/studio?preset=image-default", imageUrl: "", group: "popular", enabled: true },
    { id: "contract-review", title: "合同智能审查", href: "/studio/skills?scene=content-office", imageUrl: "", group: "popular", enabled: true },
    { id: "product-image", title: "产品图生成", href: "/studio?preset=image-default", imageUrl: "", group: "latest", enabled: true },
    { id: "finance-analysis", title: "财务分析助手", href: "/studio/skills?scene=growth-commerce", imageUrl: "", group: "latest", enabled: true },
    { id: "ppt-generate", title: "PPT 生成", href: "/studio/skills?scene=content-office", imageUrl: "", group: "latest", enabled: true },
    { id: "code-generate", title: "代码生成", href: "/studio/skills?scene=developer-api", imageUrl: "", group: "latest", enabled: true },
    { id: "contract-review", title: "合同审查", href: "/studio/skills?scene=content-office", imageUrl: "", group: "latest", enabled: true },
  ],
  capabilityShowcase: [
    { id: "model-routing", title: "强大的模型接入与调度", eyebrow: "模型接入", href: "/products?cate=api", imageUrl: "", tone: "models", enabled: true },
    { id: "agent-execution", title: "Agent 智能体平台", eyebrow: "智能体", href: "/studio", imageUrl: "", tone: "agent", enabled: true },
    { id: "knowledge-engine", title: "企业级知识引擎", eyebrow: "知识引擎", href: "/business/capabilities", imageUrl: "", tone: "usage", enabled: true },
  ],
};

function string(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function id(value: unknown, fallback: string) { return string(value, 80).replace(/[^a-zA-Z0-9_-]/g, "-") || fallback; }
function category(value: unknown): PortalModelCategory { return PORTAL_MODEL_CATEGORIES.includes(value as PortalModelCategory) ? value as PortalModelCategory : "llm"; }
function applicationGroup(value: unknown): PortalApplicationShowcaseItem["group"] { return value === "latest" ? "latest" : "popular"; }
function capabilityTone(value: unknown): PortalCapabilityShowcaseItem["tone"] { return value === "agent" || value === "usage" ? value : "models"; }

export function normalizePortalContent(input: unknown): PortalContentConfig {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const carousel = Array.isArray(raw.carousel) ? raw.carousel.slice(0, 12).flatMap((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const imageUrl = string(row.imageUrl, PORTAL_IMAGE_MAX_DATA_URL_LENGTH); const alt = string(row.alt, 120); const href = string(row.href, 500) || "/";
    return imageUrl && alt ? [{ id: id(row.id, `slide-${index + 1}`), imageUrl, alt, href, enabled: row.enabled !== false }] : [];
  }) : defaultPortalContent.carousel;
  const notifications = Array.isArray(raw.notifications) ? raw.notifications.slice(0, 30).flatMap((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const title = string(row.title, 120); const body = string(row.body, 500);
    return title && body ? [{ id: id(row.id, `notice-${index + 1}`), title, body, href: string(row.href, 500) || "/", enabled: row.enabled !== false, createdAt: string(row.createdAt, 64) || new Date().toISOString() }] : [];
  }) : defaultPortalContent.notifications;
  const modelVendors = Array.isArray(raw.modelVendors) ? raw.modelVendors.slice(0, 80).flatMap((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = string(row.name, 100); const key = id(row.key, `vendor-${index + 1}`).toLowerCase();
    const models = Array.isArray(row.models) ? row.models.slice(0, 40).flatMap((model) => {
      const data = model && typeof model === "object" ? model as Record<string, unknown> : {};
      const modelName = string(data.name, 120);
      return modelName ? [{ name: modelName, endpointTypes: Array.isArray(data.endpointTypes) ? data.endpointTypes.map((value) => string(value, 40)).filter(Boolean).slice(0, 8) : ["chat"], description: string(data.description, 300) || undefined }] : [];
    }) : [];
    return name && models.length ? [{ id: id(row.id, `vendor-${index + 1}`), name, key, logoUrl: string(row.logoUrl, PORTAL_IMAGE_MAX_DATA_URL_LENGTH) || getVendorByKey(key).logo, category: category(row.category), enabled: row.enabled !== false, models }] : [];
  }) : [];
  const applicationShowcase = Array.isArray(raw.applicationShowcase) ? raw.applicationShowcase.slice(0, 20).flatMap((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {}; const title = string(row.title, 100);
    return title ? [{ id: id(row.id, `application-${index + 1}`), title, href: string(row.href, 500) || "/products?cate=app", imageUrl: string(row.imageUrl, PORTAL_IMAGE_MAX_DATA_URL_LENGTH), group: applicationGroup(row.group), enabled: row.enabled !== false }] : [];
  }) : defaultPortalContent.applicationShowcase;
  const capabilityShowcase = Array.isArray(raw.capabilityShowcase) ? raw.capabilityShowcase.slice(0, 8).flatMap((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {}; const title = string(row.title, 100);
    return title ? [{ id: id(row.id, `capability-${index + 1}`), title, eyebrow: string(row.eyebrow, 60), href: string(row.href, 500) || "/", imageUrl: string(row.imageUrl, PORTAL_IMAGE_MAX_DATA_URL_LENGTH), tone: capabilityTone(row.tone), enabled: row.enabled !== false }] : [];
  }) : defaultPortalContent.capabilityShowcase;
  return {
    carousel: carousel.length ? carousel : defaultPortalContent.carousel,
    notifications,
    toolDirectory: normalizeToolPresentation(raw.toolDirectory),
    modelVendors,
    applicationShowcase: applicationShowcase.length ? applicationShowcase : defaultPortalContent.applicationShowcase,
    capabilityShowcase: capabilityShowcase.length ? capabilityShowcase : defaultPortalContent.capabilityShowcase,
  };
}

export async function getPortalContent(options: { fresh?: boolean } = {}): Promise<PortalContentConfig> {
  if (!options.fresh && portalContentCache && portalContentCache.expiresAt > Date.now()) {
    return portalContentCache.value;
  }
  const repositories = getPlatformRepositories();
  if (!repositories) return defaultPortalContent;
  try {
    const value = normalizePortalContent(await repositories.portalContent.get(PORTAL_CONTENT_KEY));
    portalContentCache = { value, expiresAt: Date.now() + PORTAL_CONTENT_CACHE_MS };
    return value;
  }
  catch { return defaultPortalContent; }
}

export function invalidatePortalContentCache() {
  portalContentCache = null;
}

const DATA_IMAGE_PATTERN = /^data:(image\/(?:png|jpe?g|webp|gif|svg\+xml));base64,([a-z0-9+/=\s]+)$/i;
type PortalImageSection = "toolDirectory" | "carousel" | "applicationShowcase" | "capabilityShowcase" | "modelVendors";

function publicImageUrl(section: PortalImageSection, id: string, imageUrl: string): string {
  if (!DATA_IMAGE_PATTERN.test(imageUrl)) return imageUrl;
  const version = createHash("sha256").update(imageUrl).digest("hex").slice(0, 12);
  return `/api/portal/image?section=${encodeURIComponent(section)}&id=${encodeURIComponent(id)}&v=${version}`;
}

/**
 * Public pages receive image references instead of multi-megabyte data URLs.
 * The admin endpoint intentionally continues to use getPortalContent().
 */
export function toPublicPortalContent(content: PortalContentConfig): PortalContentConfig {
  return {
    ...content,
    toolDirectory: content.toolDirectory.map((item) => ({ ...item, imageUrl: publicImageUrl("toolDirectory", item.id, item.imageUrl) })),
    carousel: content.carousel.map((item) => ({ ...item, imageUrl: publicImageUrl("carousel", item.id, item.imageUrl) })),
    modelVendors: content.modelVendors.map((vendor) => ({ ...vendor, logoUrl: publicImageUrl("modelVendors", vendor.id, vendor.logoUrl) })),
    applicationShowcase: content.applicationShowcase.map((item) => ({ ...item, imageUrl: publicImageUrl("applicationShowcase", item.id, item.imageUrl) })),
    capabilityShowcase: content.capabilityShowcase.map((item) => ({ ...item, imageUrl: publicImageUrl("capabilityShowcase", item.id, item.imageUrl) })),
  };
}

export async function getPublicPortalContent(): Promise<PortalContentConfig> {
  return toPublicPortalContent(await getPortalContent());
}

/** Resolve one managed image without exposing the stored data URL in JSON. */
export async function getPortalImage(section: string, requestedId: string): Promise<{ mimeType: string; data: Buffer } | null> {
  const allowedSections: PortalImageSection[] = ["toolDirectory", "carousel", "applicationShowcase", "capabilityShowcase", "modelVendors"];
  if (!allowedSections.includes(section as PortalImageSection) || !requestedId) return null;
  const content = await getPortalContent();
  const rows = content[section as PortalImageSection];
  const row = rows.find((item) => item.id === requestedId) as Record<string, unknown> | undefined;
  const imageUrl = typeof row?.imageUrl === "string" ? row.imageUrl : typeof row?.logoUrl === "string" ? row.logoUrl : "";
  const match = DATA_IMAGE_PATTERN.exec(imageUrl);
  if (!match) return null;
  try {
    const data = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    return data.length ? { mimeType: match[1].toLowerCase(), data } : null;
  } catch {
    return null;
  }
}
