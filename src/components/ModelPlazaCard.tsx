"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Heart } from "lucide-react";
import type { PlazaModel } from "@/lib/catalog";
import { useModals } from "@/components/providers";
import {
  modelDescription,
  modelPriceLines,
  modelTags,
  resolvePlazaVendor,
  type PlazaTag,
} from "@/lib/catalog/plaza-display";

const tagToneClass: Record<PlazaTag["tone"], string> = {
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
};

type Props = {
  model: PlazaModel;
  /** Optional docs URL; when omitted the docs button is hidden */
  docsHref?: string;
  selected?: boolean;
  onSelect?: (model: PlazaModel) => void;
  variant?: "default" | "directory";
};

export function ModelPlazaCard({ model, docsHref, selected, onSelect, variant = "default" }: Props) {
  const vendor = resolvePlazaVendor(model, {
    name: model.vendor_name,
  });
  const description = modelDescription(model, vendor);
  const tags = modelTags(model);
  const price = modelPriceLines(model);
  const studioHref = `/studio?model=${encodeURIComponent(model.model_name)}&entry=model-catalog`;
  const [logoFailed, setLogoFailed] = useState(false);
  const { favorites, toggleFavorite } = useModals();
  const favoriteId = `model:${model.model_name}`;
  const favorite = favorites.includes(favoriteId);

  if (variant === "directory") {
    return (
      <Link
        href={studioHref}
        className="portal-directory-model-card portal-directory-model-link"
        aria-label={`在工作台使用 ${model.model_name}`}
        title={`在工作台使用 ${model.model_name}`}
      >
        <div className="portal-directory-model-main">
          <span className="portal-directory-model-logo" style={{ background: vendor.heroGradient }}>
            {!logoFailed ? <img src={vendor.logo} alt="" onError={() => setLogoFailed(true)} /> : <span>{vendor.brandLabel.slice(0, 1)}</span>}
          </span>
          <span className="portal-directory-model-title"><strong>{model.model_name}</strong><small>{vendor.brandLabel}</small></span>
          <span className="portal-directory-model-hot">热门</span>
        </div>
        <div className="portal-directory-model-tags">{tags.slice(0, 3).map((tag) => <span key={tag.label}>{tag.label}</span>)}</div>
        <dl className="portal-directory-model-pricing" title={model.billing_group ? `美元计价 · ${model.billing_group} 分组（×${model.group_ratio}）；实际扣费按调用分组及缓存等用量计算` : undefined}>
          {price.kind === "ratio" ? <><div><dt>输入</dt><dd>{price.input.replace("输入：", "")}</dd></div><div><dt>输出</dt><dd>{price.output.replace("输出：", "")}</dd></div></> : <div><dt>调用价格</dt><dd>{price.text.replace("价格：", "")}</dd></div>}
        </dl>
      </Link>
    );
  }

  return (
    <article className={`portal-model-plaza-card group relative flex h-full flex-col overflow-hidden${selected ? " is-selected" : ""}`}>
      {/* Hero */}
      <div
        className="relative flex h-36 items-center justify-center px-4 sm:h-40"
        style={{ background: vendor.heroGradient }}
      >
        <div
          className={`relative z-[1] flex max-w-[85%] items-center gap-2 rounded-full bg-white px-4 py-2.5 shadow-md shadow-black/10 ${
            vendor.heroDark ? "ring-1 ring-white/20" : ""
          }`}
        >
          {!logoFailed ? (
            <img
              src={vendor.logo}
              alt=""
              width={22}
              height={22}
              className="h-5 w-5 shrink-0 rounded object-contain"
              onError={() => setLogoFailed(true)}
            />
          ) : null}
          <span className="truncate text-sm font-semibold tracking-wide text-slate-800">
            {vendor.brandLabel}
          </span>
        </div>

        <button
          type="button"
          className={`absolute right-3 top-3 z-[2] rounded-full bg-white/85 p-1.5 shadow-sm transition ${
            favorite ? "text-rose-500" : "text-slate-400 hover:text-rose-500"
          }`}
          title={favorite ? "取消收藏" : "收藏模型"}
          aria-label={favorite ? `取消收藏 ${model.model_name}` : `收藏 ${model.model_name}`}
          aria-pressed={favorite}
          onClick={() => toggleFavorite(favoriteId)}
        >
          <Heart className={`h-3.5 w-3.5 ${favorite ? "fill-current" : ""}`} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3.5">
        <h3 className="break-all text-[15px] font-semibold leading-snug text-slate-900">
          {model.model_name}
        </h3>
        <p className="mt-1.5 line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">{description}</p>

        <div className="mt-3 flex min-h-6 flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag.label}
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${tagToneClass[tag.tone]}`}
            >
              {tag.label}
            </span>
          ))}
        </div>

        <div className="mt-auto pt-3 text-xs font-medium text-[#0d4fc9]">
          {price.kind === "fixed" || price.kind === "tiered" ? (
            <p>{price.text}</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              <p className="inline-flex items-center gap-1">
                <ArrowDownLeft className="h-3 w-3 shrink-0 opacity-70" />
                {price.input}
              </p>
              <p className="inline-flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3 shrink-0 opacity-70" />
                {price.output}
              </p>
            </div>
          )}
        </div>
        <div className="portal-model-plaza-actions mt-3 flex gap-2">
          {onSelect ? <button type="button" className="portal-model-plaza-docs" onClick={() => onSelect(model)}>查看详情</button> : null}
          {docsHref ? (
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              className="portal-model-plaza-docs"
            >
              文档
            </a>
          ) : null}
          <Link href={studioHref} className="portal-model-plaza-launch">
            进入工作台
            <ArrowRight aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}
