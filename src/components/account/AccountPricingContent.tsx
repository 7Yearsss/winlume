import { CalendarClock, Gauge, Layers, Users } from "lucide-react";
import { ConsoleEmptyState, ConsolePage } from "@/components/console/ConsolePage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type AccountPricingStatus =
  | "unauthenticated"
  | "unconfigured"
  | "no_active_catalog"
  | "ready";

export type AccountPricingModelRow = {
  modelKey: string;
  mode: string;
  modelRatio: string | null;
  fixedPriceUsd: string | null;
  completionRatio: string | null;
  cacheReadRatio: string | null;
  cacheWriteRatio: string | null;
  cacheWriteOneHourRatio: string | null;
  imageRatio: string | null;
  audioInputRatio: string | null;
  audioCompletionRatio: string | null;
};

export type AccountPricingProps = {
  status: AccountPricingStatus;
  billingGroup?: string;
  userGroup?: string;
  /**
   * "api_key" means the billing group was resolved from the caller's own
   * api_key_billing_policies rows; "default" means no unambiguous per-user
   * billing group could be resolved and the page fell back to the
   * catalog's "default" group instead of guessing.
   */
  billingGroupSource?: "api_key" | "default";
  catalog?: {
    algorithmVersion: string;
    activatedAt: string | null;
    quotaPerUnit: string;
  };
  groupRatio?: string;
  models?: AccountPricingModelRow[];
};

const modeLabels: Record<string, string> = {
  ratio: "按量比例",
  fixed: "固定单价",
  tiered_expr: "阶梯表达式",
};

function ratio(value: string | null | undefined): string {
  if (value === null || value === undefined) return "--";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(parsed);
}

function date(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "--"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function AccountPricingContent({
  status,
  billingGroup,
  userGroup,
  billingGroupSource,
  catalog,
  groupRatio,
  models,
}: AccountPricingProps) {

  if (status === "unauthenticated") {
    return (
      <ConsolePage title="我的计费">
        <ConsoleEmptyState title="请先登录" description="登录后即可查看你的实际计费费率。" />
      </ConsolePage>
    );
  }

  if (status === "unconfigured") {
    return (
      <ConsolePage title="我的计费">
        <ConsoleEmptyState title="计费数据暂不可用" description="平台数据库尚未配置，请稍后重试。" />
      </ConsolePage>
    );
  }

  if (status === "no_active_catalog") {
    return (
      <ConsolePage title="我的计费">
        <ConsoleEmptyState title="暂无生效的计费目录" description="网关尚未激活任何计费目录版本，费率暂时无法展示。" />
      </ConsolePage>
    );
  }

  const isDefaultFallback = billingGroupSource === "default";

  return (
    <ConsolePage title="我的计费">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="flex flex-col gap-1">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-ink-500">计费组</p>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-canvas text-ink-600"><Users className="size-4" /></span>
              </div>
              <p className="mt-2 font-mono text-2xl font-semibold text-ink-950">{billingGroup}</p>
              <p className="mt-1 text-xs text-ink-500">用户组 {userGroup}</p>
            </CardContent>
          </Card>
          <StatTile label="组倍率" value={ratio(groupRatio)} hint="叠加在模型倍率之上" icon={Gauge} tone="primary" />
          <Card>
            <CardContent className="flex flex-col gap-1">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-ink-500">算法版本</p>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-canvas text-ink-600"><Layers className="size-4" /></span>
              </div>
              <p className="mt-2 font-mono text-2xl font-semibold text-ink-950">{catalog?.algorithmVersion ?? "--"}</p>
              <p className="mt-1 text-xs text-ink-500">生效于 {date(catalog?.activatedAt)}</p>
            </CardContent>
          </Card>
          <StatTile label="额度换算" value={ratio(catalog?.quotaPerUnit)} hint="每计价单位对应的额度" icon={CalendarClock} />
        </div>

        {isDefaultFallback ? (
          <div className="border border-dashed border-line-strong bg-canvas px-5 py-4 text-sm leading-6 text-ink-600">
            未能从你名下的 API密钥 计费策略中解析出唯一的计费组，以下展示的是目录的
            <span className="mx-1 font-mono text-ink-800">default</span>
            计费组费率，仅供参考，不代表你的账户一定按此计费。
          </div>
        ) : (
          <div className="border border-dashed border-line-strong bg-canvas px-5 py-4 text-sm leading-6 text-ink-600">
            以下费率基于你名下 API密钥 的计费策略解析得出。
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>模型费率</CardTitle>
            <CardDescription>
              仅展示对你的计费组开放的模型：enabled_groups 为空（对所有组开放）或包含
              <span className="mx-1 font-mono text-ink-700">{billingGroup}</span>
              的定价规则。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!models || models.length === 0 ? (
              <ConsoleEmptyState title="暂无可用模型定价" description="当前计费组下没有匹配的模型定价规则。" />
            ) : (
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>模型</TableHead>
                    <TableHead>计价方式</TableHead>
                    <TableHead className="text-right">模型倍率 / 固定单价</TableHead>
                    <TableHead className="text-right">输出倍率</TableHead>
                    <TableHead className="text-right">缓存读取</TableHead>
                    <TableHead className="text-right">缓存写入</TableHead>
                    <TableHead className="text-right">缓存写入(1h)</TableHead>
                    <TableHead className="text-right">图像</TableHead>
                    <TableHead className="text-right">音频输入</TableHead>
                    <TableHead className="text-right">音频输出</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model) => (
                    <TableRow key={model.modelKey}>
                      <TableCell className="font-mono text-xs text-ink-800">{model.modelKey}</TableCell>
                      <TableCell className="text-ink-700">{modeLabels[model.mode] ?? model.mode}</TableCell>
                      <TableCell className="text-right font-mono text-ink-800">
                        {model.mode === "fixed" ? ratio(model.fixedPriceUsd) : ratio(model.modelRatio)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-ink-700">{ratio(model.completionRatio)}</TableCell>
                      <TableCell className="text-right font-mono text-ink-700">{ratio(model.cacheReadRatio)}</TableCell>
                      <TableCell className="text-right font-mono text-ink-700">{ratio(model.cacheWriteRatio)}</TableCell>
                      <TableCell className="text-right font-mono text-ink-700">{ratio(model.cacheWriteOneHourRatio)}</TableCell>
                      <TableCell className="text-right font-mono text-ink-700">{ratio(model.imageRatio)}</TableCell>
                      <TableCell className="text-right font-mono text-ink-700">{ratio(model.audioInputRatio)}</TableCell>
                      <TableCell className="text-right font-mono text-ink-700">{ratio(model.audioCompletionRatio)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </ConsolePage>
  );
}
