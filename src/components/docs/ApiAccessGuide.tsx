import Link from "next/link";
import { ArrowRight, Bot, Boxes, CheckCircle2, Code2, KeyRound, Layers3, Workflow } from "lucide-react";

const entries = [
  { icon: Code2, title: "API 模型", copy: "统一接入语言、图像、视频、音频、RAG 与检索模型。", href: "/products?cate=api" },
  { icon: Boxes, title: "应用工具", copy: "面向业务人员的一键式 AI 工具，开箱即用。", href: "/products?cate=app" },
  { icon: Bot, title: "Agent 工作台", copy: "组合模型与 Skills，创建可持续迭代的工作流。", href: "/studio" },
];

export default function ApiAccessGuide() {
  return (
    <article className="api-guide">
      <section className="api-guide-hero">
        <p>GETTING STARTED</p>
        <h1>接入 REIZO</h1>
        <h2>通过 API、应用工具或 Agent 工作台，快速使用 AI 能力。</h2>
        <div className="api-guide-actions">
          <Link href="/account/keys">立即开始 <ArrowRight aria-hidden /></Link>
          <Link href="/docs/api" className="is-secondary">查看 API 参考</Link>
        </div>
      </section>

      <section className="api-guide-entry-grid">
        {entries.map(({ icon: Icon, title, copy, href }) => (
          <Link key={title} href={href} className="api-guide-entry">
            <Icon aria-hidden /><strong>{title}</strong><span>{copy}</span><ArrowRight aria-hidden />
          </Link>
        ))}
      </section>

      <section className="api-guide-section">
        <h2>快速开始</h2>
        <div className="api-guide-steps">
          {["选择入口", "获取 API密钥", "按需扩展"].map((title, index) => (
            <div key={title}><em>0{index + 1}</em><strong>{title}</strong><span>{index === 0 ? "按任务选择模型、工具或 Agent。" : index === 1 ? "在控制台创建密钥并妥善保存。" : "根据业务需要增加模型与工作流。"}</span></div>
          ))}
        </div>
      </section>

      <section className="api-guide-section">
        <h2>核心配置</h2>
        <div className="api-guide-config">
          <dl>
            <div><dt>Base URL</dt><dd>https://api.reizo.ai/v1</dd></div>
            <div><dt>API密钥</dt><dd>在个人中心生成</dd></div>
            <div><dt>协议</dt><dd>OpenAI Compatible</dd></div>
          </dl>
          <pre><code>{`curl https://api.reizo.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $REIZO_API_KEY" \\
  -d '{"model":"your-model","messages":[{"role":"user","content":"你好"}]}'`}</code></pre>
        </div>
      </section>

      <section className="api-guide-section api-guide-who">
        <h2>适合谁使用</h2>
        {["开发者", "团队用户", "运营与专业岗位"].map((item) => <div key={item}><CheckCircle2 aria-hidden /><strong>{item}</strong><span>统一能力入口、清晰用量与可持续扩展。</span></div>)}
      </section>

      <section className="api-guide-cta">
        <Layers3 aria-hidden /><div><h2>开始接入 REIZO</h2><p>选择最适合你的方式，开启 AI 生产力之旅。</p></div>
        <Link href="/account/keys"><KeyRound aria-hidden />进入控制台</Link>
        <Link href="/studio" className="is-secondary"><Workflow aria-hidden />体验工作台</Link>
      </section>
    </article>
  );
}
