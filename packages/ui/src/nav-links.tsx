"use client";

import { usePathname } from "next/navigation";
import { SiteLink } from "./site-link";

export interface NavItem {
  href: string;
  label: string;
  /** 跨应用跳转（绝对地址）走普通 <a>，让浏览器整页跳过去 */
  external?: boolean;
}

/** 侧栏/顶栏导航：当前项高亮（与 nas-ledger 的 .nav-item.active 一致） */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // 最长匹配获胜：/notify/channels 只亮通知渠道，不连带点亮 /notify 的发送记录；
  // /admin/users/3 这类详情页仍能点亮 /admin/users（没有更长的匹配项时）。
  const best = items
    .filter(
      (item) =>
        !item.external &&
        (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <>
      {items.map((item) => {
        const className = `nav-item${item === best ? " active" : ""}`;
        return (
          <SiteLink key={item.href} href={item.href} className={className}>
            {item.label}
          </SiteLink>
        );
      })}
    </>
  );
}
