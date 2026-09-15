"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Copy, Link2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ApiDocPage, ApiParam } from "@/data/docs/api-catalog";
import {
  buildCodeSamples,
  categoryForSlug,
  DOCS_BASE_URL,
  getAdjacentPages,
} from "@/data/docs/api-catalog";
import { CodeBlock, CodeTabs } from "@/components/docs/CodeBlock";
import { DocsAiMenu } from "@/components/docs/DocsAiMenu";
import LogoMark from "@/components/LogoMark";

function ParamTable({ title, params }: { title: string; params: ApiParam[] }) {
  if (!params.length) return null;
  return (
    <section className="docs-section">
      <h2>{title}</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>类型</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name}>
                <td>
                  <code>{p.name}</code>
                  {p.required ? <span className="docs-required">required</span> : null}
                </td>
                <td>
                  <code className="docs-type">{p.type}</code>
                </td>
                <td>{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CopyButton({
  label,
  value,
  icon = "copy",
}: {
  label: string;
  value: string;
  icon?: "copy" | "link";
}) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }
  const Icon = copied ? Check : icon === "link" ? Link2 : Copy;
  return (
    <button type="button" className="docs-chip-btn" onClick={onCopy}>
      <Icon aria-hidden />
      {copied ? "已复制" : label}
    </button>
  );
}

export function ApiEndpointView({ page }: { page: ApiDocPage }) {
  const category = categoryForSlug(page.slug);
  const { prev, next } = getAdjacentPages(page.slug);
  const samples = useMemo(() => buildCodeSamples(page), [page]);
  const fullUrl = `${DOCS_BASE_URL}${page.path}`;
  const curlSample = samples.find((s) => s.id === "curl")?.code ?? "";
  const [pageUrl, setPageUrl] = useState<string | undefined>();
  useEffect(() => {
    setPageUrl(`${window.location.origin}/docs/api/${page.slug}`);
  }, [page.slug]);

  const categoryLabel = category
    ? `${category.title} (${category.titleEn})`
    : undefined;

  const extraHeaders = (page.headers ?? []).filter((h) => h.name !== "Authorization");

  return (
    <article className="docs-endpoint">
      <div className="docs-breadcrumb">
        <Link href="/docs/api">AI 模型接口</Link>
        {categoryLabel ? (
          <>
            <span aria-hidden>›</span>
            <span>{categoryLabel}</span>
          </>
        ) : null}
        <span aria-hidden>›</span>
        <span>{page.navTitle}</span>
      </div>

      <header className="docs-endpoint-head">
        <div className="docs-endpoint-head-row">
          <h1>{page.title}</h1>
          <div className="docs-endpoint-head-actions">
            <span className="docs-format-tag">{page.format}</span>
            <DocsAiMenu page={page} pageUrl={pageUrl} />
          </div>
        </div>
        <p className="docs-lead">{page.description}</p>
      </header>

      {/* 1. Endpoint summary — first thing a developer needs */}
      <section className="docs-endpoint-card" aria-label="接口摘要">
        <div className="docs-endpoint-card-row">
          <span className={`docs-method-lg docs-method-${page.method.toLowerCase()}`}>
            {page.method}
          </span>
          <code className="docs-endpoint-path">{page.path}</code>
        </div>
        <div className="docs-endpoint-meta">
          <div>
            <span className="docs-meta-label">Base URL</span>
            <code>{DOCS_BASE_URL}</code>
          </div>
          <div>
            <span className="docs-meta-label">完整路径</span>
            <code className="docs-endpoint-full">{fullUrl}</code>
          </div>
          {page.contentType ? (
            <div>
              <span className="docs-meta-label">Content-Type</span>
              <code>{page.contentType}</code>
            </div>
          ) : null}
        </div>
        <div className="docs-endpoint-actions">
          <CopyButton label="复制 URL" value={fullUrl} icon="link" />
          <CopyButton label="复制路径" value={page.path} />
          {curlSample ? <CopyButton label="复制 cURL" value={curlSample} /> : null}
        </div>
      </section>

      {page.notes?.length ? (
        <div className="docs-callout">
          <p className="docs-callout-title">注意</p>
          <ul>
            {page.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 2. Auth — short and scannable */}
      <section className="docs-section">
        <h2>鉴权</h2>
        <div className="docs-auth-card">
          <p>
            在请求头携带 API密钥：
            <code>Authorization: Bearer sk-xxxxx</code>
          </p>
          <p className="docs-muted-inline">
            在{" "}
            <Link href="/account/keys">API密钥</Link> 创建密钥，建议写入环境变量{" "}
            <code>REIZO_API_KEY</code>。
          </p>
        </div>
      </section>

      {/* 3. Code samples — primary for integration */}
      <section className="docs-section">
        <div className="docs-section-head">
          <h2>请求示例</h2>
          <span className="docs-section-aside">可切换语言，偏好会记住</span>
        </div>
        <CodeTabs samples={samples} />
      </section>

      {/* 4. Parameters as tables */}
      <ParamTable title="请求头" params={extraHeaders} />
      <ParamTable title="路径参数" params={page.pathParams ?? []} />
      <ParamTable title="查询参数" params={page.query ?? []} />
      <ParamTable title="请求体" params={page.body ?? []} />

      {/* 5. Response */}
      {page.responseExample ? (
        <section className="docs-section">
          <h2>响应示例</h2>
          <CodeBlock
            code={page.responseExample}
            language={
              page.responseExample.trimStart().startsWith("{") ? "json" : "text"
            }
            title="Response"
          />
        </section>
      ) : null}

      <nav className="docs-pager" aria-label="相邻文档">
        {prev ? (
          <Link href={`/docs/api/${prev.slug}`} className="docs-pager-link prev">
            <ChevronLeft aria-hidden />
            <span>
              <em>上一篇</em>
              {prev.navTitle}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/docs/api/${next.slug}`} className="docs-pager-link next">
            <span>
              <em>下一篇</em>
              {next.navTitle}
            </span>
            <ChevronRight aria-hidden />
          </Link>
        ) : null}
      </nav>

      <p className="docs-brand-foot">
        <LogoMark size="sm" />
        <span>
          Reizo Docs · Base URL <code>{DOCS_BASE_URL}</code>
        </span>
      </p>
    </article>
  );
}
