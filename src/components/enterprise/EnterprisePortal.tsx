import Link from "next/link";
import { ArrowRight, Building2, Database, Factory, ShieldCheck, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { businessCases } from "@/data/audience";
import styles from "./enterprise-portal.module.css";
import EnterprisePageNav from "./EnterprisePageNav";
import EnterprisePageFooter from "./EnterprisePageFooter";

const outcomes = ["更少\n重复工作", "更短\n流程周期", "更低\n单位成本", "更快\n业务响应"];
const architecture = [
  { label: "企业数据与系统", icon: Database },
  { label: "Reizo AI 能力层", icon: Building2 },
  { label: "业务流程自动化", icon: Workflow },
  { label: "降本 · 提效 · 增长", icon: ArrowRight },
];

export default function EnterprisePortal() {
  return (
    <main className={`${styles.page} ${styles.fixedCanvas}`}>
      <EnterprisePageNav active="home" />

      <section className={styles.hero}>
        <div className={styles.waves} aria-hidden="true"><i /><i /><i /></div>
        <div className={styles.heroCopy}>
          <p>Every Business Will Run on AI.</p>
          <h1>把 AI 能力，转化为真实业务成果</h1>
          <span>Reizo 帮助企业构建专属 AI Agent，连接业务系统、部署私有知识库，<br />让 AI 真正融入业务流程，实现更低成本、更高效率与持续增长。</span>
          <div><Link className={styles.primary} href="/business/assessment">免费评估 AI 机会 <ArrowRight /></Link><Link className={styles.secondary} href="/business/deployment">查看企业解决方案</Link></div>
          <small>不是增加一个工具，而是升级企业的工作方式。</small>
        </div>
      </section>

      <section className={styles.architecture}>
        <div><p className={styles.eyebrow}>REIZO ENTERPRISE AI</p><h2>从模型能力，<br />到降本增效</h2><span>围绕企业的数据、系统与流程，交付可验证、可衡量、可持续优化的 AI 能力。</span></div>
        <ol>{architecture.map(({ label, icon: Icon }, index) => <li key={label}><Icon /><b>{label}</b>{index < architecture.length - 1 && <ArrowRight className={styles.connector} />}</li>)}</ol>
      </section>

      <section className={styles.outcomes}><p>用业务结果评价 AI，而不是用对话次数评价 AI。</p><div>{outcomes.map((outcome, index) => <article key={outcome}><strong>{outcome.split("\n")[0]}</strong><b>{outcome.split("\n")[1]}</b><span>{index === 3 ? "↑" : "↓"}</span></article>)}</div></section>

      <section className={styles.capabilities}>
        <Capability index="A." title="让 Agent 真正完成工作" text="识别任务、读取工具、连接数据并执行结果，让 AI 从回答问题走向完成流程。" links="任务编排 · 工具调用 · 人工审批" icon={<Workflow />} />
        <Capability index="B." title="让企业知识进入业务决策" text="连接文档、CRM、ERP、MES 等系统，梳理可检索、可引用、可持续更新的企业知识。" links="RAG · 系统集成 · 来源追溯" icon={<Database />} flip />
        <Capability index="C." title="让 AI 安全进入生产环境" text="支持企业级、私有云与本地部署，统一管理权限、日志和模型资产。" links="私有部署 · 权限治理 · 成本可控" icon={<ShieldCheck />} />
      </section>

      <section className={styles.delivery}><p className={styles.eyebrow}>REUSABLE DELIVERY</p><h2>企业项目不必每次从零开始</h2><span>复用能力平台与经验化组件，让成熟可复用的 Agent 与系统连接持续沉淀。</span><ol>{["摸底评测", "智能落地", "组件复用", "持续优化"].map((item, index) => <li key={item}><strong>0{index + 1}</strong><b>{item}</b>{index < 3 && <ArrowRight />}</li>)}</ol></section>

      <section className={styles.scenarios}><div className={styles.globe}><Factory /><span>高价值<br />业务场景</span></div><div><p className={styles.eyebrow}>INDUSTRY SOLUTIONS</p><h2>让 AI 进入高价值业务场景</h2><ul><li>贸易与财务 → 对账、票据与流程自动化</li><li>制造与物流 → 调度、知识与设备运维</li><li>医疗与专业服务 → 文档解析与辅助审核</li><li>企业运营 → 运营、营销与数据分析</li></ul><Link href="/business/cases">查看全部行业方案 <ArrowRight /></Link></div></section>

      <section className={styles.cases}><header><div><p className={styles.eyebrow}>CUSTOMER OUTCOMES</p><h2>从值得解决的问题开始</h2></div><Link href="/business/cases">查看客户案例 <ArrowRight /></Link></header><div>{businessCases.slice(0, 3).map((item) => <article key={item.id}><span>{item.industry}</span><h3>{item.client}</h3><p>{item.scenario}</p><strong>{item.outcome}</strong>{item.productId ? <Link className={styles.caseAction} href={`/products/${item.productId}`}>查看相关能力 <ArrowRight aria-hidden /></Link> : null}</article>)}</div></section>

      <section className={styles.cta}><p>Every Business Will Run on AI.</p><h2>让 AI 成为企业持续运行的能力</h2><span>不先推销模型。先确定问题是否值得用 AI 解决。</span><div><Link className={styles.primary} href="/business/assessment">免费评估 AI 机会 <ArrowRight /></Link><Link className={styles.secondary} href="/business/consultant">预约企业方案沟通</Link></div></section>
      <EnterprisePageFooter />
    </main>
  );
}

function Capability({ index, title, text, links, icon, flip }: { index: string; title: string; text: string; links: string; icon: ReactNode; flip?: boolean }) {
  return <article className={flip ? styles.flip : undefined}><div><p>{index}</p><h2>{title}</h2><span>{text}</span><b>{links}</b></div><div className={styles.capabilityVisual}>{icon}<i /><i /><i /></div></article>;
}
