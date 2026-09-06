import EnterpriseAssessment from "@/components/enterprise/EnterpriseAssessment";
import EnterprisePageNav from "@/components/enterprise/EnterprisePageNav";
import EnterprisePageFooter from "@/components/enterprise/EnterprisePageFooter";
import styles from "@/components/enterprise/enterprise-portal.module.css";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function BusinessAssessmentPage() { return <main className={`${styles.directory} ${styles.fixedCanvas}`}><EnterprisePageNav active="assessment" /><section className={styles.directoryHero}><p className={styles.eyebrow}>AI READINESS</p><h1>从一个业务问题，开始 AI 评估。</h1><span>回答几个与流程、数据和约束有关的问题，获得第一阶段的建议与 90 天推进方向。</span></section><section className={styles.assessmentShell}><EnterpriseAssessment /></section><section className={styles.cta}><p>准备好讨论第一个场景了吗？</p><h2>带着评估结果，开始方案沟通。</h2><span>先明确目标、约束与可验证结果，再决定试点范围。</span><div><Link className={styles.primary} href="/business/consultant?source=assessment">预约方案沟通 <ArrowRight /></Link><Link className={styles.secondary} href="/business/cases">查看客户案例</Link></div></section><EnterprisePageFooter /></main>; }
