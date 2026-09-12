"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import ApplicationDirectory from "@/components/ApplicationDirectory";
import PortalHeader from "@/components/PortalHeader";
import { RealModelGrid } from "@/components/RealModelGrid";
import {
  type PlazaCapabilityFilter,
  vendorsPresentIn,
  filterPlazaModels,
} from "@/lib/catalog/plaza-filters";
import type { PlazaModel } from "@/lib/catalog";
import { modelDescription, modelPriceLines, modelTags, resolvePlazaVendor } from "@/lib/catalog/plaza-display";
import { usePortalCanvasScale } from "@/components/usePortalCanvasScale";

interface Props {
  initialCate?: string;
  initialTag?: string;
  initialBrand?: string;
  initialQuery?: string;
  initialCategory?: string;
}

type ViewMode = "models" | "apps";

const MODEL_CATEGORIES = [
  { id: "llm", label: "语言推理", icon: "/figma-home/icon-chat.svg" },
  { id: "image", label: "图像处理", icon: "/figma-home/icon-image.svg" },
  { id: "video", label: "视频处理", icon: "/figma-home/icon-video.svg" },
  { id: "audio", label: "音频处理", icon: "/figma-home/icon-voice.svg" },
  { id: "embed", label: "RAG 知识库", icon: "/figma-home/icon-db.svg" },
  { id: "other", label: "信息检索", icon: "/figma-home/icon-search.svg" },
] as const;

function resolveMode(initialCate?: string): ViewMode {
  if (initialCate === "app") return "apps";
  return "models";
}

function ModelDetailPanel({ model, onClose }: { model: PlazaModel; onClose: () => void }) {
  const vendor = resolvePlazaVendor(model, { name: model.vendor_name });
  const price = modelPriceLines(model);
  return (
    <section className="portal-model-detail portal-model-detail-dock" aria-labelledby="portal-model-detail-title">
      <button type="button" className="portal-model-detail-close" onClick={onClose} aria-label="关闭模型详情"><X aria-hidden /></button>
      <p className="portal-model-detail-kicker">MODEL DETAIL</p>
      <div className="portal-model-detail-brand"><img src={vendor.logo} alt="" /><div><h2 id="portal-model-detail-title">{model.model_name}</h2><span>{vendor.brandLabel}</span></div></div>
      <p>{modelDescription(model, vendor)}</p>
      <div className="portal-model-detail-tags">{modelTags(model).map((tag) => <span key={tag.label}>{tag.label}</span>)}</div>
      <dl><div><dt>计费方式</dt><dd>{price.kind === "fixed" || price.kind === "tiered" ? price.text : `${price.input} / ${price.output}`}</dd></div><div><dt>调用协议</dt><dd>HTTPS / JSON</dd></div><div><dt>端点能力</dt><dd>{model.supported_endpoint_types?.join("、") || "标准模型调用"}</dd></div></dl>
      <h3>适合场景</h3><ul><li>复杂推理与问题解答</li><li>内容生成与信息处理</li><li>Agent 与自动化任务</li></ul>
      <div className="portal-model-detail-actions"><Link href="/docs/api">查看 API 文档</Link><Link href={`/studio?model=${encodeURIComponent(model.model_name)}`}>立即调用 API</Link></div>
    </section>
  );
}

export default function ProductsExplorer({
  initialCate,
  initialBrand,
  initialQuery,
  initialCategory,
}: Props) {
  const router = useRouter();
  usePortalCanvasScale();

  const mode = resolveMode(initialCate);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [vendorKey, setVendorKey] = useState<string | undefined>(initialBrand);
  const [capability, setCapability] = useState<PlazaCapabilityFilter>("all");
  const [plazaModels, setPlazaModels] = useState<PlazaModel[]>([]);
  const [plazaStats, setPlazaStats] = useState({ total: 0, filtered: 0 });
  const [selectedModel, setSelectedModel] = useState<PlazaModel | null>(null);

  useEffect(() => {
    if (mode === "apps") return;
    const params = new URLSearchParams();
    params.set("cate", "api");
    if (vendorKey) params.set("brand", vendorKey);
    if (query.trim()) params.set("q", query.trim());
    router.replace(`/products?${params.toString()}`, { scroll: false });
  }, [mode, query, router, vendorKey]);

  const onPlazaStats = useCallback(
    (stats: { total: number; filtered: number; models: PlazaModel[] }) => {
      setPlazaStats({ total: stats.total, filtered: stats.filtered });
      setPlazaModels(stats.models);
      setSelectedModel((current) => current && stats.models.some((model) => model.model_name === current.model_name) ? current : null);
    },
    [],
  );

  const vendorChips = useMemo(() => vendorsPresentIn(filterPlazaModels(plazaModels, { capability, query })), [plazaModels, capability, query]);

  const resetModelFilters = () => {
    setQuery("");
    setVendorKey(undefined);
    setCapability("all");
  };

  const hasModelFilters = Boolean(query || vendorKey || capability !== "all");
  const activeCategoryLabel = capability === "all"
    ? "全部 API 模型"
    : MODEL_CATEGORIES.find((category) => category.id === capability)?.label ?? "全部 API 模型";

  return (
    <div className="portal-home portal-density-shell">
      <div className="portal-frame pb-16">
        <PortalHeader productMode={mode === "apps" ? "app" : "api"} />

        {mode === "apps" ? (
          <ApplicationDirectory initialQuery={initialQuery} initialCategory={initialCategory} />
        ) : (
        <div className="portal-directory-layout">
          <aside className={`portal-directory-side${selectedModel ? " has-model-detail" : ""}`}>
            <h2>API模型</h2>
            <button type="button" className={`portal-directory-all ${capability === "all" ? "is-active" : ""}`} onClick={resetModelFilters}>
              全部模型<ChevronRight aria-hidden />
            </button>
            {MODEL_CATEGORIES.map(({ id, label, icon }) => (
              <button key={id} type="button" className="portal-directory-model-row" data-active={capability === id || undefined} onClick={() => setCapability(id as PlazaCapabilityFilter)}>
                <img src={icon} alt="" aria-hidden width={20} height={20} />
                <span><strong>{label}</strong></span><ChevronRight aria-hidden />
              </button>
            ))}
            {selectedModel ? <ModelDetailPanel model={selectedModel} onClose={() => setSelectedModel(null)} /> : null}
          </aside>
          <div className="portal-directory-main">
        <section className="portal-catalog-hero">
          <div className="portal-catalog-title-row">
            <div>
              <h1>{activeCategoryLabel}</h1>
            </div>
            <div className="portal-catalog-hero-links"><Link href="/docs/api"><BookOpen aria-hidden /> API 文档</Link><Link href="/pricing">计费说明</Link></div>
          </div>
          <form
            className="portal-catalog-search"
            onSubmit={(event) => event.preventDefault()}
          >
            <Search aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索模型"
              placeholder="搜索模型名称、厂商，例如 gpt-5.5、claude、deepseek…"
            />
            {query ? (
              <button
                type="button"
                className="portal-catalog-clear"
                onClick={() => setQuery("")}
                aria-label="清除搜索"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            <button type="submit">
              <Search aria-hidden />
              搜索
            </button>
          </form>
          {plazaStats.total > 0 ? (
            <p className="portal-catalog-search-hint">
              {hasModelFilters
                ? `匹配 ${plazaStats.filtered} / ${plazaStats.total} 个模型`
                : `共 ${plazaStats.total} 个模型可检索`}
            </p>
          ) : null}
        </section>

        {vendorChips.length > 0 ? (
          <div className="portal-model-vendor-strip">
            <div className="portal-model-strip-title"><span>🔥</span><strong>热门推荐</strong></div>
            <div className="portal-model-vendor-scroller">
              {vendorChips.map((vendor) => (
                <button key={vendor.key} type="button" className={vendorKey === vendor.key ? "is-selected" : undefined} onClick={() => setVendorKey(vendor.key === vendorKey ? undefined : vendor.key)}>
                  <img src={vendor.logo} alt="" width={26} height={26} />
                  <span>{vendor.brandLabel}</span><small>{vendor.count} 个模型</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="portal-catalog-section-head">
          <div>
            <h2>{capability === "all" ? "全部模型" : `${activeCategoryLabel}模型`}</h2>
            <p>
              {hasModelFilters
              ? `已筛选 ${plazaStats.filtered} / ${plazaStats.total} 个模型`
                : `共 ${plazaStats.total || "—"} 个模型`}
            </p>
          </div>
          {hasModelFilters ? (
            <button type="button" className="portal-arrow-link" onClick={resetModelFilters}>
              清除筛选
            </button>
          ) : (
            <span className="portal-catalog-meta">PRICING CATALOG</span>
          )}
        </div>

        <div className="portal-model-directory">
        <RealModelGrid
          limit={240}
          compact
          query={query}
          vendorKey={vendorKey}
          capability={capability}
          onStats={onPlazaStats}
          onClearFilters={resetModelFilters}
          selectedModelName={selectedModel?.model_name}
          onSelectModel={setSelectedModel}
          variant="directory"
        />
        </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
