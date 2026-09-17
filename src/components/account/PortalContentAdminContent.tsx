"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PLAZA_VENDORS, getVendorByKey } from "@/lib/catalog/vendors";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useModals } from "@/components/providers";
import {
  ConsoleEmptyState,
  ConsolePage,
} from "@/components/console/ConsolePage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PORTAL_IMAGE_MAX_FILE_BYTES } from "@/lib/portal/content-limits";
import ModelPricingDialog from "./ModelPricingDialog";
import { applicationTools, defaultToolPresentation, normalizeToolPresentation, resolveApplicationTools, representativeTools, toolCategoryDescriptions, type ToolPresentation } from "@/lib/portal/application-tools";

type Category = "llm" | "image" | "audio" | "video" | "embed" | "other";
type Slide = {
  id: string;
  imageUrl: string;
  alt: string;
  href: string;
  enabled: boolean;
};
type Notice = {
  id: string;
  title: string;
  body: string;
  href: string;
  enabled: boolean;
  createdAt: string;
};
type Vendor = {
  id: string;
  name: string;
  key: string;
  logoUrl: string;
  category: Category;
  enabled: boolean;
  models: Array<{
    name: string;
    endpointTypes: string[];
    description?: string;
  }>;
};
type ApplicationShowcase = {
  id: string;
  title: string;
  href: string;
  imageUrl: string;
  group: "popular" | "latest";
  enabled: boolean;
};
type CapabilityShowcase = {
  id: string;
  title: string;
  eyebrow: string;
  href: string;
  imageUrl: string;
  tone: "models" | "agent" | "usage";
  enabled: boolean;
};
type PortalContent = {
  toolDirectory: ToolPresentation[];
  carousel: Slide[];
  notifications: Notice[];
  modelVendors: Vendor[];
  applicationShowcase: ApplicationShowcase[];
  capabilityShowcase: CapabilityShowcase[];
};
type PortalAdminSection = "carousel" | "applications" | "tools" | "capabilities" | "notifications" | "models";

async function readPortalResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (response.status === 413) {
      throw new Error("图片总大小超过服务器限制，请压缩图片后重试。");
    }
    throw new Error(`服务器返回异常（${response.status}），请稍后重试。`);
  }
}

const portalAdminSections: Array<{
  id: PortalAdminSection;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { id: "carousel", label: "首页轮播", description: "主视觉与焦点内容", icon: ImagePlus },
  { id: "applications", label: "应用展示", description: "热门与最新工具", icon: WandSparkles },
  { id: "tools", label: "工具目录", description: "分类封面与代表工具", icon: ImagePlus },
  { id: "capabilities", label: "能力模块", description: "模型、Agent 与治理", icon: Sparkles },
  { id: "notifications", label: "通知公告", description: "门户消息与跳转", icon: Megaphone },
  { id: "models", label: "模型提供商", description: "首页 API 展示管理", icon: Upload },
];
type CatalogModel = {
  model_name: string;
  catalog_only?: boolean;
  vendor_key?: string;
  vendor_name?: string;
  vendor_logo?: string;
  portal_category?: Category;
  supported_endpoint_types?: string[];
};

const categories: Array<{ value: Category; label: string }> = [
  { value: "llm", label: "语言推理" },
  { value: "image", label: "图像处理" },
  { value: "audio", label: "音频处理" },
  { value: "video", label: "视频处理" },
  { value: "embed", label: "RAG 知识库" },
  { value: "other", label: "信息检索" },
];
const emptyContent: PortalContent = {
  toolDirectory: defaultToolPresentation,
  carousel: [],
  notifications: [],
  modelVendors: [],
  applicationShowcase: [],
  capabilityShowcase: [],
};
const uid = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const categoryLabel = (value: Category) =>
  categories.find((item) => item.value === value)?.label ?? value;

function modelsToText(models: Vendor["models"]) {
  return models
    .map(
      (model) =>
        `${model.name}|${model.endpointTypes.join(",")}|${model.description ?? ""}`,
    )
    .join("\n");
}
function textToModels(value: string): Vendor["models"] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, types = "chat", description = ""] = line.split("|");
      return {
        name: name.trim(),
        endpointTypes: types
          .split(",")
          .map((type) => type.trim())
          .filter(Boolean),
        description: description.trim() || undefined,
      };
    })
    .filter((model) => model.name);
}
function categoryFromModel(model: CatalogModel): Category {
  const text =
    `${model.model_name} ${(model.supported_endpoint_types ?? []).join(" ")}`.toLowerCase();
  if (model.portal_category) return model.portal_category;
  if (text.includes("image") || text.includes("dall") || text.includes("flux"))
    return "image";
  if (text.includes("video") || text.includes("sora") || text.includes("kling"))
    return "video";
  if (
    text.includes("audio") ||
    text.includes("speech") ||
    text.includes("whisper")
  )
    return "audio";
  if (text.includes("embed") || text.includes("rerank") || text.includes("rag"))
    return "embed";
  if (text.includes("search") || text.includes("retrieval")) return "other";
  return "llm";
}
function groupCatalog(models: CatalogModel[]): Vendor[] {
  const grouped = new Map<string, Vendor>();
  for (const model of models) {
    if (model.catalog_only) continue;
    const key =
      (model.vendor_key || model.vendor_name || "other")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-") || "other";
    const category = categoryFromModel(model);
    const groupKey = `${key}-${category}`;
    const current = grouped.get(groupKey) ?? {
      id: `catalog-${groupKey}`,
      name: model.vendor_name || key,
      key,
      logoUrl: model.vendor_logo || "/vendors/other.svg",
      category,
      enabled: true,
      models: [],
    };
    current.models.push({
      name: model.model_name,
      endpointTypes: model.supported_endpoint_types ?? ["chat"],
    });
    grouped.set(groupKey, current);
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readImage(
  event: ChangeEvent<HTMLInputElement>,
  onRead: (url: string) => void,
) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/"))
    throw new Error("请上传图片文件。");
  if (file.size > PORTAL_IMAGE_MAX_FILE_BYTES)
    throw new Error("请上传 5MB 以内的图片文件，保证完整保存与快速加载。");
  const reader = new FileReader();
  reader.onload = () =>
    typeof reader.result === "string" && onRead(reader.result);
  reader.readAsDataURL(file);
}

function NotificationManager({
  notifications,
  onChange,
  onSave,
  saving,
}: {
  notifications: Notice[];
  onChange: (next: Notice[]) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
  const [page, setPage] = useState(0);
  const pageSize = 8;
  const filtered = useMemo(
    () =>
      notifications
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) =>
            (status === "all" ||
              (status === "enabled" ? item.enabled : !item.enabled)) &&
            `${item.title} ${item.body}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        ),
    [notifications, query, status],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );
  const update = (index: number, patch: Partial<Notice>) =>
    onChange(
      notifications.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= notifications.length) return;
    const next = [...notifications];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">
            通知管理{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({notifications.length})
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            右上角通知入口会展示已启用的内容。支持多条通知、筛选、排序与分页管理。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => {
              onChange([
                {
                  id: uid("notice"),
                  title: "新通知",
                  body: "请填写通知内容",
                  href: "/",
                  enabled: true,
                  createdAt: new Date().toISOString(),
                },
                ...notifications,
              ]);
              setPage(0);
            }}
          >
            <Megaphone className="h-4 w-4" />
            新增通知
          </Button>
          <Button size="sm" type="button" disabled={saving} onClick={onSave}>
            <Save className="h-4 w-4" />
            保存通知
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-muted/20 p-3">
        <label className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            className="w-full border-0 bg-transparent text-sm outline-none"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="搜索标题或正文"
          />
        </label>
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            setPage(0);
          }}
        >
          <option value="all">全部状态</option>
          <option value="enabled">仅已启用</option>
          <option value="disabled">仅已停用</option>
        </select>
        <span className="self-center text-xs text-muted-foreground">
          显示 {visible.length} / {filtered.length}
        </span>
      </div>
      {visible.length ? (
        <div className="grid gap-3">
          {visible.map(({ item, index }) => (
            <article
              className="grid gap-3 rounded-xl border border-border bg-background p-4 md:grid-cols-[1fr_1fr_auto]"
              key={item.id}
            >
              <div className="grid gap-2">
                <input
                  className="h-9 rounded-md border border-border px-3 text-sm"
                  value={item.title}
                  placeholder="通知标题"
                  onChange={(event) =>
                    update(index, { title: event.target.value })
                  }
                />
                <textarea
                  className="min-h-20 rounded-md border border-border p-3 text-sm"
                  value={item.body}
                  placeholder="通知正文"
                  onChange={(event) =>
                    update(index, { body: event.target.value })
                  }
                />
              </div>
              <div className="grid content-start gap-2">
                <input
                  className="h-9 rounded-md border border-border px-3 text-sm"
                  value={item.href}
                  placeholder="点击跳转地址"
                  onChange={(event) =>
                    update(index, { href: event.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  创建时间：{new Date(item.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="flex items-start justify-end gap-2">
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) =>
                      update(index, { enabled: event.target.checked })
                    }
                  />
                  启用
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  disabled={index === notifications.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() =>
                    onChange(
                      notifications.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <ConsoleEmptyState
          title="没有符合条件的通知"
          description="可调整筛选条件或新增一条通知。"
        />
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage((current) => current - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            {currentPage + 1} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={currentPage >= pages - 1}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ShowcaseImage({
  value,
  onChange,
  onError,
}: {
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <label className="grid h-24 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30 cursor-pointer">
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground">
            <ImagePlus className="mx-auto mb-1 h-5 w-5" />
            上传展示图片
          </span>
        )}
        <input
          className="hidden"
          type="file"
          accept="image/*"
          onChange={(event) => {
            void readImage(event, onChange).catch((reason) =>
              onError(reason.message),
            );
          }}
        />
      </label>
      <input
        className="h-9 rounded-md border border-border px-3 text-xs"
        value={value.startsWith("data:") ? "已上传本地图片" : value}
        placeholder="或粘贴图片 URL"
        onChange={(event) =>
          !value.startsWith("data:") && onChange(event.target.value)
        }
      />
    </div>
  );
}

function ToolDirectoryManager({ items, onChange, onSave, saving, onError }: {
  items: ToolPresentation[]; onChange: (items: ToolPresentation[]) => void;
  onSave: () => void; saving: boolean; onError: (message: string) => void;
}) {
  const [category, setCategory] = useState(applicationTools[0].category);
  const [query, setQuery] = useState("");
  const categoryTools = items.filter((item) => applicationTools.find((tool) => tool.id === item.id)?.category === category);
  const featured = new Set(representativeTools(resolveApplicationTools(items).filter((tool) => tool.category === category)).map((tool) => tool.id));
  const update = (id: string, patch: Partial<ToolPresentation>) => onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const move = (id: string, direction: -1 | 1) => {
    const index = categoryTools.findIndex((item) => item.id === id);
    const other = categoryTools[index + direction];
    if (!other) return;
    const next = [...items];
    const a = next.findIndex((item) => item.id === id), b = next.findIndex((item) => item.id === other.id);
    [next[a], next[b]] = [next[b], next[a]];
    onChange(next);
  };
  return <section className="grid gap-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">应用工具图片与推荐</h2><p className="text-sm text-muted-foreground">每类优先展示 3 个代表工具，其余收入更多工具。代表不足时按排序补齐。</p></div><Button type="button" disabled={saving} onClick={onSave}><Save className="h-4 w-4" />保存工具目录</Button></div>
    <div className="flex flex-wrap gap-3"><select aria-label="工具分类" className="rounded-md border p-2" value={category} onChange={(event) => { setCategory(event.target.value as typeof category); setQuery(""); }}>{Object.keys(toolCategoryDescriptions).map((name) => <option key={name}>{name}</option>)}</select><input aria-label="搜索管理工具" className="rounded-md border p-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工具名称" /></div>
    {categoryTools.filter((item) => applicationTools.find((tool) => tool.id === item.id)!.name.includes(query.trim())).map((item) => {
      const tool = applicationTools.find((tool) => tool.id === item.id)!;
      const index = categoryTools.findIndex((row) => row.id === item.id);
      return <article key={item.id} className="grid gap-4 rounded-xl border bg-background p-4 lg:grid-cols-[220px_1fr_auto]">
        <div><ShowcaseImage value={item.imageUrl} onChange={(imageUrl) => update(item.id, { imageUrl })} onError={onError} /><button type="button" className="mt-2 text-xs text-blue-600" onClick={() => update(item.id, { imageUrl: tool.imageUrl })}>恢复默认封面</button></div>
        <div className="grid content-start gap-3"><h3 className="font-semibold">{tool.name}</h3><p className="text-sm text-muted-foreground">{tool.description}</p><p className="text-xs text-blue-600">{item.enabled ? featured.has(item.id) ? "当前展示：代表工具" : "当前展示：更多工具" : "已隐藏"}</p><p className="text-xs text-muted-foreground">建议 3:2 横图，主体靠右，左侧留白。支持上传图片或填写图片地址。</p><div className="flex gap-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.featured} onChange={(event) => update(item.id, { featured: event.target.checked })} />优先作为代表工具</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.enabled} onChange={(event) => update(item.id, { enabled: event.target.checked })} />在目录展示</label></div></div>
        <div className="flex gap-2"><Button type="button" variant="outline" size="icon" aria-label={`上移${tool.name}`} disabled={index === 0 || Boolean(query)} onClick={() => move(item.id, -1)}><ArrowUp className="h-4 w-4" /></Button><Button type="button" variant="outline" size="icon" aria-label={`下移${tool.name}`} disabled={index === categoryTools.length - 1 || Boolean(query)} onClick={() => move(item.id, 1)}><ArrowDown className="h-4 w-4" /></Button></div>
      </article>;
    })}
  </section>;
}

function ApplicationShowcaseManager({
  items,
  onChange,
  onSave,
  saving,
  onError,
}: {
  items: ApplicationShowcase[];
  onChange: (next: ApplicationShowcase[]) => void;
  onSave: () => void;
  saving: boolean;
  onError: (message: string) => void;
}) {
  const update = (index: number, patch: Partial<ApplicationShowcase>) =>
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">首页应用成果展示</h2>
          <p className="text-sm text-muted-foreground">
            配置应用的工具链接和展示图片；每组第一项作为大图展示。最新上架暂不在首页展示，配置保留。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() =>
              onChange([
                ...items,
                {
                  id: uid("application"),
                  title: "新应用",
                  href: "/products?cate=app",
                  imageUrl: "",
                  group: "popular",
                  enabled: true,
                },
              ])
            }
          >
            <Plus className="h-4 w-4" />
            新增应用
          </Button>
          <Button size="sm" type="button" disabled={saving} onClick={onSave}>
            <Save className="h-4 w-4" />
            保存应用展示
          </Button>
        </div>
      </div>
      <div className="grid gap-3">
        {items.map((item, index) => (
          <article
            key={item.id}
            className="grid gap-3 rounded-xl border border-border bg-background p-4 lg:grid-cols-[180px_1fr_auto]"
          >
            <ShowcaseImage
              value={item.imageUrl}
              onChange={(imageUrl) => update(index, { imageUrl })}
              onError={onError}
            />
            <div className="grid content-start gap-2">
              <input
                className="h-9 rounded-md border border-border px-3 text-sm"
                value={item.title}
                placeholder="展示标题"
                onChange={(event) =>
                  update(index, { title: event.target.value })
                }
              />
              <input
                className="h-9 rounded-md border border-border px-3 text-sm"
                value={item.href}
                placeholder="工具链接，如 /studio/tools/demo"
                onChange={(event) =>
                  update(index, { href: event.target.value })
                }
              />
              <select
                className="h-9 rounded-md border border-border px-3 text-sm"
                value={item.group}
                onChange={(event) =>
                  update(index, {
                    group: event.target.value as ApplicationShowcase["group"],
                  })
                }
              >
                <option value="popular">热门应用</option>
                <option value="latest">最新上架</option>
              </select>
            </div>
            <div className="flex items-start gap-1">
              <label className="mr-2 flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(event) =>
                    update(index, { enabled: event.target.checked })
                  }
                />
                启用
              </label>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() =>
                  onChange(items.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CapabilityShowcaseManager({
  items,
  onChange,
  onSave,
  saving,
  onError,
}: {
  items: CapabilityShowcase[];
  onChange: (next: CapabilityShowcase[]) => void;
  onSave: () => void;
  saving: boolean;
  onError: (message: string) => void;
}) {
  const update = (index: number, patch: Partial<CapabilityShowcase>) =>
    onChange(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">首页平台能力展示</h2>
          <p className="text-sm text-muted-foreground">
            配置能力卡片的链接、展示图片与深色主题，最多展示 3 项效果最佳。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() =>
              onChange([
                ...items,
                {
                  id: uid("capability"),
                  title: "新能力",
                  eyebrow: "平台能力",
                  href: "/",
                  imageUrl: "",
                  tone: "models",
                  enabled: true,
                },
              ])
            }
          >
            <Plus className="h-4 w-4" />
            新增能力
          </Button>
          <Button size="sm" type="button" disabled={saving} onClick={onSave}>
            <Save className="h-4 w-4" />
            保存能力展示
          </Button>
        </div>
      </div>
      <div className="grid gap-3">
        {items.map((item, index) => (
          <article
            key={item.id}
            className="grid gap-3 rounded-xl border border-border bg-background p-4 lg:grid-cols-[180px_1fr_auto]"
          >
            <ShowcaseImage
              value={item.imageUrl}
              onChange={(imageUrl) => update(index, { imageUrl })}
              onError={onError}
            />
            <div className="grid content-start gap-2">
              <input
                className="h-9 rounded-md border border-border px-3 text-sm"
                value={item.title}
                placeholder="能力标题"
                onChange={(event) =>
                  update(index, { title: event.target.value })
                }
              />
              <input
                className="h-9 rounded-md border border-border px-3 text-sm"
                value={item.eyebrow}
                placeholder="卡片标签"
                onChange={(event) =>
                  update(index, { eyebrow: event.target.value })
                }
              />
              <input
                className="h-9 rounded-md border border-border px-3 text-sm"
                value={item.href}
                placeholder="跳转链接"
                onChange={(event) =>
                  update(index, { href: event.target.value })
                }
              />
              <select
                className="h-9 rounded-md border border-border px-3 text-sm"
                value={item.tone}
                onChange={(event) =>
                  update(index, {
                    tone: event.target.value as CapabilityShowcase["tone"],
                  })
                }
              >
                <option value="models">模型蓝</option>
                <option value="agent">Agent 青</option>
                <option value="usage">用量棕</option>
              </select>
            </div>
            <div className="flex items-start gap-1">
              <label className="mr-2 flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(event) =>
                    update(index, { enabled: event.target.checked })
                  }
                />
                启用
              </label>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() =>
                  onChange(items.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function VendorEditor({ vendors, catalogVendors, onChange, onSave, saving, onLoadCatalog, catalogLoading, catalogLoaded, catalogError }: {
  vendors: Vendor[]; catalogVendors: Vendor[]; onChange: (next: Vendor[]) => void;
  onSave: () => void; saving: boolean;
  onLoadCatalog: () => void; catalogLoading: boolean; catalogLoaded: boolean; catalogError: string;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Vendor | null>(null);
  const [pricingVendor, setPricingVendor] = useState<Vendor | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modelText, setModelText] = useState("");
  const [draftError, setDraftError] = useState("");
  const [importQuery, setImportQuery] = useState("");
  const filtered = vendors.filter((vendor) =>
    (!categoryFilter || vendor.category === categoryFilter) &&
    `${vendor.name} ${vendor.key} ${vendor.models.map((model) => model.name).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 8, currentPage * 8);
  const openEditor = (vendor: Vendor, existing = false) => {
    setEditingId(existing ? vendor.id : null);
    setDraft({ ...vendor, models: vendor.models.map((model) => ({ ...model, endpointTypes: [...model.endpointTypes] })) });
    setModelText(modelsToText(vendor.models));
    setDraftError("");
  };
  const addVendor = () => openEditor({ id: uid("vendor"), name: "", key: "", logoUrl: "", category: "llm", enabled: true, models: [] });
  const updateDraft = (patch: Partial<Vendor>) => {
    const id = draft?.id;
    setDraft((current) => current?.id === id && current ? { ...current, ...patch } : current);
  };
  const confirmDraft = () => {
    if (!draft) return;
    const models = textToModels(modelText);
    const name = draft.name.trim();
    const key = draft.key.trim().toLowerCase();
    if (!name || !/^[a-z0-9_-]+$/.test(key) || !models.length) {
      setDraftError("请填写名称、英文标识和至少一个模型。"); return;
    }
    if (models.length > 40) { setDraftError("每条配置最多支持 40 个模型。"); return; }
    if (vendors.some((vendor) => vendor.id !== editingId && vendor.key === key && vendor.category === draft.category)) {
      setDraftError("该分类已存在此提供商，请编辑已有记录。"); return;
    }
    const next = { ...draft, name, key, models, logoUrl: draft.logoUrl || getVendorByKey(key).logo };
    onChange(editingId ? vendors.map((vendor) => vendor.id === editingId ? next : vendor) : [...vendors, next]);
    if (!editingId) { setQuery(""); setCategoryFilter(""); setPage(Math.ceil((vendors.length + 1) / 8)); }
    setDraft(null);
  };
  const importCandidates = catalogVendors.filter((vendor) => `${vendor.name} ${vendor.key} ${categoryLabel(vendor.category)}`.toLowerCase().includes(importQuery.trim().toLowerCase()));
  return (
    <section className="grid gap-4" aria-label="提供商管理列表">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">API 模型提供商管理</h2>
          <p className="text-sm text-muted-foreground">共 {vendors.length} 条配置 · {vendors.filter((vendor) => vendor.enabled).length} 条展示。修改后点击“保存并发布”，同步首页与 API 目录。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" type="button" disabled={saving || vendors.length >= 80} onClick={addVendor}><Plus className="h-4 w-4" />新增提供商</Button>
          <Button size="sm" type="button" disabled={saving} onClick={onSave}><Save className="h-4 w-4" />{saving ? "正在发布…" : "保存并发布"}</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <input aria-label="搜索提供商" placeholder="搜索名称、标识或模型" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} className="h-10 min-w-48 flex-1 rounded-md border border-border bg-background px-3 text-sm" />
        <select aria-label="筛选提供商分类" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }} className="h-10 rounded-md border border-border bg-background px-3 text-sm"><option value="">全部分类</option>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full min-w-[600px] text-left text-sm" aria-label="提供商列表">
          <thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-3 font-medium">提供商</th><th className="px-4 py-3 font-medium">分类</th><th className="px-4 py-3 font-medium">模型</th><th className="px-4 py-3 font-medium">展示状态</th><th className="px-4 py-3 text-right font-medium">操作</th></tr></thead>
          <tbody>{visible.map((vendor) => <tr key={vendor.id} className="border-t border-border" data-provider-row>
            <td className="px-4 py-3"><div className="flex items-center gap-3"><img src={vendor.logoUrl || getVendorByKey(vendor.key).logo} alt="" className="h-8 w-8 shrink-0 object-contain" /><div><strong className="block max-w-64 truncate" title={vendor.name}>{vendor.name}</strong><small className="text-muted-foreground">{vendor.key}</small></div></div></td>
            <td className="px-4 py-3">{categoryLabel(vendor.category)}</td><td className="px-4 py-3">{vendor.models.length} 个</td>
            <td className="px-4 py-3"><label className="flex items-center gap-2"><input type="checkbox" disabled={saving} aria-label={`${vendor.name} ${categoryLabel(vendor.category)} 展示`} checked={vendor.enabled} onChange={(event) => onChange(vendors.map((item) => item.id === vendor.id ? { ...item, enabled: event.target.checked } : item))} />{vendor.enabled ? "展示" : "隐藏"}</label></td>
            <td className="px-4 py-3"><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setPricingVendor(vendor)}>模型定价</Button><Button type="button" variant="ghost" size="sm" disabled={saving} aria-label={`编辑 ${vendor.name} ${categoryLabel(vendor.category)}`} onClick={() => openEditor(vendor, true)}><Pencil className="h-4 w-4" />编辑</Button><Button type="button" variant="ghost" size="sm" disabled={saving} aria-label={`删除 ${vendor.name} ${categoryLabel(vendor.category)}`} onClick={() => onChange(vendors.filter((item) => item.id !== vendor.id))}><Trash2 className="h-4 w-4 text-red-500" /></Button></div></td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{vendors.length ? "没有匹配的提供商，试试其他关键词或分类。" : "尚未添加提供商，点击“新增提供商”开始。"}</p>}
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground"><span>共 {filtered.length} 条 · 每页 8 条</span><div className="flex items-center gap-3"><Button type="button" variant="outline" size="sm" aria-label="提供商上一页" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="h-4 w-4" /></Button><span>{currentPage} / {pages}</span><Button type="button" variant="outline" size="sm" aria-label="提供商下一页" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
      <details className="rounded-xl border border-dashed border-border p-4" onToggle={(event) => { if (event.currentTarget.open) onLoadCatalog(); }}>
        <summary className="cursor-pointer text-sm font-medium">从已同步目录导入{catalogLoaded ? ` · ${catalogVendors.length} 条提供商分类` : ""}</summary>
        {catalogLoading && <p role="status" className="mt-3 text-sm text-muted-foreground">正在读取可导入目录…</p>}
        {catalogError && <div role="alert" className="mt-3 flex items-center gap-3 text-sm text-red-600"><span>{catalogError}</span><Button type="button" variant="outline" size="sm" onClick={onLoadCatalog}>重试导入目录</Button></div>}
        <input aria-label="搜索可导入提供商" placeholder="搜索可导入提供商" value={importQuery} onChange={(event) => setImportQuery(event.target.value)} className="mt-3 h-9 w-full rounded-md border border-border bg-background px-3 text-sm" />
        <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto">
          {importCandidates.map((vendor) => <div key={`${vendor.key}-${vendor.category}`} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"><div className="flex items-center gap-3"><img src={vendor.logoUrl} alt="" className="h-7 w-7 object-contain" /><div className="text-sm"><strong>{vendor.name}</strong><span className="ml-2 text-muted-foreground">{categoryLabel(vendor.category)} · {vendor.models.length} 个模型</span></div></div><Button type="button" variant="outline" size="sm" disabled={saving || vendors.length >= 80 || vendors.some((item) => item.key === vendor.key && item.category === vendor.category)} onClick={() => openEditor({ ...vendor, id: uid("vendor") })}>{vendors.some((item) => item.key === vendor.key && item.category === vendor.category) ? "已添加" : "导入并编辑"}</Button></div>)}
          {catalogLoaded && !importCandidates.length && <p className="py-3 text-sm text-muted-foreground">暂无可导入的提供商。</p>}
        </div>
      </details>
      {pricingVendor && <ModelPricingDialog vendor={pricingVendor} onClose={() => setPricingVendor(null)} />}
      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto bg-white">
          <DialogHeader><DialogTitle>{editingId ? "编辑提供商" : "新增提供商"}</DialogTitle><DialogDescription>选择内置厂商可自动填入图标。完成编辑后，回到列表“保存并发布”。</DialogDescription></DialogHeader>
          {draft && <div className="grid gap-4">
          <label className="grid gap-1 text-sm">
            匹配内置厂商与图标
            <select
              className="h-9 rounded-md border border-border px-3 text-sm"
              value={PLAZA_VENDORS.some((item) => item.key === draft.key && item.key !== "other") ? draft.key : ""}
              onChange={(event) => {
                if (!event.target.value) return;
                const preset = getVendorByKey(event.target.value);
                updateDraft({ name: preset.brandLabel, key: preset.key, logoUrl: preset.logo });
              }}
            >
              <option value="">选择厂商，或手动填写自定义提供商</option>
              {PLAZA_VENDORS.filter((item) => item.key !== "other").map((item) => (
                <option value={item.key} key={item.key}>{item.brandLabel} · {item.key}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid h-20 w-20 place-items-center overflow-hidden rounded-lg border border-dashed border-border cursor-pointer sm:col-span-2">
              {draft.logoUrl ? (
                <img
                  src={draft.logoUrl}
                  alt=""
                  className="h-16 max-w-24 object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  <Upload className="mx-auto mb-1 h-4 w-4" />
                  上传图标
                </span>
              )}
              <input
                className="hidden"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  void readImage(event, (url) =>
                    updateDraft({ logoUrl: url }),
                  ).catch((reason) => window.alert(reason.message));
                }}
              />
            </label>
            <input
              className="h-9 rounded-md border border-border px-3 text-sm"
              value={draft.name}
              placeholder="厂商名称"
              onChange={(event) => updateDraft({ name: event.target.value })}
            />
            <input
              className="h-9 rounded-md border border-border px-3 text-sm"
              value={draft.key}
              placeholder="厂商标识（英文）"
              onChange={(event) => updateDraft({ key: event.target.value })}
            />
            <select
              className="h-9 rounded-md border border-border px-3 text-sm"
              aria-label="提供商分类"
              value={draft.category}
              onChange={(event) =>
                updateDraft({ category: event.target.value as Category })
              }
            >
              {categories.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="min-h-24 rounded-md border border-border p-3 font-mono text-xs"
            aria-label="模型列表"
            value={modelText}
            onChange={(event) =>
              setModelText(event.target.value)
            }
          />

            <p className="text-xs text-muted-foreground">每行一个模型：模型名称 | 接口类型（逗号分隔）| 简介。最多 40 个。</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft({ enabled: event.target.checked })} />在首页与 API 目录展示</label>
            {draftError && <p role="alert" className="text-sm text-red-600">{draftError}</p>}
          </div>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setDraft(null)}>取消</Button><Button type="button" onClick={confirmDraft}>完成编辑</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function PortalContentAdminContent({ initialSection = "carousel" }: { initialSection?: PortalAdminSection }) {
  const { account, accountLoading } = useModals();
  const [content, setContent] = useState<PortalContent>(emptyContent);
  const [catalogVendors, setCatalogVendors] = useState<Vendor[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<PortalAdminSection>(initialSection);
  const [savingSection, setSavingSection] = useState<PortalAdminSection | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const settings = await fetch(`/api/admin/portal-content?v=${Date.now()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
      const body = await readPortalResponse<PortalContent & {
        error?: string;
      }>(settings);
      if (!settings.ok) throw new Error(body.error || "加载失败");
      setContent({
        toolDirectory: normalizeToolPresentation(body.toolDirectory),
        carousel: body.carousel ?? [],
        notifications: body.notifications ?? [],
        modelVendors: body.modelVendors ?? [],
        applicationShowcase: body.applicationShowcase ?? [],
        capabilityShowcase: body.capabilityShowcase ?? [],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  const loadCatalog = async () => {
    if (catalogLoading || catalogLoaded) return;
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const response = await fetch("/api/catalog/plaza?scope=admin-import", {
        credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("目录暂时无法读取，请重试。");
      const payload = await response.json() as { success?: boolean; data?: CatalogModel[] };
      if (!payload.success || !Array.isArray(payload.data)) throw new Error("目录返回异常，请重试。");
      setCatalogVendors(groupCatalog(payload.data));
      setCatalogLoaded(true);
    } catch (reason) {
      setCatalogError(reason instanceof Error && reason.name === "TimeoutError" ? "模型目录响应超时，请稍后重试。" : "目录暂时无法读取，请重试。");
    } finally { setCatalogLoading(false); }
  };
  useEffect(() => {
    if (account?.platform_role !== "admin") return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [account?.platform_role, load]);
  const save = async (section: NonNullable<typeof savingSection>) => {
    if (section === "models") {
      const keys = new Set<string>();
      for (const vendor of content.modelVendors) {
        if (!vendor.name.trim() || !/^[a-z0-9_-]+$/.test(vendor.key) || vendor.models.length === 0) {
          setError("请填写提供商名称、英文小写标识（可含数字、短横线和下划线）以及至少一个模型。");
          return;
        }
        const key = `${vendor.category}:${vendor.key}`;
        if (keys.has(key)) {
          setError("同一分类下的提供商标识不能重复，请合并模型列表。");
          return;
        }
        keys.add(key);
      }
    }
    setSavingSection(section);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/admin/portal-content", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          section: section === "tools" ? "toolDirectory" : section === "carousel" ? "carousel"
            : section === "applications" ? "applicationShowcase"
              : section === "capabilities" ? "capabilityShowcase"
                : section === "notifications" ? "notifications" : "modelVendors",
          value: section === "tools" ? content.toolDirectory : section === "carousel" ? content.carousel
            : section === "applications" ? content.applicationShowcase
              : section === "capabilities" ? content.capabilityShowcase
                : section === "notifications" ? content.notifications : content.modelVendors,
        }),
      });
      const body = await readPortalResponse<PortalContent & {
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(body.error || "保存失败");
      setContent({
        toolDirectory: normalizeToolPresentation(body.toolDirectory),
        carousel: body.carousel,
        notifications: body.notifications,
        modelVendors: body.modelVendors,
        applicationShowcase: body.applicationShowcase,
        capabilityShowcase: body.capabilityShowcase,
      });
      const labels = {
        tools: "工具目录",
        carousel: "轮播图",
        applications: "应用展示",
        capabilities: "能力展示",
        notifications: "通知",
        models: "模型厂商配置",
      };
      setNotice(`${labels[section]}已发布。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSavingSection(null);
    }
  };
  if (accountLoading)
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        正在确认账户…
      </div>
    );
  if (account?.platform_role !== "admin")
    return (
      <ConsolePage
        title="门户内容管理"
      >
        <ConsoleEmptyState
          title="没有权限"
          description="当前账户不是平台 admin。"
        />
      </ConsolePage>
    );
  return (
    <ConsolePage
      title="门户内容管理"
    >
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在加载配置…
        </p>
      ) : (
        <div className="portal-admin-content">
          <nav className="portal-admin-section-nav" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }} aria-label="门户内容模块">
            {portalAdminSections.map(({ id, label, description, icon: Icon }) => {
              const count = id === "tools" ? content.toolDirectory.length : id === "carousel"
                ? content.carousel.length
                : id === "applications"
                  ? content.applicationShowcase.length
                  : id === "capabilities"
                    ? content.capabilityShowcase.length
                    : id === "notifications"
                      ? content.notifications.length
                      : content.modelVendors.length;
              return (
                <button
                  key={id}
                  type="button"
                  className={`portal-admin-section-tab${activeSection === id ? " is-active" : ""}`}
                  onClick={() => { setActiveSection(id); window.history.replaceState(null, "", `/account/portal?section=${id}`); }}
                  aria-current={activeSection === id ? "page" : undefined}
                >
                  <span className="portal-admin-section-icon"><Icon aria-hidden /></span>
                  <span className="portal-admin-section-copy">
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <em>{count}</em>
                </button>
              );
            })}
          </nav>
          {notice ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {activeSection === "carousel" ? <section className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold">首页轮播图</h2>
                <p className="text-sm text-muted-foreground">
                  上传一张横版图片即可适配桌面与笔记本，建议沿用 3:2（如 1536×1024）；图片等比完整展示，不裁切。
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() =>
                    setContent((current) => ({
                      ...current,
                      carousel: [
                        ...current.carousel,
                        {
                          id: uid("slide"),
                          imageUrl: "",
                          alt: "新轮播图",
                          href: "/products?cate=api",
                          enabled: true,
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="h-4 w-4" />
                  新增轮播
                </Button>
                <Button
                  size="sm"
                  type="button"
                  disabled={savingSection !== null}
                  onClick={() => void save("carousel")}
                >
                  <Save className="h-4 w-4" />
                  保存轮播
                </Button>
              </div>
            </div>
            {content.carousel.map((slide, index) => (
              <article
                key={slide.id}
                className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[150px_1fr_auto]"
              >
                <label className="grid min-h-24 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30 cursor-pointer">
                  {slide.imageUrl ? (
                    <img
                      src={slide.imageUrl}
                      alt=""
                      className="h-24 w-full object-contain"
                    />
                  ) : (
                    <span className="grid place-items-center gap-1 text-xs text-muted-foreground">
                      <ImagePlus className="h-5 w-5" />
                      上传封面
                    </span>
                  )}
                  <input
                    className="hidden"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      void readImage(event, (url) =>
                        setContent((current) => ({
                          ...current,
                          carousel: current.carousel.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, imageUrl: url }
                              : item,
                          ),
                        })),
                      ).catch((reason) => setError(reason.message));
                    }}
                  />
                </label>
                <div className="grid gap-2">
                  <input
                    className="h-9 rounded-md border border-border px-3 text-sm"
                    value={slide.alt}
                    placeholder="轮播标题"
                    onChange={(event) =>
                      setContent((current) => ({
                        ...current,
                        carousel: current.carousel.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, alt: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                  <input
                    className="h-9 rounded-md border border-border px-3 text-sm"
                    value={slide.href}
                    placeholder="跳转地址"
                    onChange={(event) =>
                      setContent((current) => ({
                        ...current,
                        carousel: current.carousel.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, href: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                  <input
                    className="h-9 rounded-md border border-border px-3 text-sm"
                    value={
                      slide.imageUrl.startsWith("data:")
                        ? "已上传本地图片"
                        : slide.imageUrl
                    }
                    placeholder="或粘贴图片 URL"
                    onChange={(event) =>
                      !slide.imageUrl.startsWith("data:") &&
                      setContent((current) => ({
                        ...current,
                        carousel: current.carousel.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, imageUrl: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                </div>
                <div className="flex items-start gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={slide.enabled}
                      onChange={(event) =>
                        setContent((current) => ({
                          ...current,
                          carousel: current.carousel.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, enabled: event.target.checked }
                              : item,
                          ),
                        }))
                      }
                    />
                    启用
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setContent((current) => ({
                        ...current,
                        carousel: current.carousel.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </article>
            ))}
          </section> : null}
          {activeSection === "tools" && <ToolDirectoryManager items={content.toolDirectory} saving={savingSection !== null} onSave={() => void save("tools")} onError={setError} onChange={(toolDirectory) => setContent((current) => ({ ...current, toolDirectory }))} />}

          {activeSection === "applications" ? <ApplicationShowcaseManager
            items={content.applicationShowcase}
            onChange={(applicationShowcase) =>
              setContent((current) => ({ ...current, applicationShowcase }))
            }
            onSave={() => void save("applications")}
            saving={savingSection !== null}
            onError={setError}
          /> : null}
          {activeSection === "capabilities" ? <CapabilityShowcaseManager
            items={content.capabilityShowcase}
            onChange={(capabilityShowcase) =>
              setContent((current) => ({ ...current, capabilityShowcase }))
            }
            onSave={() => void save("capabilities")}
            saving={savingSection !== null}
            onError={setError}
          /> : null}
          {activeSection === "notifications" ? <NotificationManager
            notifications={content.notifications}
            onChange={(notifications) =>
              setContent((current) => ({ ...current, notifications }))
            }
            onSave={() => void save("notifications")}
            saving={savingSection !== null}
          /> : null}
          {activeSection === "models" ? <VendorEditor
            vendors={content.modelVendors}
            catalogVendors={catalogVendors}
            onLoadCatalog={() => void loadCatalog()}
            catalogLoading={catalogLoading}
            catalogLoaded={catalogLoaded}
            catalogError={catalogError}
            onChange={(modelVendors) =>
              setContent((current) => ({ ...current, modelVendors }))
            }
            onSave={() => void save("models")}
            saving={savingSection !== null}
          /> : null}
        </div>
      )}
    </ConsolePage>
  );
}
