"use client";

import Link from "next/link";
import { Building2, CircleHelp } from "lucide-react";
import { ConsolePage } from "@/components/console/ConsolePage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The enterprise_billing_requests table was dropped with the billing-engine
 * cutover (server.ts submitEnterpriseBillingRequest always throws 410).
 * This page used to be a live application form; keep it as a clear, honest
 * "offline" notice instead of a form that always fails on submit.
 */
export default function AccountEnterpriseContent() {
  return (
    <ConsolePage
      title="对公结算"
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-ink-600" />
            <CardTitle>该功能暂时下线</CardTitle>
          </div>
          <CardDescription>
            自助申请入口暂不可用。如需对公开票、大额授信或线下签约，请联系人工处理。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/account/community">
              <CircleHelp data-icon="inline-start" />
              联系支持
            </Link>
          </Button>
        </CardContent>
      </Card>
    </ConsolePage>
  );
}
