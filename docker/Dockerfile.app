# 通用应用镜像。
#
# 七个应用共用这一份 Dockerfile，用 --build-arg APP=<name> 指定构建哪个。
# 它们的差异全在源码里，维护七份几乎相同的构建脚本只会让它们慢慢跑偏。
# 注意 APP 是「apps/ 下的目录名」，与工作区包名不一定同名（见下面 WS 的映射）。
#
# 手动构建（在仓库根目录执行）：
#   docker build -f docker/Dockerfile.app --build-arg APP=bill -t nas-bill .
# 正常部署走 docker-compose.yml，不用手敲。

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ---------------------------------------------------------------- 依赖层
# 只拷贝清单文件。改业务源码不会让这一层失效，重建时能省掉几分钟。
# 新增工作区目录后记得在这里补一行，否则 npm ci 会因为缺少 workspace 报错。
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/auth/package.json packages/auth/
COPY packages/todo/package.json packages/todo/
COPY packages/notify/package.json packages/notify/
COPY packages/ui/package.json packages/ui/
COPY packages/media/package.json packages/media/
COPY apps/portal/package.json apps/portal/
COPY apps/todo/package.json apps/todo/
COPY apps/bill/package.json apps/bill/
COPY apps/anniversary/package.json apps/anniversary/
COPY apps/work/package.json apps/work/
COPY apps/pregnancy/package.json apps/pregnancy/
COPY apps/travel/package.json apps/travel/
COPY services/worker/package.json services/worker/
RUN npm ci

# ---------------------------------------------------------------- 构建层
FROM deps AS builder
ARG APP
COPY . .
# Prisma 产物在包内 generated/，不生成的话类型和运行时都会缺
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
# apps/todo 的工作区包名是 @nas/todo-app —— @nas/todo 已经被 packages/todo
# 占用了（它是待办引擎，不是应用）。其余应用目录名与包名一致。
RUN case "${APP}" in \
      todo) WS=@nas/todo-app ;; \
      *)    WS=@nas/${APP} ;; \
    esac \
 && npm run build -w "$WS"

# Next 15.5 的 standalone 追踪会漏掉 cache-dir.js 运行时依赖的 is-docker
# （它是个只有 package.json + index.js 的目录，追踪解析不到），
# 表现为容器一启动就报：
#   Error: Cannot find module 'next/dist/compiled/is-docker'
# 显式补进 standalone 产物。上游若已修复，这一步只是幂等覆盖；
# 若目录已不存在，也只是跳过，不让构建挂掉。
RUN SND="apps/${APP}/.next/standalone/node_modules/next/dist/compiled" \
 && mkdir -p "$SND" \
 && if [ -d node_modules/next/dist/compiled/is-docker ]; then \
      cp -r node_modules/next/dist/compiled/is-docker "$SND/"; \
      echo "已补齐 is-docker 到 standalone 产物"; \
    else \
      echo "next/dist/compiled/is-docker 不存在，跳过（上游可能已修复）"; \
    fi

# ---------------------------------------------------------------- 运行层
FROM base AS runner
ARG APP
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_NAME=${APP} \
    PORT=3000

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# standalone 产物以仓库根为 tracing root（见各应用的 outputFileTracingRoot），
# 所以结构是 <root>/apps/<app>/server.js，node_modules 在根上。
# 少了 --from=builder 里的这一份，运行时会报「找不到模块」。
COPY --from=builder --chown=nextjs:nodejs /app/apps/${APP}/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/${APP}/.next/static ./apps/${APP}/.next/static

USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "node apps/${APP_NAME}/server.js"]
