#!/usr/bin/env bash
#
# 家庭 NAS 一体化平台 · 飞牛 fnOS 一次性部署脚本
#
# 用法（在飞牛的 SSH 里执行任意一种）：
#   1) 仓库已在 NAS 上：        bash scripts/setup-fnos.sh
#   2) 全新机器，直接跑本脚本： bash setup-fnos.sh   （脚本会自动 git clone）
#
# 目录规划（默认）：
#   /vol1/1000/docker/nas-platform/
#   ├── app/        代码（本仓库）
#   ├── pgdata/     PostgreSQL 数据
#   ├── bill/       账单票据照片（读写）
#   ├── travel/     旅行相册（只读，把照片放这里）
#   └── todo/       待办本地图片（没配图床时才用）
#
# 可用环境变量覆盖（可选）：
#   REPO_URL      仓库地址，默认 https://github.com/hushiguang/nas-platform.git
#   INSTALL_DIR   代码目录，默认 /vol1/1000/docker/nas-platform/app
#   NAS_DATA_ROOT 数据根目录，默认 /vol1/1000/docker/nas-platform
#   GIT_PROXY     克隆/拉取时走的代理，如 http://192.168.1.2:7890（国内克隆 GitHub 常用）
#
# 例：GIT_PROXY=http://192.168.1.2:7890 bash setup-fnos.sh
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/hushiguang/nas-platform.git}"
NAS_DATA_ROOT="${NAS_DATA_ROOT:-/vol1/1000/docker/nas-platform}"
INSTALL_DIR="${INSTALL_DIR:-$NAS_DATA_ROOT/app}"
GIT_PROXY="${GIT_PROXY:-}"

c_bold=$'\033[1m'; c_cyan=$'\033[1;36m'; c_red=$'\033[1;31m'; c_off=$'\033[0m'
log() { printf '\n%s==> %s%s\n' "$c_cyan" "$*" "$c_off"; }
die() { printf '\n%s[错误] %s%s\n' "$c_red" "$*" "$c_off" >&2; exit 1; }

# ---------------------------------------------------------------- 0. 前置检查
log "前置检查"
command -v docker >/dev/null 2>&1 || die "未找到 docker，请先在飞牛「应用中心」安装 Docker。"
docker compose version >/dev/null 2>&1 || die "未找到 docker compose v2，请升级 Docker/Compose（需要 v2）。"
command -v git >/dev/null 2>&1 || die "未找到 git，请先安装 git。"
command -v openssl >/dev/null 2>&1 || die "未找到 openssl，请先安装 openssl。"
echo "docker / compose / git / openssl 均就绪。"

gitc=()
if [ -n "$GIT_PROXY" ]; then
  gitc=(-c "http.proxy=$GIT_PROXY" -c "https.proxy=$GIT_PROXY")
  echo "已启用 git 代理：$GIT_PROXY"
fi

# ---------------------------------------------------------------- 1. 定位代码
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../docker-compose.yml" ]; then
  # 从已克隆的仓库里运行
  INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  log "使用当前仓库：$INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  log "目录已存在，拉取最新代码：$INSTALL_DIR"
  git -C "$INSTALL_DIR" "${gitc[@]}" pull --ff-only
else
  log "克隆仓库到 $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git "${gitc[@]}" clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ---------------------------------------------------------------- 2. 生成 .env
if [ -f .env ]; then
  log ".env 已存在，跳过生成（如需重建，先删除 $INSTALL_DIR/.env 再跑）"
else
  [ -f .env.example ] || die "仓库里找不到 .env.example"
  log "生成 .env（需要你回答几个问题）"

  read -rp "  根域名（如 example.com，不要带协议和端口）: " NAS_ROOT_DOMAIN
  [ -n "$NAS_ROOT_DOMAIN" ] || die "根域名不能为空"

  read -rp "  对外端口（经反代对外，如 :1443；走 80/443 直接回车）: " NAS_PUBLIC_PORT

  read -rp "  管理员用户名 [admin]: " ADMIN_USERNAME
  ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"

  while :; do
    read -rsp "  管理员密码（登录后请立刻改掉）: " ADMIN_PASSWORD; echo
    [ -n "$ADMIN_PASSWORD" ] && break
    echo "  密码不能为空，请重输。"
  done

  read -rp "  数据根目录 [$NAS_DATA_ROOT]: " NAS_DATA_ROOT_INPUT
  NAS_DATA_ROOT="${NAS_DATA_ROOT_INPUT:-$NAS_DATA_ROOT}"

  AUTH_SECRET="$(openssl rand -base64 32)"
  SERVICE_TOKEN="$(openssl rand -hex 24)"
  CRON_SECRET="$(openssl rand -hex 24)"
  PG_PASSWORD="$(openssl rand -hex 16)"

  umask 077
  cat > .env <<EOF
# 由 scripts/setup-fnos.sh 自动生成于 $(date '+%F %T')，请勿提交到仓库

# 数据根目录：所有容器的持久化数据都在这下面，按应用分子目录
#   <root>/pgdata  PostgreSQL 数据
#   <root>/bill    账单票据照片（读写）
#   <root>/travel  旅行相册（只读，把照片放这里）
#   <root>/todo    待办本地图片（没配图床时才用）
NAS_DATA_ROOT=${NAS_DATA_ROOT}

# 数据库
DATABASE_URL=postgresql://nas:${PG_PASSWORD}@localhost:5433/nas_platform
PG_PASSWORD=${PG_PASSWORD}

NAS_ROOT_DOMAIN=${NAS_ROOT_DOMAIN}
NAS_PUBLIC_PROTO=http
NAS_PUBLIC_PORT=${NAS_PUBLIC_PORT}

PORTAL_SUBDOMAIN=
BILL_SUBDOMAIN=
TODO_SUBDOMAIN=
ANNIVERSARY_SUBDOMAIN=
WORK_SUBDOMAIN=
PREGNANCY_SUBDOMAIN=
TRAVEL_SUBDOMAIN=

AUTH_SECRET=${AUTH_SECRET}
AUTH_TRUST_HOST=true
AUTH_COOKIE_DOMAIN=
AUTH_COOKIE_SECURE=false

PORTAL_URL=
TODO_BASE_URL=
BILL_BASE_URL=
ANNIVERSARY_BASE_URL=
WORK_BASE_URL=
PREGNANCY_BASE_URL=
TRAVEL_BASE_URL=

SERVICE_TOKEN=${SERVICE_TOKEN}
DOCKER_SOCKET=
CRON_SECRET=${CRON_SECRET}

ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

WECOM_CORP_ID=
WECOM_CORP_SECRET=
WECOM_AGENT_ID=
WECOM_WEBHOOK=
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
SMTP_REJECT_UNAUTHORIZED=true

IMAGE_HOST_URL=
IMAGE_HOST_TOKEN=
IMAGE_HOST_ALLOW_HOSTS=
IMAGE_PROXY_CACHE_TTL=86400
IMAGE_MAX_BYTES=12582912

TODO_UPLOAD_DIR=
NAS_PHOTO_ROOT=/data/photos

AMAP_KEY=5c69834c6e0c5eb31112803f30ec998b
AMAP_JSCODE=
AMAP_WEB_KEY=

TZ=Asia/Shanghai
EOF
  chmod 600 .env
  log ".env 已生成：$INSTALL_DIR/.env"
fi

# 取数据根目录用于建目录
NAS_DATA_ROOT_VALUE="$(grep -E '^NAS_DATA_ROOT=' .env | tail -1 | cut -d= -f2-)"
NAS_DATA_ROOT_VALUE="${NAS_DATA_ROOT_VALUE:-$NAS_DATA_ROOT}"

# ---------------------------------------------------------------- 3. 准备挂载目录
log "准备挂载目录"
mkdir -p "$NAS_DATA_ROOT_VALUE"/{pgdata,bill,travel,todo}

# pgdata 属主必须是镜像里的 postgres 用户（uid 70），否则容器起不来
if ! chown -R 70:70 "$NAS_DATA_ROOT_VALUE/pgdata" 2>/dev/null; then
  sudo chown -R 70:70 "$NAS_DATA_ROOT_VALUE/pgdata" 2>/dev/null \
    || die "无法把 pgdata 的属主设为 70:70，请手动执行：sudo chown -R 70:70 '$NAS_DATA_ROOT_VALUE/pgdata'"
fi

# 容器内进程以 uid 1001 运行，给照片/票据目录放宽权限，方便上传
chmod -R 775 "$NAS_DATA_ROOT_VALUE"/{bill,travel,todo} 2>/dev/null \
  || sudo chmod -R 775 "$NAS_DATA_ROOT_VALUE"/{bill,travel,todo} 2>/dev/null \
  || echo "  （提示：照片目录权限放宽失败，上传报错时手动执行 chmod -R 775）"

echo "  数据根目录就绪：$NAS_DATA_ROOT_VALUE"
echo "    ├── pgdata  (属主 70:70)"
echo "    ├── bill    (账单票据)"
echo "    ├── travel  (旅行相册，把照片放这里)"
echo "    └── todo    (待办图片)"

# ---------------------------------------------------------------- 4. 构建并启动
log "构建并启动（默认串行构建，避免小内存 NAS 构建 OOM）"
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
docker compose up -d --build

# ---------------------------------------------------------------- 5. 收尾
log "当前容器状态"
docker compose ps || true

cat <<TIP

==================== 完成 ====================
数据目录：$NAS_DATA_ROOT_VALUE
  pgdata / bill / travel / todo

访问门户：
  直连：http://<NAS_IP>:3210
  反代：http(s)://nav.<你的域名>（Lucky 上把各子域转发到 NAS_IP:321x）

· 首次登录用 .env 里的 ADMIN_USERNAME / ADMIN_PASSWORD，登录后立刻改密码
· 把旅行照片放进 $NAS_DATA_ROOT_VALUE/travel，应用会自动读取（只读引用）
· 看迁移/种子结果：docker compose logs -f migrator
· 看某个服务日志：docker compose logs -f portal
· 更新代码后重部署：cd $INSTALL_DIR && git pull && docker compose up -d --build
==============================================

TIP
