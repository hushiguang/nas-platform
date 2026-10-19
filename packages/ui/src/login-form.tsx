"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { BusyBar } from "./busy-bar";

export interface LoginFormProps {
  /** 品牌名，如「家庭记账」 */
  appName: string;
  appSub?: string;
  /** 品牌下的一句说明 */
  hint?: string;
  /** 登录成功后的去向。只接受站内路径或本平台已知的应用地址 */
  next?: string | null;
}

/**
 * 各应用共用的登录表单。
 *
 * 用 next-auth/react 的 signIn 而不是 Server Action：在哪个应用登录，
 * 登录请求就发给哪个应用，cookie 由该应用写下。因为 cookie 的 domain
 * 是全站的，登完这一次，其他应用也就都认了。
 */
export function LoginForm({ appName, appSub = "nas-platform", hint, next }: LoginFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const res = await signIn("credentials", { username, password, redirect: false });
      if (res?.error) {
        setError("用户名或密码不正确");
        return;
      }
      // 目标是另一个应用（绝对地址）时走整页跳转，让浏览器把新域名下的
      // cookie 一并带上；站内路径才用前端路由。
      if (next && /^https?:\/\//i.test(next)) {
        window.location.assign(next);
        return;
      }
      router.push(next || "/");
      router.refresh();
    } catch {
      setError("登录失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-wrap">
      <BusyBar />
      <form onSubmit={onSubmit} className="auth-card">
        <div style={{ marginBottom: 18 }}>
          <div className="brand" style={{ fontSize: 24 }}>
            {appName}
          </div>
          <span className="page-eyebrow">{appSub}</span>
          {hint && (
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              {hint}
            </p>
          )}
        </div>
        <label style={{ display: "block", fontSize: 14, marginBottom: 12 }}>
          <span className="muted" style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
            用户名
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            autoComplete="username"
            className="field"
          />
        </label>
        <label style={{ display: "block", fontSize: 14, marginBottom: 12 }}>
          <span className="muted" style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
            密码
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="field"
          />
        </label>
        {error && (
          <div className="notice" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <button type="submit" disabled={pending} className="btn block">
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
