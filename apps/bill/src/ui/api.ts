/**
 * 请求层 —— 从 cash-platform 原样搬来，只改了两处收口：
 *
 *   1. 去掉 Capacitor Preferences。门户统一登录，身份靠 Auth.js 的会话 cookie，
 *      不再有 Bearer token 要同步。getToken / setToken 保留是为了 App 端
 *      （「轻记」里仍可填服务器地址 + Bearer 直连）不崩，web 下是空操作。
 *   2. apiUrl() 里把 `/api/*` 改写到 `/legacy/api/*`。
 *      因为 Auth.js 占了 `/api/auth/[...nextauth]`（catch-all），旧接口挂
 *      `/api/*` 会被吞掉，所以整层挪到 `/legacy` 前缀下。所有请求都经过这个函数，
 *      App.jsx 因此一个字都不用改。
 */

const TOKEN_KEY = 'qingji.token';
const API_BASE_KEY = 'qingji.apiBase';

/** token 同步缓存。web 下恒为空；App 端若手动设置了 token 则沿用 */
let tokenCache: string | null = null;

/** 保留原签名：web 下只是把 localStorage 里的值读进内存 */
export async function initTokenStore(): Promise<void> {
  tokenCache = localStorage.getItem(TOKEN_KEY);
}

export function getToken(): string {
  if (tokenCache === null) tokenCache = localStorage.getItem(TOKEN_KEY);
  return tokenCache || '';
}

export function setToken(token?: string | null): void {
  tokenCache = token || '';
  if (tokenCache) localStorage.setItem(TOKEN_KEY, tokenCache);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getApiBase(): string {
  return (localStorage.getItem(API_BASE_KEY) || '').trim();
}

export function setApiBase(url: string): void {
  const value = url.trim().replace(/\/+$/, '');
  if (value) localStorage.setItem(API_BASE_KEY, value);
  else localStorage.removeItem(API_BASE_KEY);
}

/**
 * 把 /api/xxx 拼成实际请求地址。
 *
 * 同源（门户里打开）→ /legacy/api/xxx，靠 cookie 带上登录态；
 * App 直连（设置页填了服务器地址）→ https://host/legacy/api/xxx，靠 Bearer。
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const rewritten = path.startsWith('/api/') ? `/legacy${path}` : path;
  const base = getApiBase();
  if (!base) return rewritten;
  return `${base}${rewritten.startsWith('/') ? '' : '/'}${rewritten}`;
}

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

// 全局 loading：所有请求都走这里计数，界面顶部显示一条进度条
const busyListeners = new Set<(count: number) => void>();
let busyCount = 0;

function emitBusy(): void {
  busyListeners.forEach((listener) => listener(busyCount));
}

export function subscribeBusy(listener: (count: number) => void): () => void {
  busyListeners.add(listener);
  listener(busyCount);
  return () => busyListeners.delete(listener);
}

/** 把一个 promise 计入全局 loading，导出/上传这类不走 api() 的请求也能用 */
export function track<T>(promise: Promise<T>): Promise<T> {
  busyCount += 1;
  emitBusy();
  return promise.finally(() => {
    busyCount = Math.max(0, busyCount - 1);
    emitBusy();
  });
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** 不自动带 Content-Type（例如自己构造 FormData 时其实无所谓，留作兜底） */
  rawBody?: boolean;
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body = options.body;
  if (body !== undefined && !(body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers,
      body: body as BodyInit,
      // 子域名部署下 API 与页面同域，credentials 默认就是 same-origin；
      // 显式写上是为了 App 端配了独立服务器地址时也能把 cookie 带过去
      credentials: 'include',
    });
  } catch (err) {
    // 最常见的就是 App 里后端地址没配/不可达，给一句人话
    throw new ApiError(getApiBase() ? '连不上服务器，检查设置里的地址' : '网络请求失败', 0, err);
  }

  // 会话过期：Auth.js 的登录页路径与旧前端不同，这里统一按 401 处理
  if (response.status === 401 && !getToken()) {
    const data401 = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(data401.message || '请先登录', 401, data401);
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & T;
  if (!response.ok) {
    throw new ApiError((data.message as string) || '请求失败', response.status, data);
  }
  return data;
}

/** 类型化请求：api<{ bills: Bill[] }>('/api/bills') */
export function api<T = Record<string, unknown>>(path: string, options: ApiOptions = {}): Promise<T> {
  return track(request<T>(path, options));
}
