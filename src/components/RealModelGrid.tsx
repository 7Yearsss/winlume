"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, PackageSearch } from "lucide-react";
import { fetchPlaza, type PlazaModel } from "@/lib/catalog";
import { ModelPlazaCard } from "@/components/ModelPlazaCard";
import {
  filterPlazaModels,
  type PlazaCapabilityFilter,
} from "@/lib/catalog/plaza-filters";

export type RealModelGridProps = {
  limit?: number;
  compact?: boolean;
  query?: string;
  vendorKey?: string;
  capability?: PlazaCapabilityFilter;
  /** Report full (unfiltered) and filtered counts to parent chrome */
  onStats?: (stats: { total: number; filtered: number; models: PlazaModel[] }) => void;
  /** Lets the surrounding catalog restore its selected filters. */
  onClearFilters?: () => void;
  selectedModelName?: string;
  onSelectModel?: (model: PlazaModel) => void;
  variant?: "default" | "directory";
};

export function RealModelGrid({
  limit = 12,
  compact = false,
  query = "",
  vendorKey,
  capability = "all",
  onStats,
  onClearFilters,
  selectedModelName,
  onSelectModel,
  variant = "default",
}: RealModelGridProps) {
  const [models, setModels] = useState<PlazaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetchPlaza({ fresh: true })
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
        setError("");
        setLoading(false);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "模型广场暂时不可访问。");
        setLoading(false);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [retryCount]);

  const filtered = useMemo(
    () => filterPlazaModels(models, { query, vendorKey, capability }),
    [models, query, vendorKey, capability],
  );

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  useEffect(() => {
    onStats?.({ total: models.length, filtered: filtered.length, models });
  }, [models, filtered, onStats]);

  const retry = () => {
    setError("");
    setLoading(true);
    setRetryCount((count) => count + 1);
  };

  const gridClass = variant === "directory"
    ? "portal-model-directory-grid"
    : compact
    ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    : "grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[10px] border border-[#f3c4c4] bg-[#fff7f7] px-4 py-8 text-center">
        <p className="text-sm text-[#b42318]">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="rounded-lg border border-[#f3c4c4] bg-white px-3.5 py-1.5 text-xs font-medium text-[#b42318] transition hover:bg-[#fff1f0]"
        >
          重试
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={gridClass} aria-label="正在同步模型广场" role="status">
        {Array.from({ length: compact ? 8 : 10 }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-[10px] border border-[rgba(120,150,180,.22)] bg-white">
            <div className="h-36 animate-pulse bg-[#eef3f8] sm:h-40" />
            <div className="space-y-2 p-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-[#eef3f8]" />
              <div className="h-3 w-full animate-pulse rounded bg-[#eef3f8]" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-[#eef3f8]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (visible.length === 0) {
    const catalogIsEmpty = models.length === 0;
    return (
      <div className="portal-catalog-empty">
        <PackageSearch className="h-10 w-10 text-[#9aa8b5]" aria-hidden />
        <h3>{catalogIsEmpty ? "模型目录正在准备中" : "没有符合条件的模型"}</h3>
        <p>
          {catalogIsEmpty
            ? "暂时没有可展示的模型。你仍可以进入工作台，查看当前可用能力。"
            : "尝试清除搜索、能力或厂商筛选，重新浏览完整目录。"}
        </p>
        <div className="portal-catalog-empty-actions">
          {!catalogIsEmpty && onClearFilters ? (
            <button
              type="button"
              className="portal-catalog-empty-secondary"
              onClick={onClearFilters}
            >
              清除筛选
            </button>
          ) : null}
          <Link
            href="/studio?entry=model-catalog-empty"
            className="portal-catalog-empty-primary"
          >
            进入工作台
            <ArrowRight aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={gridClass}>
      {visible.map((model) => (
        <ModelPlazaCard key={`${model.vendor_key}:${model.portal_category}:${model.model_name}`} model={model} variant={variant} selected={selectedModelName === model.model_name} onSelect={onSelectModel} />
      ))}
    </div>
  );
}
