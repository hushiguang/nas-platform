#!/usr/bin/env bash
#
# 数据库迁移 · 本地开发库 → NAS 新库
#
# 两段式使用（在两台机器上分别跑）：
#
#   1) 在本地 Mac 上导出：
#        bash scripts/migrate-db.sh export
#      产出 nas-migrate.sql.gz。连接串默认读仓库根目录 .env 的 DATABASE_URL。
#      可用 DB_URL 覆盖，或用 NAS_HOST 一并 scp 到 NAS：
#        DB_URL='postgresql://nas:xxx@localhost:5433/nas_platform' \
#        NAS_HOST=root@192.168.1.10 NAS_DIR=/vol1/1000/docker \
#          bash scripts/migrate-db.sh export
#
#   2) 在 NAS 上导入：
#        bash scripts/migrate-db.sh import /path/to/nas-migrate.sql.gz
#      会先自动备份现有库，再重置 schema 后导入，最后打印各表行数。
#
# 安全：import 前必定先备份；备份失败直接中止，不会带着旧数据往下走。
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

c_cyan=$'\033[1;36m'; c_red=$'\033[1;31m'; c_yellow=$'\033[1;33m'; c_off=$'\033[0m'
log()  { printf '\n%s==> %s%s\n' "$c_cyan" "$*" "$c_off"; }
warn() { printf '%s[提示] %s%s\n' "$c_yellow" "$*" "$c_off"; }
die()  { printf '\n%s[错误] %s%s\n' "$c_red" "$*" "$c_off" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "未找到 $1，请先安装。"; }

# ---------------------------------------------------------------- 连接串
resolve_db_url() {
  if [ -n "${DB_URL:-}" ]; then echo "$DB_URL"; return; fi
  if [ -f .env ]; then
    v="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)"
    if [ -n "$v" ]; then echo "$v"; return; fi
  fi
  die "没找到连接串：请设 DB_URL，或在仓库根目录 .env 里配 DATABASE_URL。"
}

# pg_dump 版本必须 >= 服务端大版本，否则报 "server version mismatch"。
# 不要再写死「16」：本地开发库可能是 17/18，NAS 目标库又是别的版本。
server_major() {
  local url="$1" num
  command -v psql >/dev/null 2>&1 || { echo 16; return; }
  num="$(psql "$url" -tAc 'show server_version_num' 2>/dev/null | tr -dc '0-9' | head -c6)"
  [ -n "$num" ] || { echo 16; return; }
  echo $(( num / 10000 ))
}

pg_dump_major() {
  "$1" --version 2>/dev/null | sed -nE 's/.* ([0-9]+)\.[0-9]+.*/\1/p'
}

# 在若干常见位置里挑一个够新的 pg_dump。Homebrew 的 libpq 常年是较新的大版本
# （pg_dump 只需要客户端库，比服务端 major 新即可），比拉 Docker 镜像轻得多，
# 也不依赖能否连上 Docker Hub。
find_pg_dump() {
  local need="$1" cand major best="" bestmajor=0
  for cand in \
    "$(command -v pg_dump || true)" \
    /opt/homebrew/opt/libpq/bin/pg_dump \
    /usr/local/opt/libpq/bin/pg_dump \
    /opt/homebrew/Cellar/libpq/*/bin/pg_dump \
    /usr/local/Cellar/libpq/*/bin/pg_dump \
    /opt/homebrew/Cellar/postgresql@*/*/bin/pg_dump \
    /usr/local/Cellar/postgresql@*/*/bin/pg_dump
  do
    [ -x "$cand" ] || continue
    major="$(pg_dump_major "$cand")"
    [ -n "$major" ] || continue
    if [ "$major" -ge "$need" ] && [ "$major" -gt "$bestmajor" ]; then
      best="$cand"; bestmajor="$major"
    fi
  done
  [ -n "$best" ] || return 1
  echo "$best"
}

# ---------------------------------------------------------------- 1) 导出
do_export() {
  local url; url="$(resolve_db_url)"
  local smajor; smajor="$(server_major "$url")"
  log "导出本地开发库"
  echo "  服务端版本：PostgreSQL $smajor"

  local out="nas-migrate.sql.gz"
  rm -f "$out"

  local dump_bin; dump_bin="$(find_pg_dump "$smajor" || true)"
  if [ -n "$dump_bin" ]; then
    log "使用 pg_dump：${dump_bin}（$("${dump_bin}" --version)）"
    "$dump_bin" "$url" --no-owner --no-privileges | gzip -9 > "$out"
  else
    warn "本机找不到 major >= $smajor 的 pg_dump，改用 postgres:${smajor}-alpine 容器导出"
    need docker
    # 容器内访问宿主机上的数据库要把 localhost 换成 host.docker.internal
    local u="$url"
    case "$u" in
      *@localhost:*) u="${u/@localhost:/@host.docker.internal:}" ;;
      *@127.0.0.1:*) u="${u/@127.0.0.1:/@host.docker.internal:}" ;;
    esac
    docker run --rm -i \
      --add-host=host.docker.internal:host-gateway \
      "postgres:${smajor}-alpine" \
      sh -c "pg_dump '$u' --no-owner --no-privileges" | gzip -9 > "$out"
  fi

  [ -s "$out" ] || die "导出失败：$out 为空"
  log "导出完成：$out ($(du -h "$out" | cut -f1))"

  # 可选：顺手 scp 到 NAS
  if [ -n "${NAS_HOST:-}" ]; then
    log "scp 到 $NAS_HOST:${NAS_DIR:-/vol1/1000/docker}/"
    mkdir -p "${NAS_DIR:-/vol1/1000/docker}"
    scp "$out" "$NAS_HOST:${NAS_DIR:-/vol1/1000/docker}/"
    log "已传输。到 NAS 上执行：bash scripts/migrate-db.sh import ${NAS_DIR:-/vol1/1000/docker}/$out"
  else
    cat <<'TIP'

下一步：
  1) 把 nas-migrate.sql.gz 传到 NAS（scp / 飞牛文件管理均可）
  2) 在 NAS 上进入仓库目录执行：
       bash scripts/migrate-db.sh import /path/to/nas-migrate.sql.gz

TIP
  fi
}

# ---------------------------------------------------------------- 2) 导入
do_import() {
  local dump="${1:-}"
  [ -n "$dump" ] || die "用法：bash scripts/migrate-db.sh import <dump.sql.gz>"
  [ -f "$dump" ] || die "找不到文件：$dump"
  need docker
  docker compose ps --status running --services 2>/dev/null | grep -qx postgres \
    || die "postgres 容器没在运行，请先 docker compose up -d"

  local ts; ts="$(date +%F-%H%M%S)"
  local bak="backup-before-import-${ts}.sql.gz"

  # 2.1 先备份，绝不在没有备份的情况下动库
  log "备份现有库 → $bak"
  if ! docker compose exec -T postgres pg_dump -U nas nas_platform | gzip -9 > "$bak"; then
    rm -f "$bak"
    die "备份失败，已中止导入（原库未被改动）"
  fi
  [ -s "$bak" ] || { rm -f "$bak"; die "备份文件为空，已中止导入"; }
  echo "  备份大小：$(du -h "$bak" | cut -f1)"

  if [ -t 0 ]; then
    printf '\n%s注意：即将重置 public schema 并导入，本库现有业务数据会被替换。%s\n' "$c_yellow" "$c_off"
    read -rp "  确认继续？(yes/no) " ans
    [ "$ans" = "yes" ] || die "已取消"
  fi

  # 2.2 重置 schema，让导入是干净的一次性过程（避免建表冲突）
  log "重置 public schema"
  docker compose exec -T postgres psql -U nas -d nas_platform -v ON_ERROR_STOP=1 \
    -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

  # 2.3 导入
  # 高版本库导出的 dump 里会带目标库不认识的语法，必须滤掉，否则 ON_ERROR_STOP 会中断：
  #   SET transaction_timeout  —— 该参数 PG17 才引入，目标若是 PG16 会报
  #                              "unrecognized configuration parameter"
  #   \restrict / \unrestrict  —— psql 17.6+/18 才有的元命令，老版本 psql 不认
  # 滤掉是无害的：前者只是设置超时，后者只是导入期间的安全开关。
  log "导入数据"
  gzip -dc "$dump" \
    | sed -E '/^SET transaction_timeout =/d; /^\\(restrict|unrestrict) /d' \
    | docker compose exec -T postgres psql -U nas -d nas_platform -v ON_ERROR_STOP=1 -q
  log "导入完成"

  # 2.4 体检
  log "各表行数"
  docker compose exec -T postgres psql -U nas -d nas_platform -c "
    select '用户'      as 表, count(*) from \"user\"
    union all select '平台',   count(*) from platform
    union all select '账本',   count(*) from bill_book
    union all select '账单流水', count(*) from bill_transaction
    union all select '账户',   count(*) from bill_account
    union all select '分类',   count(*) from bill_category
    union all select '待办',   count(*) from todo
    union all select '纪念日', count(*) from anniversary
    union all select '项目',   count(*) from work_project
    union all select '城市',   count(*) from travel_city
    order by 1;"

  cat <<TIP

备份保留在：$REPO_ROOT/$bak
确认数据没问题后再手动删除；回滚可用：
  gzip -dc $bak | docker compose exec -T postgres psql -U nas -d nas_platform -v ON_ERROR_STOP=1

TIP
}

case "${1:-}" in
  export) do_export ;;
  import) shift; do_import "$@" ;;
  *) die "用法：bash scripts/migrate-db.sh {export|import [dump.sql.gz]}" ;;
esac