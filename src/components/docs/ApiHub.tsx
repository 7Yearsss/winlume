import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";
import {
  apiCategories,
  DOCS_API_KEY_ENV,
  DOCS_BASE_URL,
} from "@/data/docs/api-catalog";

const quickLinks = [
  {
    method: "GET",
    path: "/v1/models",
    title: "模型列表",
    href: "/docs/api/ai-model/models/list/listmodels",
  },
  {
    method: "POST",
    path: "/v1/chat/completions",
    title: "对话补全",
    href: "/docs/api/ai-model/chat/openai/createchatcompletion",
  },
  {
    method: "POST",
    path: "/v1/embeddings",
    title: "文本嵌入",
    href: "/docs/api/ai-model/embeddings/createembedding",
  },
  {
    method: "POST",
    path: "/v1/images/generations",
    title: "图像生成",
    href: "/docs/api/ai-model/images/openai/post-v1-images-generations",
  },
] as const;

export function ApiHub() {
  return (
    <div className="docs-page">
      <header className="docs-page-head docs-home-hero">
        <div className="docs-home-hero-copy">
        <p className="docs-eyebrow">WINLUME DEVELOPER HUB</p>
        <h1>从模型到 API，一处接入</h1>
        <p className="docs-lead">
          OpenAI 兼容的 HTTP 接口。鉴权使用 Bearer Token，经 Reizo 网关做校验、路由与计费。
        </p>
        <div className="docs-home-actions">
          <Link href="/account/keys" className="docs-btn primary"><KeyRound aria-hidden />创建 API密钥</Link>
          <Link href="/products?cate=api" className="docs-btn">查看模型目录<ArrowRight aria-hidden /></Link>
        </div>
        </div>
        <div className="docs-home-hero-orbits" aria-hidden><i /><i /><i /></div>
      </header>

      <section className="docs-section docs-section-tight">
        <div className="docs-hub-facts">
          <div>
            <span>Base URL</span>
            <code>{DOCS_BASE_URL}</code>
          </div>
          <div>
            <span>Authorization</span>
            <code>{`Bearer $${DOCS_API_KEY_ENV}`}</code>
          </div>
        </div>
      </section>

      <section className="docs-section">
        <h2>接入步骤</h2>
        <ol className="docs-steps">
          <li>
            在 <Link href="/account/keys">API密钥</Link> 创建密钥
          </li>
          <li>
            设置环境变量 <code>{DOCS_API_KEY_ENV}</code>
          </li>
          <li>
            请求 <code>GET {DOCS_BASE_URL}/v1/models</code> 确认连通
          </li>
          <li>
            调用 <code>POST /v1/chat/completions</code> 发起对话
          </li>
        </ol>
        <pre className="docs-inline-sample">{`curl ${DOCS_BASE_URL}/v1/models \\
  -H "Authorization: Bearer $${DOCS_API_KEY_ENV}"`}</pre>
      </section>

      <section className="docs-section">
        <h2>常用接口</h2>
        <div className="docs-quick-list">
          {quickLinks.map((item) => (
            <Link key={item.href} href={item.href} className="docs-quick-row">
              <span className={`docs-method docs-method-${item.method.toLowerCase()}`}>
                {item.method}
              </span>
              <code>{item.path}</code>
              <span className="docs-quick-title">{item.title}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="docs-section">
        <h2>全部能力</h2>
        <div className="docs-card-grid">
          {apiCategories.map((cat) => {
            const first = cat.pages[0];
            return (
              <Link
                key={cat.id}
                href={first ? `/docs/api/${first.slug}` : "/docs/api"}
                className="docs-card"
              >
                <div className="docs-card-top">
                  <h3>
                    {cat.title}
                    <em>({cat.titleEn})</em>
                  </h3>
                  <span className="docs-card-meta">{cat.pages.length}</span>
                </div>
                <p>{cat.description}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
