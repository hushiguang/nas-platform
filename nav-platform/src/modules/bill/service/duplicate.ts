/**
 * 查重：微信 / 支付宝绑着银行卡时，同一笔消费可能在银行卡流水和钱包流水里各记一条。
 *
 * 把「金额相同 + 时间接近 + 分属不同账户」的支出（或收入）配成对，按相似度打分；
 * 再把互相重叠的配对并成组，界面按组展示「一组里留一条，其余一起删」。
 *
 * 移植自 cash-platform/server/src/duplicates.js。SQL 从 SQLite 方言改到 PG：
 *   · julianday() 差值 → interval 比较
 *   · GROUP_CONCAT 未用到；这里只用得到 ABS / COALESCE
 *   · 列名全部改成 schema 里的驼峰
 * 打分权重与阈值见 service/config.ts。
 */
import { prisma } from "@/lib/prisma";
import { centsToYuan, yuanToCents } from "./money";
import { billConfig } from "./config";
import { BillError } from "./errors";
import { presentTransaction, type TransactionRow } from "./transaction";
import { transactionsByIds } from "./query";
import type { Actor } from "./book";

const { duplicates: DUP } = billConfig;

/** 库里存的是 UTC 墙钟，用 UTC 取值恰好还原「记账当时的本地时间」字符串 */
function stamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** 一方备注里出现渠道名、另一方账户是同一渠道的钱包 → 基本就是同一次支付的两边记录 */
const CHANNELS = [
  { key: "微信", payee: /财付通|微信支付|微信转账|微信扫码|wechat/i, account: /微信|零钱/ },
  { key: "支付宝", payee: /支付宝|蚂蚁|alipay|花呗|网商/i, account: /支付宝|余额宝|花呗|网商/ },
];

function normalizeText(text: unknown): string {
  return String(text || "")
    .replace(/[（(].*?[)）]/g, "")
    .replace(/[-—_\s·、,，。.:：/|*]/g, "")
    .toLowerCase();
}

/** 'YYYY-MM-DD HH:MM:SS' → 分钟数（按 UTC 拼，只用于求差） */
function toMinutes(text: string): number {
  const m = String(text || "").match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) / 60000;
}

const dayOf = (text: string) => String(text || "").slice(0, 10);

/** 最长的连续公共片段，用来判断两个商户名有多像 */
function longestCommon(a: string, b: string): number {
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k += 1;
      if (k > best) best = k;
    }
  }
  return best;
}

/** 备注里记的商户单号（跨平台可能是同一个，能互证是同一笔消费） */
function merchantOrderOf(text: unknown): string {
  const m = String(text || "").match(
    /(?:商户订单号|商家订单号|商户单号单号|商户单号)[：:]\s*([A-Za-z0-9_-]{8,})/,
  );
  return m ? m[1] : "";
}

function channelMatch(from: TransactionRow, to: TransactionRow): string | null {
  for (const ch of CHANNELS) {
    if (ch.payee.test(from.payee || "") && ch.account.test(to.accountName || "")) return ch.key;
    if (ch.payee.test(from.note || "") && ch.account.test(to.accountName || "")) return ch.key;
  }
  return null;
}

export interface ScoredPair {
  key: string;
  score: number;
  reasons: string[];
  amount: string;
  a: ReturnType<typeof presentTransaction>;
  b: ReturnType<typeof presentTransaction>;
}

/** 两笔有多像。100 分是「交易单号相同」——同一笔账单被记了两次，最硬的证据 */
export function scorePair(a: TransactionRow, b: TransactionRow): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  const ea = String(a.externalId || "").trim();
  const eb = String(b.externalId || "").trim();
  if (ea && ea === eb) return { score: 100, reasons: ["交易单号相同"] };

  const S = DUP.scores;
  let score = S.baseline; // 金额相同且分属不同账户

  const aText = stamp(a.occurredAt);
  const bText = stamp(b.occurredAt);
  const gapMin = Math.abs(toMinutes(aText) - toMinutes(bText));
  if (aText === bText) {
    score += S.sameTime;
    reasons.push("同一时刻");
  } else if (dayOf(aText) === dayOf(bText)) {
    score += S.sameDay;
    reasons.push("同一天");
  } else {
    const hours = Math.round(gapMin / 60);
    score += S.gap;
    reasons.push(hours < 24 ? `相隔 ${hours} 小时` : `相差 ${Math.round(hours / 24)} 天`);
  }

  const na = normalizeText(a.payee);
  const nb = normalizeText(b.payee);
  if (na && nb && (na.includes(nb) || nb.includes(na))) {
    score += S.merchantExact;
    reasons.push("商户名一致");
  } else if (longestCommon(na, nb) >= 2) {
    score += S.merchantNear;
    reasons.push("商户名相近");
  }

  const channel = channelMatch(a, b) || channelMatch(b, a);
  if (channel) {
    score += S.channel;
    reasons.push(`${channel}渠道互证`);
  }

  const ma = merchantOrderOf(a.note);
  const mb = merchantOrderOf(b.note);
  if (ma && ma === mb) {
    score += S.order;
    reasons.push("商户单号相同");
  }

  if (Number(a.amountCents) >= 5000) score += S.largeAmount; // 大额偶然撞号的概率低

  return { score: Math.min(score, 100), reasons };
}

export const pairKey = (aId: number, bId: number) => `${Math.min(aId, bId)}-${Math.max(aId, bId)}`;

export interface DuplicateQuery {
  bookId?: unknown;
  type?: unknown;
  window?: unknown;
  minScore?: unknown;
  minAmount?: unknown;
  from?: unknown;
  to?: unknown;
  sort?: unknown;
}

/**
 * 找出疑似重复的配对。三条候选来源缺一不可，各自的漏网场景不同：
 *   ① 同额 + 不同统一账户 → 钱包流水与银行卡流水
 *   ② externalId 相同     → 同一份文件导了两遍（可能落在同一账户上）
 *   ③ 同额 + 同账户 + 同一时刻 → 钱包账单把支付方式归一成了那张银行卡
 */
export async function findDuplicatePairs(actor: Actor, options: DuplicateQuery = {}): Promise<ScoredPair[]> {
  const type = ["expense", "income"].includes(String(options.type))
    ? String(options.type).toUpperCase()
    : "EXPENSE";
  const windowDays = Number(options.window) > 0 ? Number(options.window) : DUP.defaultWindowDays;
  const minScore = Number(options.minScore) || 0;
  const minCents = options.minAmount ? (yuanToCents(options.minAmount) ?? 0) : 0;
  const bookId = Number(options.bookId) || 0;
  const from = options.from ? String(options.from).slice(0, 10) : "";
  const to = options.to ? String(options.to).slice(0, 10) : "";

  /**
   * 占位符按需分配 —— 可选的过滤条件（账本 / 起止日期）要拼进三条完全不同的 SQL，
   * 写死 $5、$6 很容易在某一条里错位，交给这个小工厂统一发号。
   */
  const ph = (params: unknown[], value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  /** 账本 / 日期区间在所有候选查询里语义一致，抽出来复用 */
  const dateFilters = (alias: string, params: unknown[]): string[] => {
    const col = `${alias ? `${alias}.` : ""}"occurredAt"`;
    const out: string[] = [];
    if (from) out.push(`AND ${col} >= ${ph(params, from)}::date`);
    if (to) out.push(`AND ${col} < (${ph(params, to)}::date + INTERVAL '1 day')`);
    return out;
  };
  const bookFilter = (params: unknown[], ...exprs: string[]): string[] =>
    bookId ? exprs.map((expr) => `AND ${expr} = ${ph(params, bookId)}`) : [];

  const candidates: Array<{ a_id: number; b_id: number; same_account?: number }> = [];

  // ① 同额 + 不同统一账户
  const wideParams: unknown[] = [actor.id, type, minCents, windowDays];
  const wideExtra = [
    ...bookFilter(wideParams, `t1."bookId"`, `t2."bookId"`),
    ...dateFilters("t1", wideParams),
  ];
  const wide = await prisma.$queryRawUnsafe<Array<{ a_id: number; b_id: number }>>(
    `SELECT t1.id AS a_id, t2.id AS b_id
     FROM bill_transaction t1
     JOIN bill_transaction t2
       ON t2."ownerId" = t1."ownerId"
      AND t2.type = t1.type
      AND t2."amountCents" = t1."amountCents"
      AND t2.id > t1.id
     JOIN bill_account a1 ON a1.id = t1."accountId"
     JOIN bill_account a2 ON a2.id = t2."accountId"
     WHERE t1."ownerId" = $1 AND t1.type::text = $2
       AND t1."amountCents" >= $3
       -- PG 没有 abs(interval)，只能先算秒数差再比（windowDays 是「天」）
       AND ABS(EXTRACT(EPOCH FROM (t2."occurredAt" - t1."occurredAt"))) <= $4::int * 86400
       AND COALESCE(a1."mergedInto", a1.id) <> COALESCE(a2."mergedInto", a2.id)
       ${wideExtra.join(" ")}
     ORDER BY t1."occurredAt" DESC`,
    ...wideParams,
  );
  candidates.push(...wide);

  const seen = new Set(candidates.map((row) => `${row.a_id}-${row.b_id}`));

  // ② externalId 相同：不在 SQL 里用 TRIM 比较（会退化成平方级全表扫描），
  //    只在内存里分组配对
  const extParams: unknown[] = [actor.id, type];
  const extExtra = [
    ...bookFilter(extParams, `"bookId"`),
    ...dateFilters("", extParams),
  ];
  const extRows = await prisma.$queryRawUnsafe<Array<{ id: number; externalId: string | null }>>(
    `SELECT id, "externalId" FROM bill_transaction
     WHERE "ownerId" = $1 AND type::text = $2 AND COALESCE("externalId", '') <> ''
     ${extExtra.join(" ")}`,
    ...extParams,
  );
  const byExternal = new Map<string, number[]>();
  for (const row of extRows) {
    const key = String(row.externalId || "").trim();
    if (!key) continue;
    const list = byExternal.get(key) ?? [];
    list.push(Number(row.id));
    byExternal.set(key, list);
  }
  for (const ids of byExternal.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort((x, y) => x - y);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const key = `${sorted[i]}-${sorted[j]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ a_id: sorted[i], b_id: sorted[j] });
      }
    }
  }

  // ③ 同账户 + 同一时刻 + 同额
  const sameParams: unknown[] = [actor.id, type, minCents];
  const sameExtra = [
    ...bookFilter(sameParams, `t1."bookId"`, `t2."bookId"`),
    ...dateFilters("t1", sameParams),
  ];
  const sameRows = await prisma.$queryRawUnsafe<
    Array<{ a_id: number; b_id: number; same_account: number }>
  >(
    `SELECT t1.id AS a_id, t2.id AS b_id, 1 AS same_account
     FROM bill_transaction t1
     JOIN bill_transaction t2
       ON t2."ownerId" = t1."ownerId"
      AND t2.type = t1.type
      AND t2."amountCents" = t1."amountCents"
      AND t2."occurredAt" = t1."occurredAt"
      AND t2.id > t1.id
     JOIN bill_account a1 ON a1.id = t1."accountId"
     JOIN bill_account a2 ON a2.id = t2."accountId"
     WHERE t1."ownerId" = $1 AND t1.type::text = $2
       AND t1."amountCents" >= $3
       AND COALESCE(a1."mergedInto", a1.id) = COALESCE(a2."mergedInto", a2.id)
       ${sameExtra.join(" ")}`,
    ...sameParams,
  );
  for (const row of sameRows) {
    const key = `${row.a_id}-${row.b_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(row);
  }

  if (!candidates.length) return [];

  const ids = [...new Set(candidates.flatMap((row) => [row.a_id, row.b_id]))];
  const rows = await transactionsByIds(actor, ids);
  const txMap = new Map(rows.map((row) => [row.id, row]));

  const ignored = new Set(await listIgnores(actor.id));

  const pairs: ScoredPair[] = [];
  for (const candidate of candidates) {
    const a = txMap.get(candidate.a_id);
    const b = txMap.get(candidate.b_id);
    if (!a || !b) continue;
    const key = pairKey(candidate.a_id, candidate.b_id);
    if (ignored.has(key)) continue;
    const { score, reasons } = scorePair(a, b);
    // 同一个账户里的两笔，要有足够硬的证据才报：否则「连着买两杯一样的咖啡」会被误判
    if (candidate.same_account && score < DUP.sameAccountMinScore) continue;
    if (score < minScore) continue;
    pairs.push({
      key,
      score,
      reasons,
      amount: centsToYuan(a.amountCents),
      a: presentTransaction(a),
      b: presentTransaction(b),
    });
  }

  const byTime = (x: ScoredPair, y: ScoredPair) =>
    String(y.a.occurredAt).localeCompare(String(x.a.occurredAt)) || y.score - x.score;
  const byScore = (x: ScoredPair, y: ScoredPair) =>
    y.score - x.score || String(y.a.occurredAt).localeCompare(String(x.a.occurredAt));
  return pairs.sort(options.sort === "score" ? byScore : byTime);
}

export interface DuplicateGroup {
  key: string;
  ids: number[];
  score: number;
  reasons: string[];
  amount: string;
  count: number;
  items: ScoredPair["a"][];
}

/**
 * 把互相重叠的配对并成组。只有证据硬的配对才合并：
 * 「交易单号相同 / 商户单号相同 / 同一时刻 + 商户名一致（且至少一方带真实时刻）」。
 *
 * 为什么门槛这么高：连续几天在同一家店买同样价钱的早餐也能拿 90 分，
 * 用分数当合并条件会把它们串成一大组，一组十几条再点「删其余」就是灾难。
 * 弱的配对各自单独成组，用户自己看。
 */
export function groupDuplicates(
  pairs: ScoredPair[],
  options: { sort?: unknown; maxSize?: unknown } = {},
): DuplicateGroup[] {
  const maxSize = Number(options.maxSize) || DUP.groupMaxSize;

  // 银行流水常常只有日期（时间戳是 00:00:00），同一天同额的不同消费会假装「同一时刻」
  const hasTime = (tx: ScoredPair["a"]) => !String(tx.occurredAt || "").endsWith("00:00:00");
  const isStrong = (pair: ScoredPair) =>
    pair.reasons.includes("交易单号相同") ||
    pair.reasons.includes("商户单号相同") ||
    (pair.reasons.includes("同一时刻") &&
      pair.reasons.includes("商户名一致") &&
      (hasTime(pair.a) || hasTime(pair.b)));

  const parent = new Map<number, number>();
  const size = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const add = (x: number) => {
    if (parent.has(x)) return;
    parent.set(x, x);
    size.set(x, 1);
  };
  const union = (a: number, b: number) => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // 一组太大就不再往里连，避免一次误删一大片
    if ((size.get(ra) || 1) + (size.get(rb) || 1) > maxSize) return;
    parent.set(ra, rb);
    size.set(rb, (size.get(ra) || 1) + (size.get(rb) || 1));
  };

  const txMap = new Map<number, ScoredPair["a"]>();
  for (const pair of pairs) {
    txMap.set(pair.a.id, pair.a);
    txMap.set(pair.b.id, pair.b);
  }

  const strong = pairs.filter(isStrong);
  for (const pair of strong) union(pair.a.id, pair.b.id);
  const strongIds = new Set(strong.flatMap((pair) => [pair.a.id, pair.b.id]));

  const build = (
    ids: number[],
    score: number,
    reasons: string[],
    amount: string,
  ): DuplicateGroup | null => {
    const sorted = [...new Set(ids)].sort((x, y) => x - y);
    const items = sorted
      .map((id) => txMap.get(id))
      .filter((item): item is ScoredPair["a"] => !!item)
      .sort(
        (x, y) => String(x.occurredAt).localeCompare(String(y.occurredAt)) || x.id - y.id,
      );
    if (items.length < 2) return null;
    return { key: sorted.join("-"), ids: sorted, score, reasons: [...reasons], amount, count: items.length, items };
  };

  const groups: DuplicateGroup[] = [];
  const buckets = new Map<number, { ids: Set<number>; score: number; reasons: Set<string>; amount: string }>();
  for (const pair of strong) {
    const root = find(pair.a.id);
    let bucket = buckets.get(root);
    if (!bucket) {
      bucket = { ids: new Set(), score: 0, reasons: new Set(), amount: pair.amount };
      buckets.set(root, bucket);
    }
    bucket.ids.add(pair.a.id);
    bucket.ids.add(pair.b.id);
    bucket.score = Math.max(bucket.score, pair.score);
    pair.reasons.forEach((reason) => bucket!.reasons.add(reason));
  }
  for (const bucket of buckets.values()) {
    const group = build([...bucket.ids], bucket.score, [...bucket.reasons], bucket.amount);
    if (group) groups.push(group);
  }
  // 弱的配对单独成组；已经并进强组的那条不再重复出现，免得同一笔被删两次
  for (const pair of pairs) {
    if (isStrong(pair)) continue;
    if (strongIds.has(pair.a.id) || strongIds.has(pair.b.id)) continue;
    const group = build([pair.a.id, pair.b.id], pair.score, pair.reasons, pair.amount);
    if (group) groups.push(group);
  }

  const byTime = (x: DuplicateGroup, y: DuplicateGroup) =>
    String(y.items[0].occurredAt).localeCompare(String(x.items[0].occurredAt)) || y.score - x.score;
  const byScore = (x: DuplicateGroup, y: DuplicateGroup) =>
    y.score - x.score || String(y.items[0].occurredAt).localeCompare(String(x.items[0].occurredAt));
  return groups.sort(options.sort === "score" ? byScore : byTime);
}

// ---------------------------------------------------------------- 忽略名单

export async function listIgnores(userId: number): Promise<string[]> {
  const rows = await prisma.billDuplicateIgnore.findMany({
    where: { ownerId: userId },
    orderBy: { id: "desc" },
    select: { pairKey: true },
  });
  return rows.map((row) => row.pairKey);
}

export async function ignorePairs(userId: number, keys: string[]) {
  for (const key of keys) {
    await prisma.billDuplicateIgnore.upsert({
      where: { ownerId_pairKey: { ownerId: userId, pairKey: String(key) } },
      create: { ownerId: userId, pairKey: String(key) },
      update: {},
    });
  }
  return { ok: true, count: keys.length };
}

/** 传了 key 只取消那一条，不传就全清 */
export async function unignorePairs(userId: number, key?: string | null) {
  await prisma.billDuplicateIgnore.deleteMany({
    where: { ownerId: userId, ...(key ? { pairKey: String(key) } : {}) },
  });
  return { ok: true };
}

/**
 * 批量去重：每组只留一条，删掉其余。
 *   keys   —— 简单模式，形如 ['12-34','56-78']，按 keep=earlier/later 决定留哪条
 *   groups —— 直接给保留方案 [{ keepId, dropIds }]，界面自己算好了
 * 两条路径都要防「同一笔被别的组删过」的情况：删之前再查一次，不在了就跳过。
 */
export async function resolveDuplicates(
  actor: Actor,
  body: { keys?: unknown; groups?: unknown; keep?: unknown },
) {
  const keys = Array.isArray(body.keys) ? body.keys.map((k) => String(k || "")).filter(Boolean) : [];
  const groupPlan = Array.isArray(body.groups) ? body.groups : [];
  if (!keys.length && !groupPlan.length) throw new BillError("请先选择要处理的重复账单");
  const keep = body.keep === "later" ? "later" : "earlier";
  let removed = 0;
  let skipped = 0;

  for (const plan of groupPlan as Array<{ keepId?: unknown; dropIds?: unknown }>) {
    const keepId = Number(plan?.keepId) || 0;
    const dropIds = [
      ...new Set((Array.isArray(plan?.dropIds) ? plan.dropIds : []).map(Number).filter(Boolean)),
    ].filter((id) => id !== keepId);
    if (!keepId || !dropIds.length) {
      skipped += 1;
      continue;
    }
    const rows = await prisma.billTransaction.findMany({
      where: { ownerId: actor.id, id: { in: dropIds } },
      select: { id: true },
    });
    if (!rows.length) {
      skipped += 1;
      continue;
    }
    const res = await prisma.billTransaction.deleteMany({
      where: { ownerId: actor.id, id: { in: rows.map((row) => row.id) } },
    });
    removed += res.count;
  }

  for (const key of keys) {
    const [aId, bId] = String(key).split("-").map(Number);
    if (!aId || !bId) {
      skipped += 1;
      continue;
    }
    const rows = await prisma.billTransaction.findMany({
      where: { ownerId: actor.id, id: { in: [aId, bId] } },
      select: { id: true, occurredAt: true },
    });
    // 其中一条已经在别的配对里被删掉了，跳过
    if (rows.length < 2) {
      skipped += 1;
      continue;
    }
    const sorted = [...rows].sort(
      (x, y) => x.occurredAt.getTime() - y.occurredAt.getTime() || x.id - y.id,
    );
    const drop = keep === "later" ? sorted[0] : sorted[sorted.length - 1];
    await prisma.billTransaction.delete({ where: { id: drop.id } });
    removed += 1;
  }

  return { ok: true, removed, skipped };
}
