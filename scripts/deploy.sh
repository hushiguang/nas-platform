#!/usr/bin/env bash
#
# 一键构建并启动。用法：
#   ./scripts/deploy.sh              # 构建全部并后台启动
#   ./scripts/deploy.sh bill         # 只重建某一个服务
#
# 构建默认串行（COMPOSE_PARALLEL_LIMIT=1），避免内存小的 NAS 上七个
# Next 应用并行构建把内存打满。机器够强可以 `COMPOSE_PARALLEL_LIMIT=4 ./scripts/deploy.sh`。
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker compose version >/dev/null 2>&1; then
  echo "未检测到 docker compose v2，请先在飞牛上安装/启用 Docker。" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "缺少 .env。先从样例复制一份并填写关键项：" >&2
  echo "  cp .env.example .env && \${EDITOR:-vi} .env" >&2
  exit 1
fi

export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"

if [ "$#" -gt 0 ]; then
  echo "==> 重建服务: $*"
  docker compose up -d --build "$@"
else
  echo "==> 构建全部镜像（串行上限 ${COMPOSE_PARALLEL_LIMIT}）"
  docker compose build
  echo "==> 启动"
  docker compose up -d
fi

echo "==> 当前状态"
docker compose ps
echo
echo "各应用端口：portal 3210 / bill 3211 / anniversary 3212 / work 3213 / pregnancy 3214 / travel 3215 / todo 3216"
echo "用 Lucky 按子域名反代到上面的端口即可；门户入口 => http://<NAS_IP>:3210"
echo "迁移/种子日志： docker compose logs -f migrator"
