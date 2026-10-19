import { NextResponse } from "next/server";
import { zonedDate, serviceGuard } from "@nas/core";
import { centsToYuan, monthTotals } from "@/server";

export const dynamic = "force-dynamic";

/**
 * 供门户首页汇总用的内部接口。
 *
 * 不面向浏览器、不走登录态 —— 只有拿着 SERVICE_TOKEN 的服务器能调。
 * 门户不去直读 bill_* 表，两边因此可以各自独立升级。
 *
 * 权限口径：这里一律按「普通成员」算，也就是只统计这个用户自己的账本。
 * 内部调用虽然是可信的，但没理由让它比本人看到的还多。
 */
export async function GET(req: Request) {
  const denied = serviceGuard(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const userId = Number(url.searchParams.get("userId"));
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ message: "缺少 userId" }, { status: 400 });
  }

  const today = zonedDate(new Date());
  const year = Number(url.searchParams.get("year")) || Number(today.slice(0, 4));
  const month = Number(url.searchParams.get("month")) || Number(today.slice(5, 7));

  const totals = await monthTotals({ id: userId, role: "MEMBER" }, year, month);

  return NextResponse.json({
    app: "bill",
    year,
    month,
    count: totals.count,
    expense: centsToYuan(totals.expenseCents),
    income: centsToYuan(totals.incomeCents),
  });
}
