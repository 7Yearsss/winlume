import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CircleDollarSign,
  KeyRound,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import PortalPricingShell from "@/components/PortalPricingShell";
import { categoriesByCate } from "@/data/taxonomy";
import { productsByCategory, type Pricing } from "@/data/products";

export const metadata: Metadata = { title: "计费标准 - Reizo" };

const principles = [
  { icon: CircleDollarSign, title: "按实际用量结算", desc: "模型按 Token、工具按调用量计费；没有席位费与最低消费。" },
  { icon: WalletCards, title: "一个余额，全站通用", desc: "模型 API、AI 应用和工作台共用一个账户余额，明细集中查看。" },
  { icon: ReceiptText, title: "调用记录可追溯", desc: "每次扣费都能在用量明细中查询，便于个人和团队核对成本。" },
];

function pricingLabel(pricing: Pricing) {
  if (pricing.kind === "token") return `输入 ${pricing.input} · 输出 ${pricing.output} / 1M Token`;
  if (pricing.kind === "unit") return pricing.price;
  return pricing.label;
}

export default function PricingPage() {
  const apiCats = categoriesByCate("api");
  const appCat = categoriesByCate("app")[0];
  const sections = appCat ? [...apiCats, appCat] : apiCats;

  return (
    <PortalPricingShell>
      <div className="portal-pricing-page">
        <section className="portal-pricing-hero" aria-labelledby="pricing-title">
          <div className="portal-pricing-hero-copy">
            <p className="portal-eyebrow">BILLING / PRICING</p>
            <h1 id="pricing-title">价格透明，<br />每次使用都有数。</h1>
            <p>用同一份余额连接模型、应用与工作台。先体验，再按真实调用量结算；成本、余额与记录都在账户里清楚可见。</p>
            <div className="portal-pricing-hero-actions">
              <Link href="/account/wallet" className="portal-pricing-primary-action"><WalletCards aria-hidden />充值余额</Link>
              <Link href="/account/usage" className="portal-pricing-secondary-action">查看用量明细<ArrowRight aria-hidden /></Link>
            </div>
          </div>
          <div className="portal-pricing-orbit" aria-hidden>
            <span className="portal-pricing-orbit-core">¥</span>
            <span className="portal-pricing-orbit-ring portal-pricing-orbit-ring-one" />
            <span className="portal-pricing-orbit-ring portal-pricing-orbit-ring-two" />
            <span className="portal-pricing-orbit-dot portal-pricing-orbit-dot-one" />
            <span className="portal-pricing-orbit-dot portal-pricing-orbit-dot-two" />
          </div>
        </section>

        <section className="portal-pricing-principles" aria-label="计费原则">
          {principles.map((item) => <article key={item.title}><item.icon aria-hidden /><div><h2>{item.title}</h2><p>{item.desc}</p></div></article>)}
        </section>

        <section className="portal-pricing-catalog" aria-labelledby="pricing-catalog-title">
          <div className="portal-pricing-section-head"><div><p className="portal-eyebrow">PRICE CATALOG</p><h2 id="pricing-catalog-title">按能力选择，再看价格</h2><p>目录展示价格仅作产品选型参考，实际结算以账户用量与网关实时规则为准。</p></div><Link href="/account/keys" className="portal-pricing-key-link"><KeyRound aria-hidden />管理 API密钥</Link></div>
          <nav className="portal-pricing-anchors" aria-label="价格分类">{sections.map((category) => <a key={category.slug} href={`#${category.slug}`}><span style={{ backgroundColor: category.color }} />{category.name}</a>)}</nav>
          <div className="portal-pricing-tables">
            {sections.map((category) => {
              const list = productsByCategory(category.slug);
              if (list.length === 0) return null;
              return <section key={category.slug} id={category.slug} className="portal-pricing-group"><div className="portal-pricing-group-head"><span style={{ color: category.color, backgroundColor: `${category.color}18` }}><category.icon aria-hidden /></span><div><h3>{category.name}</h3><p>{list.length} 项可用能力</p></div></div><div className="portal-pricing-table-wrap"><table><thead><tr><th>能力</th><th>提供方</th><th>参考计费</th><th><span className="sr-only">查看详情</span></th></tr></thead><tbody>{list.map((product) => <tr key={product.id}><td><Link href={`/products/${product.id}`}>{product.name}</Link><p>{product.tagline}</p></td><td>{product.brand}</td><td className="portal-pricing-value">{pricingLabel(product.pricing)}</td><td><Link href={`/products/${product.id}`} aria-label={`查看 ${product.name} 详情`}><ArrowRight aria-hidden /></Link></td></tr>)}</tbody></table></div></section>;
            })}
          </div>
        </section>

        <section className="portal-pricing-bottom" aria-label="开始使用"><BadgeCheck aria-hidden /><div><p>需要先试一试？</p><h2>从工作台开始，不必先决定套餐。</h2></div><Link href="/studio">进入工作台<ArrowRight aria-hidden /></Link></section>
      </div>
    </PortalPricingShell>
  );
}
