// 种子数据：平台注册表 + 初始管理员。
// 幂等：重复执行不会产生重复数据（upsert）。
import bcrypt from "bcryptjs";
import { prisma } from "../src";

// 应用注册表。code 必须与 apps/ 下的目录名一致 —— packages/core 的
// appBaseUrl(code) 按这个名字拼 *_BASE_URL，门户卡片也按它渲染。
// url 留 null 时门户回退到环境变量里配的地址。
const PLATFORMS = [
  { code: "portal", name: "应用门户", description: "导航、用户与应用管理、待办汇总", icon: "🏠", group: "系统", url: null, isExternal: false, sort: 1 },
  { code: "todo", name: "待办清单", description: "随手记一笔、清单分类、图片与统一提醒", icon: "✅", group: "生活", url: null, isExternal: false, sort: 2 },
  { code: "bill", name: "家庭记账", description: "流水、账本分摊与报表", icon: "💰", group: "财务", url: null, isExternal: false, sort: 3 },
  { code: "anniversary", name: "纪念日", description: "农历与公历倒计时", icon: "🎂", group: "生活", url: null, isExternal: false, sort: 4 },
  { code: "work", name: "工作台", description: "项目、节点、进度与早晚汇总", icon: "💼", group: "工具", url: null, isExternal: false, sort: 5 },
  { code: "pregnancy", name: "孕期待办", description: "全周期节点与每日状态", icon: "🍼", group: "生活", url: null, isExternal: false, sort: 6 },
  { code: "travel", name: "旅行足迹", description: "城市、路线、相册与往年今日", icon: "✈️", group: "生活", url: null, isExternal: false, sort: 7 },
];

async function main() {
  for (const p of PLATFORMS) {
    await prisma.platform.upsert({
      where: { code: p.code },
      update: { name: p.name, sort: p.sort },
      create: p,
    });
  }
  console.log(`平台注册表就绪：${PLATFORMS.length} 个`);

  const username = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("未设置 ADMIN_PASSWORD，拒绝用默认密码创建管理员。请在 .env 里配置后再运行 seed。");
  }
  // 先看账号在不在，才能说清这次到底是「建了」还是「只更新了角色」。
  // update 分支故意不动 passwordHash —— 免得每次部署把你界面上改过的密码冲掉；
  // 但这意味着「改了 .env 的 ADMIN_PASSWORD 再跑 seed」对已存在的账号是不生效的。
  // 不提示的话很容易白折腾：密码明明改过，却怎么也登不进去。
  const existed = await prisma.user.findUnique({ where: { username }, select: { id: true } });

  const admin = await prisma.user.upsert({
    where: { username },
    update: { role: "ADMIN", status: "ACTIVE" },
    create: {
      username,
      nickname: "管理员",
      passwordHash: await bcrypt.hash(password, 10),
      role: "ADMIN",
    },
  });

  if (existed) {
    console.log(`管理员 ${admin.username} 已存在，本次只更新了角色/状态，未改动密码。`);
    console.log(`如需重置密码：npm run set-password -w @nas/db -- ${username} '新密码'`);
  } else {
    console.log(`管理员已创建：${admin.username}（密码取自 ADMIN_PASSWORD，请尽快修改）`);
  }

  // 所有启用中的用户都要有应用授权，否则门户首页是空的。
  // 从旧库迁过来的账户当年没有这套授权表，这里补齐。
  // 管理员看全部数据，普通成员只看自己的。
  const platforms = await prisma.platform.findMany();
  const users = await prisma.user.findMany({ where: { status: "ACTIVE" } });
  let granted = 0;
  for (const user of users) {
    const scope = user.role === "ADMIN" ? "ALL" : "SELF";
    for (const platform of platforms) {
      await prisma.userPlatform.upsert({
        where: { userId_platformId: { userId: user.id, platformId: platform.id } },
        update: { dataScope: scope },
        create: { userId: user.id, platformId: platform.id, dataScope: scope },
      });
      granted += 1;
    }
  }
  console.log(`应用授权就绪：${users.length} 个用户 / ${granted} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
