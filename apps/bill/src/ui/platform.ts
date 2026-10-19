/**
 * 原生壳能力封装 —— 从 cash-platform 搬来，Capacitor 全部剥离。
 *
 * 集成进门户后只跑在浏览器里（含手机浏览器），所以：
 *   - 所有 Capacitor 插件调用换成 web 下的空实现
 *   - 真正还有用的只剩 initH5Shell（手机浏览器键盘弹起时收起底栏）
 *
 * 导出名一个都没动，App.jsx 因此不需要改。将来若要重新出 App 包，
 * 把这个文件换回 Capacitor 版本即可，业务代码零感知。
 */

export const isNative = false;
export const platform = 'web' as 'ios' | 'android' | 'web';

/** 原生壳初始化：web 下无事可做 */
export async function initNativeShell(): Promise<void> {
  /* 浏览器环境没有状态栏 / 返回键 / 深链接，全部跳过 */
}

/**
 * 手机浏览器：键盘弹起时收起底栏和悬浮按钮，避免挡住正在输入的框。
 * visualViewport 比 window 矮一截，就当成键盘开着。
 */
export function initH5Shell(): void {
  if (!window.visualViewport) return;
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const sync = () => {
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    const keyboard = narrow && window.innerHeight - viewport.height > 140;
    root.dataset.keyboard = keyboard ? '1' : '0';
  };
  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  window.addEventListener('orientationchange', sync);
  sync();
}

/** 状态栏文字颜色：web 下无状态栏 */
export async function syncStatusBar(): Promise<void> {
  /* no-op */
}

/** 跳到系统「通知使用权」：仅 App 可用 */
export async function openPayNotifySettings(): Promise<void> {
  /* no-op */
}

/** 无障碍「轻账单付款通知」：仅 App 可用 */
export async function openPayAccessibilitySettings(): Promise<void> {
  /* no-op */
}

/** 打开微信或支付宝：仅 App 可用 */
export async function openPayApp(_source: 'wechat' | 'alipay'): Promise<void> {
  /* no-op */
}

/** 小米「后台弹出界面」：仅 App 可用 */
export async function openPayPopupSettings(): Promise<void> {
  /* no-op */
}

/** 最近一条付款通知：仅 App 可用 */
export async function lastPayNotice(): Promise<string> {
  return '';
}

export interface PayDraft {
  id: number;
  amount: string;
  payee: string;
  note: string;
  occurredAt: string;
  type: 'expense' | 'income';
  source: 'wechat' | 'alipay';
}

const PAY_DRAFT_KEY = 'qingji.payDraft';

/**
 * 付款通知拉起的草稿。web 下不会有人写这个 key，
 * 保留函数是为了 App.jsx 的调用点不用判环境。
 */
export function consumePayDraft(): PayDraft | null {
  const raw = sessionStorage.getItem(PAY_DRAFT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PAY_DRAFT_KEY);
  try {
    const draft = JSON.parse(raw) as PayDraft;
    return draft?.amount ? draft : null;
  } catch {
    return null;
  }
}

/** 触感反馈：web 下无震动 */
export async function impact(_style?: unknown): Promise<void> {
  /* no-op */
}
