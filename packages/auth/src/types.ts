import type { DefaultSession } from "next-auth";

// 把自定义字段挂到 next-auth 的类型上。放在包里、由 index.ts 引入，
// 各应用只要 import 了 @nas/auth 就自动拿到这些增强，不用各自维护一份声明。
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: "ADMIN" | "MEMBER";
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    username: string;
    role: "ADMIN" | "MEMBER";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    role?: "ADMIN" | "MEMBER";
  }
}
