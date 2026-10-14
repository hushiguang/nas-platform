"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    const res = await signIn("credentials", { username, password, redirect: false });
    setPending(false);
    if (res?.error) {
      setError("用户名或密码不正确");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <form onSubmit={onSubmit} className="auth-card">
        <div style={{ marginBottom: 18 }}>
          <div className="brand" style={{ fontSize: 24 }}>
            家庭 NAS
          </div>
          <span className="page-eyebrow">应用门户</span>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            登录后进入你的应用导航
          </p>
        </div>
        <label style={{ display: "block", fontSize: 14, marginBottom: 12 }}>
          <span className="muted" style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
            用户名
          </span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus className="field" />
        </label>
        <label style={{ display: "block", fontSize: 14, marginBottom: 12 }}>
          <span className="muted" style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
            密码
          </span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="field" />
        </label>
        {error && <div className="notice" style={{ marginBottom: 12 }}>{error}</div>}
        <button type="submit" disabled={pending} className="btn block">
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
