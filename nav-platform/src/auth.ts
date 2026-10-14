import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { JWT } from "next-auth/jwt";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user || user.status !== "ACTIVE") return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: String(user.id),
          name: user.nickname,
          username: user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    authorized: authConfig.callbacks.authorized,
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.username = user.username;
      }
      return token;
    },
    session({ session, token }) {
      // session 回调的参数是 jwt/database 两种策略的联合类型，这里按 JWT 取
      const t = token as JWT;
      if (t?.id) session.user.id = t.id;
      if (t?.role) session.user.role = t.role;
      if (t?.username) session.user.username = t.username;
      return session;
    },
  },
});
