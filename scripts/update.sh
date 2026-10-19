#!/usr/bin/env bash
#
# 增量更新：拉代码 → 重建 → 重启。首次部署用 scripts/setup-fnos.sh。
#
#   bash scripts/update.sh                 # 全量
#   bash scripts/update.sh bill            # 只重建账单
#   bash scripts/update.sh --no-build      # 只重启，不重建镜像
#   GIT_PROXY=http://192.168.1.2:7890 bash scripts/update.sh
#
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "未找到 docker"
docker compose version >/dev/null 2>&1 || die "未找到 docker compose v2"
command -v git >/dev/null || die "未找到 git"
[ -f docker-compose.yml ] || die "当前目录不是仓库根目录"
[ -f .env ] || die "缺少 .env，首次部署请先跑 scripts/setup-fnos.sh"

gitc=()
[ -n "${GIT_PROXY:-}" ] && gitc=(-c "http.proxy=$GIT_PROXY" -c "https.proxy=$GIT_PROXY")

log "拉取最新代码"
before="$(git rev-parse --short HEAD)"
git "${gitc[@]+"${gitc[@]}"}" pull --ff-only || die "git pull 失败；NAS 上若有本地改动先处理：git status"
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then
  log "已是最新（${after}）"
else
  log "已更新：$before → $after"
  git --no-pager log --oneline "$before".."$after" | sed 's/^/    /'
fi

NO_BUILD=0; SVC=()
for a in "$@"; do
  case "$a" in
    --no-build) NO_BUILD=1 ;;
    -*) die "未知参数：$a" ;;
    *) SVC+=("$a") ;;
  esac
done

# 小内存 NAS 默认串行构建，防 OOM
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"

# --build 不能省：修复常落在 builder 阶段（standalone 产物、依赖层），只 restart 无效
if [ "$NO_BUILD" = "1" ]; then
  log "跳过构建，仅重启"
  if [ ${#SVC[@]} -gt 0 ]; then docker compose up -d --no-build "${SVC[@]}"
  else docker compose up -d --no-build; fi
elif [ ${#SVC[@]} -gt 0 ]; then
  log "重建：${SVC[*]}"
  docker compose up -d --build "${SVC[@]}"
else
  log "重建全部（构建并发上限 ${COMPOSE_PARALLEL_LIMIT}）"
  docker compose build
  docker compose up -d
fi

log "当前状态"
docker compose ps

cat <<'TIP'
常用命令：
  docker compose logs -f <服务>        看日志
  docker compose restart <服务>        重启单个服务
反复重启 = 启动即崩，先停再看：docker compose stop <服务> && docker compose logs --tail=50 <服务>
TIP