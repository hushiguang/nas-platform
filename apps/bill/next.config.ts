import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// 全仓只有一份 .env（仓库根）。Next 默认只加载应用自己目录下的 .env，
// 六个应用各留一份会把环境变量散成六处、改一处忘五处。
// 这里显式指到根目录，解析规则仍走 Next 自己的实现，不做自写解析。
loadEnvConfig(path.resolve(process.cwd(), "../.."));

const nextConfig: NextConfig = {
  // 部署到 Docker 用 standalone 产物，镜像体积和启动速度差别很大
  output: "standalone",
  // monorepo 下 standalone 默认只追踪应用目录，会把 packages/* 漏在镜像外，
  // 运行时报「找不到模块」。必须指到仓库根。
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  // 指到根之后，追踪会从仓库根开始扫描。这些目录不参与构建，明确排除掉，
  // 免得把运行时数据、备份一起扫进来拖慢构建。
  outputFileTracingExcludes: {
    "*": [
      "backups/**",
      "docs/**",
      "data/**",
    ],
  },
  // 共享包直接以 TS 源码被消费，交给 Next 编译，省掉每个包的构建产物
  transpilePackages: ["@nas/core", "@nas/db", "@nas/auth", "@nas/todo", "@nas/notify", "@nas/ui", "@nas/media"],
  // Prisma / bcrypt 不进打包，按原生 node_modules 引入（standalone 会追踪复制）。
  // xlsx / pdf-parse 同理：pdf-parse 内嵌了一整个 pdfjs，让 webpack 去打它会
  // 把构建拖到十分钟以上（实测卡住），只能在运行时从 node_modules 直接 require。
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "bcryptjs",
    "xlsx",
    "pdf-parse",
    "iconv-lite",
  ],
};

export default nextConfig;
