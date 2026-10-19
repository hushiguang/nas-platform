# 家庭 NAS 一体化平台

门户 + 多应用的家庭自托管平台，跑在飞牛 fnOS 的 Docker 上。
一套代码、一个 PostgreSQL、一个入口端口。

## 应用一览

| 应用 | 说明 | 目录 |
|---|---|---|
| 门户 portal | 登录入口、应用导航、用户/应用/通知管理 | `apps/portal` |
| 家庭记账 bill | 流水、账本分摊、报表、导入导出 | `apps/bill` |
| 待办清单 todo | 个人/家庭共享清单、图片、统一提醒 | `apps/todo` |
| 纪念日 anniversary | 农历/公历倒计时 | `apps/anniversary` |
| 工作台 work | 项目、节点、进度、早晚汇总 | `apps/work` |
| 孕期待办 pregnancy | 全周期节点 | `apps/pregnancy` |
| 旅行足迹 travel | 城市、路线、相册 | `apps/travel` |

## 仓库结构

```
apps/         各应用（Next.js，standalone 产物）
packages/     共享包：db / auth / core / ui / notify / todo / media
services/     常驻进程：worker（定时任务）
docker/       Dockerfile.app / Dockerfile.worker
docs/         部署说明与迁移文档
```

## 快速开始

```bash
cp .env.example .env      # 填 PG_PASSWORD / AUTH_SECRET / 域名 等
./scripts/deploy.sh       # 构建并启动（等价于 docker compose up -d --build）
```

打开门户：直连 `http://<NAS_IP>:3210`，或经 Lucky 子域名访问 `http(s)://nav.<你的域名>`。

**完整部署步骤、子域名解析、备份与排错见 [`docs/部署说明.md`](docs/部署说明.md)。**

## 本地开发

```bash
npm install
npm run db:generate       # 生成 Prisma Client
npm run dev:portal        # 门户，http://localhost:3210
npm run dev:bill          # 账单，http://localhost:3211
# 其余：dev:todo / dev:anniversary / dev:work
npm run worker            # 定时任务
```

本地各应用共用仓库根目录的 `.env`（通过 `@next/env` 显式加载），
只需维护这一份。
