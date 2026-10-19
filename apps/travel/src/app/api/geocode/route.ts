import { NextResponse } from "next/server";
import { getSessionUser } from "@/auth";
import { geocode, TravelError } from "@/server";

export const dynamic = "force-dynamic";

/** 地名 → 坐标。需要配置 AMAP_WEB_KEY；没配就提示手动填。 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const name = new URL(req.url).searchParams.get("name") || "";
  try {
    return NextResponse.json(await geocode(name));
  } catch (err) {
    if (err instanceof TravelError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: "查询失败" }, { status: 500 });
  }
}
