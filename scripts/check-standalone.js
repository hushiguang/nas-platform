// 构建期自检：确认 Next standalone 产物里运行时真正依赖的模块都在。
//
// 为什么需要它：Next 15.5.27 的文件追踪会漏拷个别 next 自带模块，
// 漏掉的文件在构建阶段毫无异样，容器一启动才炸，日志还只是一长串
// requireStack。实测漏过两个：
//   next/dist/compiled/is-docker             （server/cache-dir.js 依赖）
//   next/dist/lib/metadata/get-metadata-route（server/lib/router-utils/filesystem.js 依赖）
//
// Docker 仓库的 Dockerfile.app 在补齐 lib/shared 之后调用本脚本做存在性校验，
// 缺失就让构建直接失败，把问题挡在 build 阶段。
//
// 用法（WORKDIR 为仓库根）：APP=bill node scripts/check-standalone.js

const path = require("path");

const app = process.env.APP;
if (!app) {
  console.error("缺少 APP 环境变量");
  process.exit(1);
}

const base = path.resolve("apps", app, ".next/standalone/node_modules/next/dist");

// 这些模块由 next 内部文件以静态 require 引用，缺任何一个容器都起不来
const MUST_EXIST = [
  "compiled/is-docker",
  "lib/metadata/get-metadata-route",
  "server/lib/router-utils/filesystem",
  "server/cache-dir",
  "server/lib/router-server",
  "server/lib/start-server",
];

const missing = MUST_EXIST.filter((m) => {
  try {
    require.resolve(path.join(base, m));
    return false;
  } catch {
    return true;
  }
});

if (missing.length) {
  console.error(`standalone 产物缺失 next 模块（APP=${app}）：${missing.join(", ")}`);
  console.error(`产物目录：${base}`);
  process.exit(1);
}

// 进一步：对已追踪进来的 server 文件做一次递归解析，兜住白名单没覆盖的
// 同类断链。这里只告警、不让构建失败 —— Next 产物里存在良性的悬空引用
// （如 route-modules/pages/builtin/_error.js → pages/_error，由
// load-default-error-components.js 容错加载），硬失败会误伤每一次构建。
const fs = require("fs");

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const broken = [];
for (const file of walk(path.join(base, "server"))) {
  const src = fs.readFileSync(file, "utf8");
  const re = /require\(["'](\.[^"']+)["']\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    try {
      require.resolve(path.resolve(path.dirname(file), m[1]));
    } catch {
      broken.push(`${path.relative(base, file)} → ${m[1]}`);
    }
  }
}

if (broken.length) {
  console.warn(
    `[告警] 有 ${broken.length} 处相对 require 无法解析（多为 Next 产物自带的容错引用，不阻断构建）：`
  );
  for (const b of broken.slice(0, 10)) console.warn(`  ${b}`);
  if (broken.length > 10) console.warn(`  …另有 ${broken.length - 10} 处`);
}

console.log(`standalone 产物自检通过（APP=${app}，next 运行时依赖齐全）`);