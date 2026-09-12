"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Rate = { name: string; mode: "tokens" | "fixed"; input: number; output: number; price: number; groups: string[]; revision: string };
type Catalog = { models: Rate[]; groups: Record<string, number> };

export default function ModelPricingDialog({ vendor, onClose }: {
  vendor: { name: string; models: Array<{ name: string }> };
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState(vendor.models[0]?.name ?? "");
  const [mode, setMode] = useState("tokens");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const rate = catalog?.models.find(row => row.name === selected);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/admin/model-pricing", { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "读取定价失败"); setCatalog(body); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    setMode(rate?.mode ?? "tokens");
    setInput(rate ? String(rate.input) : "");
    setOutput(rate ? String(rate.output) : "");
    setPrice(rate ? String(rate.price) : "");
  }, [rate]);
  async function save() {
    const fields = mode === "fixed" ? [price] : [input, output];
    if (fields.some(value => value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) {
      setError("请填写有效的非负单价。"); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/model-pricing", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: selected, mode, input: Number(input), output: Number(output), price: Number(price), revision: rate?.revision }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      setNotice(`${selected} 定价已生效，门户展示与后续调用扣费同步更新。`);
      setReload(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败，请重新读取核对费率。"); }
    finally { setSaving(false); }
  }
  const fieldClass = "h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{vendor.name} · 模型定价</DialogTitle><DialogDescription>直接修改实际计费服务的基础价格，以美元（USD）计价。相同模型在所有入口共用，最终费用按调用分组倍率计算。</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm">选择模型<select className={fieldClass} value={selected} disabled={saving} onChange={event => { setSelected(event.target.value); setNotice(""); }}>
        {vendor.models.map(model => <option key={model.name} value={model.name}>{model.name}</option>)}
      </select></label>
      {loading ? <p role="status">正在读取实际费率…</p> : rate ? <>
        <label className="grid gap-2 text-sm">计费方式<select className={fieldClass} value={mode} disabled={saving} onChange={event => setMode(event.target.value)}><option value="tokens">按 Token 计费</option><option value="fixed">按次计费</option></select></label>
        {mode === "tokens" ? <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-2 text-sm">输入单价（$/1M tokens）<input className={fieldClass} type="number" min="0" max="1000000" step="any" value={input} disabled={saving} onChange={event => setInput(event.target.value)} /></label>
          <label className="grid gap-2 text-sm">输出单价（$/1M tokens）<input className={fieldClass} type="number" min="0" max="1000000" step="any" value={output} disabled={saving} onChange={event => setOutput(event.target.value)} /></label>
        </div> : <label className="grid gap-2 text-sm">每次调用价格（$/次）<input className={fieldClass} type="number" min="0" max="1000000" step="any" value={price} disabled={saving} onChange={event => setPrice(event.target.value)} /></label>}
        <p className="text-xs text-muted-foreground">适用分组：{rate.groups.map(group => `${group}（×${catalog?.groups[group] ?? "按分组配置"}）`).join("、") || "按渠道分组配置"}。缓存、音频等专用倍率沿用现有配置。</p>
      </> : catalog && <p className="text-sm text-muted-foreground">该模型尚未出现在实际计费目录中，请先在 new-api 配置模型渠道。</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving || loading} onClick={() => setReload(value => value+1)}>重新读取</Button><Button disabled={saving || loading || !rate} onClick={() => void save()}>{saving ? "正在同步…" : "保存并生效"}</Button></div>
    </DialogContent>
  </Dialog>;
}
