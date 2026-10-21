"use client";

import { useEffect } from "react";

/**
 * 时间轴会一直铺到所有排期，左边缘不一定落在当前看的月份上。
 * 这里把滚动位置对到锚点（默认是今天）附近，翻月之后也停在对的月份。
 */
export function ScrollToDate({ percent }: { percent: number }) {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".gantt-scroll");
    const track = scroller?.querySelector<HTMLElement>(".gantt-track");
    if (!scroller || !track) return;
    const scrollerBox = scroller.getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    const x = trackBox.left - scrollerBox.left + scroller.scrollLeft + (percent / 100) * trackBox.width;
    const visible = scroller.clientWidth;
    if (x < scroller.scrollLeft + 24 || x > scroller.scrollLeft + visible - 80) {
      scroller.scrollLeft = Math.max(0, x - visible * 0.3);
    }
  }, [percent]);

  return null;
}
