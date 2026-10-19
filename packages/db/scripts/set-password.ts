// 重置某个账号的登录密码。
//
// 为什么需要它：seed 的 upsert 里 create 分支写 passwordHash，
// update 分支只改 role/status —— 所以「改了 .env 的 ADMIN_PASSWORD 再跑 seed」
// 对已存在的账号是不生效的，密码必须用这个脚本显式改。
//
// 用法（在仓库根目录，或 migrator 容器里）：
//   npm run db:set-password -w @nas/db -- <用户名> <新密码>
//   docker compose run --rm migrator npx tsx ../../scripts/set-password.ts admin '新密码'
//
// 参数里的密码不要带前后空格；含 $ # 空格 时务必用单引号包住。
import bcrypt from "bcryptjs";
import { prisma } from "../src";

async function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error("用法：set-password <用户名> <新密码>");
    process.exit(1);
  }
  if (password !== password.trim()) {
    console.error("新密码前后带了空格，去掉再试。");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("新密码至少 6 位。");
    process.exit(1);
  }

  // 用户名大小写不敏感，和登录时的查找方式保持一致
  const user = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
  });

  if (!user) {
    console.error(`找不到用户：${username}`);
    console.error("现有账号：");
    const all = await prisma.user.findMany({ select: { username: true, role: true, status: true } });
    for (const u of all) console.error(`  ${u.username}  ${u.role}  ${u.status}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, status: "ACTIVE" } });

  console.log(`已重置 ${user.username} 的密码，并确保账号为 ACTIVE。`);
  console.log("提示：登录后请尽快再改一次，避免长期使用这一初始密码。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());