// 构建期自检：确认 Next standalone 产物里运行时真正依赖的模块都在。
//
// 为什么需要它：Next 15.5.27 的文件追踪会漏拷个别模块，漏掉的文件在
// 构建阶段毫无异样，容器一启动才炸，日志还只是一长串 requireStack。
// 实测漏过两类：
//   next 自带模块：
//     next/dist/compiled/is-docker             （server/cache-dir.js 依赖）
//     next/dist/lib/metadata/get-metadata-route（server/lib/router-utils/filesystem.js 依赖）
//   第三方包：
//     ljharb 包族 generator-function / async-function（exports 的
//       module-sync 条件指向 require.mjs，追踪只认 import/default，
//       只拷了 index.mjs，运行时按 module-sync 去找就 MODULE_NOT_FOUND）
//
// Docker 仓库的 Dockerfile.app 在补齐 lib/shared 之后调用本脚本做存在性校验，
// 缺失就让构建直接失败，把问题挡在 build 阶段。
//
// 用法（WORKDIR 为仓库根）：APP=bill node scripts/check-standalone.js

const path = require("path");
const fs = require("fs");

const app = process.env.APP;
if (!app) {
  console.error("缺少 APP 环境变量");
  process.exit(1);
}

const standaloneRoot = path.resolve("apps", app, ".next/standalone");
const base = path.join(standaloneRoot, "node_modules/next/dist");

// 这些模块由 next 内部文件以静态 require 引用，缺任何一个容器都起不来
const MUST_EXIST = [
  "compiled/is-docker",
  "lib/metadata/get-metadata-route",
  "server/lib/router-utils/filesystem",
  "server/cache-dir",
  "server/lib/router-server",
  "server/lib/start-server",
];

// 非 next 的模块，同属文件追踪漏拷：
// ljharb 包族（generator-function / async-function）的 exports 里
// module-sync 条件指向 require.mjs，追踪只认 import/default，
// 只拷了 index.mjs，运行时按 module-sync 去找就 MODULE_NOT_FOUND。
// 写死包名必然漏（补完 generator-function 后又轮到 async-function），
// 所以这里同样动态扫源 node_modules：凡是 exports 含 module-sync 的包，
// 产物里必须存在且 require.mjs 可解析。
function moduleSyncPackages() {
  const nm = "node_modules";
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(nm, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const names = e.name.startsWith("@")
      ? fs
          .readdirSync(path.join(nm, e.name), { withFileTypes: true })
          .filter((s) => s.isDirectory())
          .map((s) => `${e.name}/${s.name}`)
      : [e.name];
    for (const name of names) {
      const pj = path.join(nm, name, "package.json");
      if (!fs.existsSync(pj)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pj, "utf8"));
        if (JSON.stringify(pkg.exports ?? {}).includes("module-sync")) out.push(name);
      } catch {
        /* 解析不了的 manifest 不参与判断 */
      }
    }
  }
  return out;
}

const missing = MUST_EXIST.filter((m) => {
  try {
    require.resolve(path.join(base, m));
    return false;
  } catch {
    return true;
  }
});

// optionalDependencies 不进 Next 的文件追踪。pdf-parse 把 @napi-rs/canvas
// 挂在 optionalDependencies 下，产物里 pdf-parse 在、@napi-rs 不在，
// 容器一跑就刷
//   Warning: Cannot load "@napi-rs/canvas" package: "Error: Cannot find module ..."
// 文本抽取还能用，渲染直接坏。Dockerfile.app 会把 @napi-rs 整棵拷进产物，
// 这里验证拷贝确实到位，拷漏了就在构建期失败。
function canvasMissingReason() {
  const pdfParseDir = path.join(standaloneRoot, "node_modules/pdf-parse");
  if (!fs.existsSync(pdfParseDir)) return null;
  try {
    // 用 paths 限定在产物内部的 node_modules 里找：Node 默认会一路往上层
    // node_modules 找，本地开发时可能在仓库根 node_modules 命中 —— 那不算数，
    // 容器里产物被单独 COPY 出来，没有上层 node_modules。
    const resolved = require.resolve("@napi-rs/canvas", {
      paths: [path.join(standaloneRoot, "node_modules")],
    });
    if (!resolved.startsWith(standaloneRoot + path.sep)) {
      return `解析到了产物之外的位置：${resolved}`;
    }
    return null;
  } catch (e) {
    return e && e.message ? e.message : String(e);
  }
}

const canvasReason = canvasMissingReason();

const missingPkgs = moduleSyncPackages().filter((name) => {
  const dest = path.join(standaloneRoot, "node_modules", name);
  try {
    require.resolve(path.join(dest, "require.mjs"));
    return false;
  } catch {
    return true;
  }
});

if (missing.length || missingPkgs.length || canvasReason) {
  if (missing.length) {
    console.error(`standalone 产物缺失 next 模块（APP=${app}）：${missing.join(", ")}`);
    console.error(`产物目录：${base}`);
  }
  if (missingPkgs.length) {
    console.error(`standalone 产物缺失 module-sync 包（APP=${app}）：${missingPkgs.join(", ")}`);
    console.error(`产物目录：${path.join(standaloneRoot, "node_modules")}`);
  }
  if (canvasReason) {
    console.error(
      `standalone 产物缺失 @napi-rs/canvas（APP=${app}，pdf-parse 的 optional 依赖未追踪）：${canvasReason}`
    );
    console.error(`产物目录：${path.join(standaloneRoot, "node_modules/@napi-rs")}`);
  }
  process.exit(1);
}

// 进一步：对已追踪进来的 server 文件做一次递归解析，兜住白名单没覆盖的
// 同类断链。这里只告警、不让构建失败 —— Next 产物里存在良性的悬空引用
// （如 route-modules/pages/builtin/_error.js → pages/_error，由
// load-default-error-components.js 容错加载），硬失败会误伤每一次构建。

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