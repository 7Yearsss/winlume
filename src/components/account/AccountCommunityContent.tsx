import Link from "next/link";
import { ArrowUpRight, Boxes, Wrench } from "lucide-react";
import { ConsolePage } from "@/components/console/ConsolePage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const collections = [
  {
    href: "/studio/skills",
    title: "角色技能",
    description: "去 Studio 里看可复用的工作流和提示词。",
    icon: Wrench,
  },
  {
    href: "/account/personalization",
    title: "偏好设置",
    description: "个人或工作区共享的默认指令和工具组合。",
    icon: Boxes,
  },
] as const;

export default function AccountCommunityContent() {
  return (
    <ConsolePage
      title="交流社区"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {collections.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <Card className="h-full transition hover:border-sky-300">
                <CardHeader>
                  <Icon className="size-4 text-ink-600" />
                  <CardTitle className="mt-2">{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-ink-700">
                    前往 <ArrowUpRight className="size-4" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </ConsolePage>
  );
}
