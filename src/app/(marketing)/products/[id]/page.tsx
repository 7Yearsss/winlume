import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronRight } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import { DetailActions } from "@/components/CtaButtons";
import { getCategory } from "@/data/taxonomy";
import { getProduct, products, relatedProducts } from "@/data/products";

export function generateStaticParams() {
  return products.map((p) => ({ id: p.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = getProduct(id);
  return { title: product ? `${product.name} - Reizo` : "产品不存在 - Reizo" };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();

  const category = getCategory(product.category);
  const related = relatedProducts(product);

  return (
    <div className="marketing-product-detail mx-auto max-w-7xl px-4 py-10">
      {/* 面包屑 */}
      <nav className="flex items-center gap-1.5 text-sm text-ink-400">
        <Link href="/" className="transition hover:text-ink-800">首页</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href="/products" className="transition hover:text-ink-800">产品</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-ink-700">{product.name}</span>
      </nav>

      <div className="marketing-product-detail-grid">
        {/* 主栏 */}
        <div className="marketing-product-detail-main">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-canvas px-2.5 py-0.5 text-xs text-ink-600 ring-1 ring-line">
              {product.type}
            </span>
            {category && (
              <Link
                href={`/products?cate=${category.cate}&tag=${category.slug}`}
                className="flex items-center gap-1.5 rounded-md bg-canvas px-2.5 py-0.5 text-xs text-ink-600 ring-1 ring-line transition hover:text-primary-600 hover:ring-primary-200"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                {category.name}
              </Link>
            )}
            <span className="rounded-md bg-canvas px-2.5 py-0.5 text-xs text-ink-600 ring-1 ring-line">
              {product.brand}
            </span>
            {product.isNew && (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-700 ring-1 ring-amber-600/20">
                NEW
              </span>
            )}
          </div>

          <h1 className="mt-4 break-all font-mono text-3xl font-bold text-ink-950">
            {product.name}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-500">{product.tagline}</p>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-ink-900">简介</h2>
            <div className="mt-3 space-y-3 text-sm leading-7 text-ink-600">
              {product.description.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold text-ink-900">功能特性</h2>
            <ul className="marketing-product-features">
              {product.features.map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm text-ink-700"
                >
                  <Check className="h-4 w-4 shrink-0 text-teal-600" />
                  {f}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* 价格侧栏 */}
        <aside className="marketing-product-detail-aside">
          <div className="sticky top-24 rounded-xl border border-line bg-surface p-6">
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">
              计费
            </p>
            <div className="mt-3 rounded-lg bg-canvas p-4 font-mono text-sm ring-1 ring-line">
              {product.pricing.kind === "token" && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-ink-500">输入</span>
                    <span className="text-ink-900">
                      {product.pricing.input}
                      <span className="text-xs text-ink-400"> /1M tokens</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-ink-500">输出</span>
                    <span className="text-ink-900">
                      {product.pricing.output}
                      <span className="text-xs text-ink-400"> /1M tokens</span>
                    </span>
                  </div>
                </div>
              )}
              {product.pricing.kind === "unit" && (
                <div className="flex items-center justify-between">
                  <span className="font-sans text-ink-500">价格</span>
                  <span className="text-ink-900">{product.pricing.price}</span>
                </div>
              )}
              {product.pricing.kind === "custom" && (
                <p className="font-sans text-ink-700">{product.pricing.label}</p>
              )}
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-400">
              按实际用量从账户余额扣费，价格为演示占位数据。
            </p>
            <div className="mt-5">
              <DetailActions product={product} />
            </div>
          </div>
        </aside>
      </div>

      {/* 相关产品 */}
      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="text-lg font-semibold text-ink-900">相关产品</h2>
          <div className="marketing-product-related">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
