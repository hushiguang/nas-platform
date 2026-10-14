// 种子数据：平台注册表 + 初始管理员。
// 幂等：重复执行不会产生重复数据（upsert）。
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// 应用注册表：nas-ledger 是已独立的应用，其余为 nas-platform 内部占位模块，
// 后续拆分出去时把 isExternal 改成 true 并填上 url 即可。
const PLATFORMS = [
  {
    code: "ledger",
    name: "家庭记账",
    description: "nas-ledger 流水与账单导入",
    icon: "💰",
    group: "财务",
    url: "http://100.112.52.24:8080",
    isExternal: true,
    sort: 1,
  },
  { code: "todo", name: "待办", description: "聚合待办与提醒", icon: "✅", group: "工具", url: null, isExternal: false, sort: 2 },
  { code: "bill", name: "账单", description: "账单与还款提醒（规划中）", icon: "🧾", group: "财务", url: null, isExternal: false, sort: 3 },
  { code: "anniversary", name: "纪念日", description: "生日/纪念日提醒", icon: "🎂", group: "生活", url: null, isExternal: false, sort: 4 },
  { code: "work", name: "工作", description: "项目节点与日报", icon: "💼", group: "工具", url: null, isExternal: false, sort: 5 },
  { code: "pregnancy", name: "孕期", description: "孕期记录与待办", icon: "🍼", group: "生活", url: null, isExternal: false, sort: 6 },
  { code: "travel", name: "旅行", description: "旅行相册与往年今日", icon: "✈️", group: "生活", url: null, isExternal: false, sort: 7 },
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
  const password = process.env.ADMIN_PASSWORD ?? "admin123";
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
  console.log(`管理员就绪：${admin.username}（初始密码见 ADMIN_PASSWORD，默认 admin123，请尽快修改）`);

  // 管理员默认可见全部平台、数据范围 ALL
  const platforms = await prisma.platform.findMany();
  for (const platform of platforms) {
    await prisma.userPlatform.upsert({
      where: { userId_platformId: { userId: admin.id, platformId: platform.id } },
      update: { dataScope: "ALL" },
      create: { userId: admin.id, platformId: platform.id, dataScope: "ALL" },
    });
  }
  console.log("管理员平台授权就绪");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
