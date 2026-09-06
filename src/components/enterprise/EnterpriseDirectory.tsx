import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, Database, ShieldCheck, Users, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { businessCases } from "@/data/audience";
import styles from "./enterprise-portal.module.css";
import EnterprisePageNav from "./EnterprisePageNav";
import EnterprisePageFooter from "./EnterprisePageFooter";

type DirectoryKind = "capabilities" | "cases" | "deployment" | "consultant";
const pages = {
  capabilities: { eyebrow: "BUSINESS CAPABILITIES", title: "让企业 AI 真正进入业务流程", copy: "从 Agent 执行、企业知识到安全治理，把模型能力转换为可衡量的业务结果。" },
  cases: { eyebrow: "CUSTOMER OUTCOMES", title: "从值得解决的问题开始", copy: "先定义业务结果，再选择适合的能力与交付路径。" },
  deployment: { eyebrow: "ENTERPRISE DEPLOYMENT", title: "为企业选择可持续的 AI 部署方式", copy: "围绕数据边界、系统连接和治理要求，构建稳定可控的生产能力。" },
  consultant: { eyebrow: "CONSULTING", title: "从一个具体问题，开始企业 AI 方案", copy: "由咨询专员协助梳理场景、约束和第一阶段的可交付结果。" },
} as const;
export default function EnterpriseDirectory({ kind }: { kind: DirectoryKind }) {
  const page = pages[kind];
  return <main className={`${styles.directory} ${styles.fixedCanvas}`}><EnterprisePageNav active={kind} /><section className={styles.directoryHero}><p className={styles.eyebrow}>{page.eyebrow}</p><h1>{page.title}</h1><span>{page.copy}</span><Link className={styles.primary} href="/business/assessment">免费评估 AI 机会 <ArrowRight /></Link></section>{kind === "cases" ? <CaseGrid /> : <InfoGrid kind={kind} />}<section className={styles.cta}><p>Every Business Will Run on AI.</p><h2>先看清问题，再开始落地。</h2><div><Link className={styles.primary} href="/business/assessment">开始 AI 评估 <ArrowRight /></Link><Link className={styles.secondary} href="/business/consultant">预约方案沟通</Link></div></section><EnterprisePageFooter /></main>;
}
function CaseGrid(){return <section className={styles.caseGrid}>{businessCases.map(item=><article key={item.id}><span>{item.industry}</span><h2>{item.client}</h2><p>{item.scenario}</p><strong>{item.outcome}</strong>{item.productId ? <Link className={styles.caseAction} href={`/products/${item.productId}`}>查看相关能力 <ArrowRight aria-hidden /></Link> : null}</article>)}</section>}
type InfoItem = { icon: LucideIcon; title: string; copy: string };
const infoByKind: Record<Exclude<DirectoryKind, "cases">, InfoItem[]> = {
  capabilities: [{ icon: Workflow, title: "Agent 执行与编排", copy: "让任务、工具与人工审批形成可观测流程" }, { icon: Database, title: "知识与系统连接", copy: "让数据、文档与业务系统成为可用上下文" }, { icon: ShieldCheck, title: "安全与治理", copy: "权限、审计、部署和成本始终可控" }],
  deployment: [{ icon: Building2, title: "私有化部署", copy: "支持私有云、本地和混合部署模式" }, { icon: Database, title: "系统集成", copy: "对接 CRM、ERP、MES 与内部数据服务" }, { icon: ShieldCheck, title: "合规治理", copy: "覆盖权限、日志、审计与模型资产管理" }],
  consultant: [{ icon: Users, title: "场景共创", copy: "把模糊需求收敛成可验证的业务问题" }, { icon: Workflow, title: "试点设计", copy: "在 4–8 周内交付首个生产场景" }, { icon: CheckCircle2, title: "持续陪跑", copy: "把试点结果沉淀为可复用企业能力" }],
};
function InfoGrid({kind}:{kind:Exclude<DirectoryKind,"cases">}){return <section className={styles.infoGrid}>{infoByKind[kind].map(({ icon: Icon, title, copy })=><article key={title}><Icon aria-hidden /><h2>{title}</h2><p>{copy}</p></article>)}</section>}
