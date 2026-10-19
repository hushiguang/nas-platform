"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

function leavesThisSite(href: string): boolean {
  try {
    return new URL(href, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function openAway(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!leavesThisSite(href)) return;
  event.preventDefault();
  window.open(new URL(href, window.location.href).href, "_blank", "noopener,noreferrer");
}

/**
 * 站内路径还在当前页打开。跳到别的域名（或别的端口上的另一个应用）时开新页面。
 */
export function SiteLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    setAway(leavesThisSite(href));
  }, [href]);

  const blank = away ? { target: "_blank" as const, rel: "noreferrer" } : {};

  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link href={href} className={className} onClick={(event) => openAway(event, href)}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} className={className} {...blank} onClick={(event) => openAway(event, href)}>
      {children}
    </a>
  );
}
