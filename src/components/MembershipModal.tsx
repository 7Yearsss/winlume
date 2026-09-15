"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Boxes,
  BriefcaseBusiness,
  Crown,
  Layers3,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Modal, { ModalCloseButton } from "./Modal";

type Cycle = "monthly" | "quarterly" | "yearly";

const cycleOptions: Array<{ id: Cycle; label: string; discount: number; hint?: string }> = [
  { id: "monthly", label: "月付", discount: 1 },
  { id: "quarterly", label: "季付", discount: 0.9, hint: "约 9 折" },
  { id: "yearly", label: "年付", discount: 0.83, hint: "约 83 折" },
];

const plans: Array<{ id: string; name: string; price: number; credits: string; topup: string; fit: string; featured?: boolean }> = [
  { id: "core", name: "Core 基础", price: 29, credits: "10,000", topup: "97.5 折", fit: "适合轻度体验用户" },
  { id: "plus", name: "Plus 进阶", price: 69, credits: "30,000", topup: "95 折", fit: "适合日常高频使用" },
  { id: "pro", name: "Pro 专业", price: 129, credits: "80,000", topup: "92.5 折", fit: "适合创作、办公与 Agent 工作流", featured: true },
  { id: "max", name: "Max 旗舰", price: 229, credits: "180,000", topup: "9 折", fit: "适合专业用户与小型团队" },
];

const benefitItems = [
  { icon: Layers3, label: "主流模型通用" },
  { icon: BriefcaseBusiness, label: "300+ AI Tools" },
  { icon: Sparkles, label: "2600+ Skills" },
  { icon: Boxes, label: "Agent 工作流" },
  { icon: BadgeCheck, label: "更高文件 / 图片额度" },
] as const;

export default function MembershipModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cycle, setCycle] = useState<Cycle>("quarterly");
  const selectedCycle = cycleOptions.find((item) => item.id === cycle) ?? cycleOptions[0];
  const period = cycle === "yearly" ? "年付折算月价" : cycle === "quarterly" ? "季付折算月价" : "每月";
  const cycleQuery = useMemo(() => new URLSearchParams({ cycle }).toString(), [cycle]);

  return (
    <Modal open={open} onClose={onClose} label="选择会员方案" size="onboarding">
      <section className="membership-dialog">
        <header className="membership-dialog-head">
          <div>
            <span><Crown aria-hidden /> REIZO MEMBERSHIP</span>
            <h2>选择适合你的会员方案</h2>
            <p>更高额度、更低加购价格，模型、工具、Skills 与 Agent 工作流通用。</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </header>

        <div className="membership-cycle" role="tablist" aria-label="续费周期">
          {cycleOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={cycle === option.id}
              className={cycle === option.id ? "is-active" : undefined}
              onClick={() => setCycle(option.id)}
            >
              {option.label}
              {option.hint ? <small>{option.hint}</small> : null}
            </button>
          ))}
        </div>

        <div className="membership-plan-grid">
          {plans.map((plan) => {
            const displayPrice = Math.round(plan.price * selectedCycle.discount);
            return (
              <article key={plan.id} className={plan.featured ? "is-featured" : undefined}>
                {plan.featured ? <span className="membership-popular">最受欢迎</span> : null}
                <h3>{plan.name}</h3>
                <p className="membership-price"><sup>¥</sup>{displayPrice}<small>/月</small></p>
                <p className="membership-period">{period}</p>
                <p className="membership-fit">{plan.fit}</p>
                <ul>
                  <li>每月包含 {plan.credits} Credits</li>
                  <li>Credits 加购 {plan.topup}</li>
                </ul>
                <Link
                  href={`/account/pricing?plan=${plan.id}&${cycleQuery}`}
                  className="membership-plan-action"
                  onClick={onClose}
                >
                  {plan.featured ? "立即开通" : `开通 ${plan.name.split(" ")[0]}`}
                </Link>
              </article>
            );
          })}
        </div>

        <div className="membership-benefits" aria-label="会员权益">
          {benefitItems.map(({ icon: Icon, label }) => <span key={label}><Icon aria-hidden />{label}</span>)}
        </div>
        <p className="membership-cancel"><ShieldCheck aria-hidden /> 实际价格与权益以结算页为准。</p>
      </section>
    </Modal>
  );
}
