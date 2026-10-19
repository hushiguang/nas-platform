/** 高德 JS API 的 Web端 Key 与安全密钥，从服务端读到后传进客户端组件 */
export function amapKey(): string {
  return process.env.AMAP_KEY || process.env.NEXT_PUBLIC_AMAP_KEY || "";
}

export function amapSecurityCode(): string {
  return process.env.AMAP_JSCODE || process.env.NEXT_PUBLIC_AMAP_JSCODE || "";
}

export function amapConfigured(): boolean {
  return Boolean(amapKey());
}
