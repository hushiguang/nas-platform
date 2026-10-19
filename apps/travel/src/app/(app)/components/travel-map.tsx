"use client";

import { useEffect, useRef } from "react";

export interface MapPoint {
  id: string;
  kind: "stop" | "city" | "wish";
  name: string;
  lat: number;
  lng: number;
  note?: string | null;
  photos?: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

let loading: Promise<any> | null = null;

/** 手动注入高德 JS API 2.0 脚本。安全密钥必须在脚本加载前挂到 window 上。 */
function loadAMap(key: string, securityCode: string): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.AMap) return Promise.resolve(window.AMap);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.InfoWindow`;
    script.async = true;
    script.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error("高德加载失败")));
    script.onerror = () => reject(new Error("高德脚本加载失败"));
    document.head.appendChild(script);
  });
  return loading;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

const PIN_COLOR: Record<MapPoint["kind"], string> = {
  stop: "#e11d48",
  city: "#2563eb",
  wish: "#f59e0b",
};

export function TravelMap({
  points,
  amapKey,
  securityCode,
  height = 360,
}: {
  points: MapPoint[];
  amapKey: string;
  securityCode: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!amapKey) return;
    let disposed = false;

    loadAMap(amapKey, securityCode)
      .then((AMap) => {
        if (disposed || !containerRef.current) return;
        const center: [number, number] = points[0] ? [points[0].lng, points[0].lat] : [113.2644, 23.1291];
        const map = new AMap.Map(containerRef.current, {
          zoom: points.length ? 5 : 4,
          center,
          viewMode: "2D",
        });
        mapRef.current = map;

        const infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -34) });
        const markers = points.map((point) => {
          const thumb = point.photos?.[0]
            ? `<img class="travel-pin-img" src="${escapeHtml(point.photos[0])}" alt="" />`
            : `<span class="travel-pin-dot" style="background:${PIN_COLOR[point.kind]}"></span>`;
          const marker = new AMap.Marker({
            position: [point.lng, point.lat],
            content: `<div class="travel-pin ${point.kind}">${thumb}</div>`,
            offset: new AMap.Pixel(0, 0),
            anchor: "center",
            zIndex: 100,
          });
          marker.on("click", () => {
            const photos = (point.photos ?? [])
              .slice(0, 4)
              .map((url) => `<img src="${escapeHtml(url)}" alt="" />`)
              .join("");
            infoWindow.setContent(
              `<div class="travel-pop"><h4>${escapeHtml(point.name)}</h4>` +
                (point.note ? `<p>${escapeHtml(point.note)}</p>` : "") +
                (photos ? `<div class="travel-pop-photos">${photos}</div>` : "") +
                `</div>`,
            );
            infoWindow.open(map, [point.lng, point.lat]);
          });
          return marker;
        });

        if (markers.length) {
          map.add(markers);
          if (markers.length > 1) map.setFitView(markers, false, [40, 40, 40, 40], 15);
        }
      })
      .catch((err) => console.error("[travel] 地图加载失败", err));

    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
    // points 序列化后作为依赖，避免每次渲染重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amapKey, securityCode, JSON.stringify(points)]);

  if (!amapKey) {
    return (
      <div className="map-fallback" style={{ height }}>
        还没配置高德 Key（AMAP_KEY），地图暂不可用
      </div>
    );
  }

  return <div className="travel-map" ref={containerRef} style={{ height }} />;
}
