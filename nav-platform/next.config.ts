import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 部署到 Docker 用 standalone 产物，镜像体积和启动速度差别很大
  output: "standalone",
  // Prisma / bcrypt 不进打包，按原生 node_modules 引入（standalone 会追踪复制）
  serverExternalPackages: ["@prisma/client", "prisma", "bcryptjs"],
};

export default nextConfig;
