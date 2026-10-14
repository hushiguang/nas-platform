"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

/** 侧栏/顶栏导航：当前项高亮（与 nas-ledger 的 .nav-item.active 一致） */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={`nav-item${active ? " active" : ""}`}>
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
