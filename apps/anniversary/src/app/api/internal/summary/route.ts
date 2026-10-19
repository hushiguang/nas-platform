import { NextResponse } from "next/server";
import { serviceGuard } from "@nas/core";
import { upcomingAll, upcomingForUser, UPCOMING_DAYS } from "@/server";

export const dynamic = "force-dynamic";

/**
 * 供门户首页汇总用的内部接口。
 *
 * 不面向浏览器、不走登录态 —— 只有拿着 SERVICE_TOKEN 的服务器能调。
 * 默认只看这个用户自己的。`scope=all` 给管理员的待办页，看所有人今天到期的提醒。
 */
export async function GET(req: Request) {
  const denied = serviceGuard(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const scopeAll = url.searchParams.get("scope") === "all";
  const userId = Number(url.searchParams.get("userId"));
  if (!scopeAll && (!Number.isInteger(userId) || userId <= 0)) {
    return NextResponse.json({ message: "缺少 userId" }, { status: 400 });
  }

  const items = scopeAll ? await upcomingAll() : await upcomingForUser(userId);
  return NextResponse.json({
    app: "anniversary",
    withinDays: UPCOMING_DAYS,
    count: items.length,
    items: (scopeAll ? items : items.slice(0, 8)).map((item) => ({
      id: item.id,
      name: item.name,
      days: item.occurrence.days,
      when: item.occurrence.elapsedText
        ? [item.occurrence.elapsedText, item.occurrence.cycleText].filter(Boolean).join(" · ")
        : item.occurrence.date
          ? `${item.occurrence.countdown} · ${item.occurrence.when.replace("下次 ", "")}`
          : item.occurrence.countdown,
      bills: item.bills.map((bill) => ({
        label: bill.year ? `${bill.year} ${bill.label}` : bill.label,
        href: bill.href,
        createdAt: bill.createdAt.toISOString(),
      })),
    })),
  });
}
