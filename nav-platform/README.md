# 家庭 NAS 一体化平台

> Next.js 15 App Router + React 19 + TypeScript 全栈 + PostgreSQL
> 部署：飞牛 fnOS NAS / Docker Compose
> 需求与方案：`/Users/leo/WorkBuddy/NAS/docs/功能清单.md`、`技术方案.md`

## 结构

```
prisma/schema.prisma   单 schema，按模块分节（core / todo / anniversary / work / pregnancy / travel）
src/
  app/
    (auth)/login       登录页
    (portal)/          需登录区域
      page.tsx         应用门户 · 卡片式导航（外部独立应用 + 内部占位模块）
      admin/users/     用户管理（仅管理员）
      admin/users/[id]/   用户详情：应用授权 + 通知渠道
      admin/platforms/ 应用注册表管理（仅管理员）
    share/[token]/     对外只读分享页（免登录，P7）
    api/cron/[job]/    定时任务手动触发/补跑入口（CRON_SECRET 校验）
    share/[token]/     对外只读分享页（免登录，P7）
    api/cron/[job]/    定时任务手动触发/补跑入口（CRON_SECRET 校验）
  modules/
    core/auth          会话、登录/登出
    core/rbac          两层权限：应用可见性 + 数据范围（查询层兜底）+ 管理端 CRUD Action
    core/todo          待办引擎（幂等创建、提醒派发、逾期扫描、snooze、完成回写钩子）
    core/notify        通知网关：企微应用消息 / 邮件，入队+发送+失败重试
    core/portal        门户摘要：每个应用在首页卡片上展示最近数据
    bill|anniversary|work|pregnancy|travel/   业务域（随阶段填充）
  jobs/                定时任务注册表（web 与 worker 共用）
  lib/prisma.ts        Prisma 单例
  lib/time.ts          时区工具（Asia/Shanghai 下的日期/时刻/当天范围）
  middleware.ts        仅做粗粒度登录态判断（Edge 拿不到 DB）
worker/                独立定时任务进程（node-cron，方案 A）
```

**门户定位**：`/` 是应用启动器/汇总看板，每个应用本身独立部署（如 nas-ledger 已运行在 `100.112.52.24:8080`），点击卡片跳转；后续拆分时只需在「应用管理」里改 URL 与「外部」开关。

**主题**：与 nas-ledger（轻账单）保持一致——同一套配色变量、字体（Noto Sans SC 正文 + Source Serif 4 标题）、圆角与阴影，支持浅色 / 深色 / 跟随系统，定义在 `src/app/globals.css`。

**分层纪律**：业务模块之间不直接读对方的表，跨模块只通过 `modules/core` 的待办引擎和通知网关交互。

## 本地开发

```bash
cp .env.example .env        # 按需修改
docker compose up -d postgres        # 只起数据库
npm install
npm run db:migrate            # 建表（首次会生成 migration）
npm run db:seed               # 平台注册表 + 管理员（默认 admin/admin123）
npm run dev                   # web: http://localhost:3000
npm run worker                # 另一个终端：定时任务进程
```

手动触发某个任务：`curl -X POST "http://localhost:3000/api/cron/scan-overdue?secret=$CRON_SECRET"`
可选任务名：`refresh-countdown` / `generate-todos` / `scan-overdue` / `dispatch-reminders` /
`notify-retry` / `work-digest` / `pregnancy-daily` / `travel-onthisday` / `push-summary`

## 门户摘要（首页每个应用的最近数据）

首页卡片底部展示该应用最近的数据，顶部「今日概览」汇总关键指标。摘要按应用注册在
`src/modules/core/portal/summary.ts`，新增应用时加一个 loader 即可（遵循 `dataScope` 过滤）。

| 应用 | 卡片上展示 |
|---|---|
| 待办 | 待处理数 / 逾期数 + 最近 3 条（含今天/明天/N 天后/逾期 N 天） |
| 纪念日 | 总数 + 最近 3 个倒计时（农历暂按公历日期估算，P3 接 `lunar-javascript` 后精确） |
| 工作 | 进行中项目数 + 最近 3 个未完成节点 |
| 孕期 | 当前孕周 + 距预产期 + 最近 3 项未完成 |
| 旅行 | 去过城市数 + 最近 3 次行程 |
| 账单 | P4 迁移后展示 |
| 外部应用 | 如 ledger（记账）会聚合本平台相关的待办（例：账单待退款 / 待报销），点击仍跳回 nas-platform 的待办/账单页 |

摘要加载失败只影响单个卡片，不会拖垮首页。

> **平台互通说明**：各平台是独立 Docker 部署，但「后续动作 → 待办」统一收敛到 nas-platform 的待办引擎。
> 因此外部应用（ledger）的卡片上也能展示由它产生的账单类待办；点击这些待办会回到 nas-platform 处理。

卡片整块可点（标题链接 stretched 覆盖整卡），摘要里的每个条目、顶部「今日概览」的每个指标都是独立链接，
带记录定位参数（如 `/todos?todo=12`、`/work?project=3&node=8`），跳到对应平台后由该平台决定是否消费参数。
目前 `/todos` 已真实化（列表 + 筛选 + 完成 + `?todo=` 高亮），其余平台仍是占位页，等对应阶段接入后定位生效。

## 通知渠道配置

在 `.env` 里配好，再到「用户管理 → 用户详情 → 通知渠道」给对应用户启用并填收件标识：

| 渠道 | 环境变量 | 收件标识 |
|---|---|---|
| 企业微信应用消息 | `WECOM_CORP_ID` / `WECOM_CORP_SECRET` / `WECOM_AGENT_ID` | 企微 userid（留空取用户资料的 `wecomId`） |
| 邮件 | `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | 收件邮箱（留空取用户资料的 `email`） |

未配置时不会丢消息：发送失败会落 `notify_log`，按 1min → 5min → 25min 退避重试 3 次，补配后再跑一次
`notify-retry` 即可补发。

## 部署（飞牛 NAS）

1. 复制 `.env.example` 为 `.env`，填 `PG_PASSWORD` / `AUTH_SECRET`（`openssl rand -base64 32`）/ `CRON_SECRET`
2. `docker compose --profile migrate up -d --build`
   - `migrator` 先跑 `migrate deploy + seed`（幂等），成功后 `web` / `worker` 才启动
3. 访问 `http://nas-ip:3210`，用 `ADMIN_USERNAME/ADMIN_PASSWORD` 登录后立刻改密码
4. 外网访问用 Tailscale（compose 里有注释掉的示例），**不要把 3210 映射到公网**
5. 备份：飞牛定时任务 `pg_dump` 到 NAS 共享目录

## 关键约定

- **定时任务必须幂等**：待办生成用 `source + sourceBizId + triggerDate` 唯一键冲突忽略；通知用 `dedupeKey` 唯一，重复派发只入队一次
- **权限校验下沉**：middleware 只查 cookie；应用权限在 layout / Server Action 校验；数据范围在查询层强制拼 `ownerId`
- **应用是独立服务**：门户只做入口与权限，应用本身可以是外部地址，也可以先以内部占位页面存在
- **金额一律 `NUMERIC(12,2)`**（Prisma `Decimal`），禁止浮点
- **时区三处统一** `Asia/Shanghai`（web / worker / postgres）
- **照片目录只读挂载**，web 不写 NAS

## 实施路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 脚手架 + Prisma schema + Auth.js 登录 + Compose | ✅ 本次完成 |
| P1 | 权限管理 CRUD + 待办引擎完善 + 通知网关（企微/邮件） | ✅ 本次完成 |
| P2 | 门户看板卡片 + 待办平台 | 待做 |
| P3 | 纪念日平台（验证待办链路） | 待做 |
| P4 | 账单：路径 A 重构进新平台（等旧 SQLite 表结构，金额字段类型需确认） | 待做 |
| P5-P8 | 工作 / 孕期 / 旅行 / 打磨 | 待做 |

> 孕期为新模块（无历史数据），按上表顺序做即可，无需提前。
> 账单走路径 A（重构进新平台而非双写），开工前需提供旧库 `sqlite3 bills.db .schema` 与金额字段类型。
