"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 站内路径和「本平台的其他应用」都在当前标签页里跳。
 *
 * 各应用是分开部署的（不同端口/域名），以前按 origin 判断、跨域就开新标签页，
 * 结果门户点进账单一类操作会攒一堆标签页。现在默认整页跳转，
 * 只有明确标成外部独立服务的链接（`newTab`）才新开标签页。
 */
export function SiteLink({
  href,
  className,
  children,
  newTab = false,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  /** 外部独立服务：新标签页打开，不打断当前应用 */
  newTab?: boolean;
}) {
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  const blank = newTab ? { target: "_blank" as const, rel: "noreferrer" } : {};
  return (
    <a href={href} className={className} {...blank}>
      {children}
    </a>
  );
}
