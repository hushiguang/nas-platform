import { appBaseUrl, parseHm, scopeCondition, zonedDate, type PlatformAccess, type SessionUser } from "@nas/core";
import { prisma, type AnniversaryType, type CalendarType, type Prisma } from "@nas/db";
import { galleryById, gradientById, isAllowedImageUrl } from "@nas/media";
import { Solar } from "lunar-javascript";
import { typeMeta, yearsText } from "@/lib/labels";
import { AnniversaryError } from "./errors";
import {
  dateParts,
  lunarToSolar,
  nextOccurrence,
  UPCOMING_DAYS,
  ymd,
  type Occurrence,
} from "./occur";

export { UPCOMING_DAYS };

const TYPES: AnniversaryType[] = ["BIRTHDAY", "MARRIAGE", "PROPOSAL", "COUNTDOWN", "OTHER"];

export interface BillDraft {
  id?: number;
  year: string;
  label: string;
  href: string;
}

export interface BillView {
  id: number;
  year: number | null;
  label: string;
  href: string;
  createdAt: Date;
}

export interface AnniversaryDraft {
  id?: number;
  name: string;
  type: AnniversaryType;
  calendar: "SOLAR" | "LUNAR";
  /** 公历日期，给日期控件用 */
  date: string;
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  lunarLeap: boolean;
  icon: string;
  background: string;
  note: string;
  bills: BillDraft[];
  remindDays: number[];
  remindTime: string;
}

export interface AnniversaryView {
  id: number;
  name: string;
  type: AnniversaryType;
  typeLabel: string;
  icon: string;
  calendar: "SOLAR" | "LUNAR";
  note: string | null;
  bills: BillView[];
  background: string | null;
  remindDays: number[];
  remindTime: string | null;
  occurrence: Occurrence;
  yearsLabel: string | null;
  draft: AnniversaryDraft;
}

const withBills = { bills: true } satisfies Prisma.AnniversaryInclude;
type AnniversaryRow = Prisma.AnniversaryGetPayload<{ include: typeof withBills }>;

function solarToLunar(year: number, month: number, day: number) {
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  return {
    year: lunar.getYear(),
    month: Math.abs(lunar.getMonth()),
    day: lunar.getDay(),
    leap: lunar.getMonth() < 0,
  };
}

function sortedBills(row: AnniversaryRow): BillView[] {
  return [...row.bills]
    .sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || a.sort - b.sort)
    .map((bill) => ({
      id: bill.id,
      year: bill.year,
      label: bill.label,
      href: bill.href,
      createdAt: bill.createdAt,
    }));
}

function toDraft(row: AnniversaryRow): AnniversaryDraft {
  const origin = dateParts(row.date);
  const base = {
    id: row.id,
    name: row.name,
    type: row.type,
    calendar: row.calendar,
    icon: row.icon ?? "",
    background: row.background ?? "",
    note: row.note ?? "",
    bills: sortedBills(row).map((bill) => ({
      id: bill.id,
      year: bill.year == null ? "" : String(bill.year),
      label: bill.label,
      href: bill.href,
    })),
    remindDays: row.remindDays,
    remindTime: row.remindTime ?? "",
  };

  if (row.calendar === "LUNAR") {
    const month = row.lunarMonth ?? origin.m;
    const day = row.lunarDay ?? origin.d;
    return {
      ...base,
      date: lunarToSolar(origin.y, month, day, row.lunarLeap) ?? ymd(origin.y, 1, 1),
      lunarYear: origin.y,
      lunarMonth: month,
      lunarDay: day,
      lunarLeap: row.lunarLeap,
    };
  }

  const lunar = solarToLunar(origin.y, origin.m, origin.d);
  return {
    ...base,
    date: ymd(origin.y, origin.m, origin.d),
    lunarYear: lunar.year,
    lunarMonth: lunar.month,
    lunarDay: lunar.day,
    lunarLeap: lunar.leap,
  };
}

export function present(row: AnniversaryRow): AnniversaryView {
  const occurrence = nextOccurrence(row);
  const meta = typeMeta(row.type);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    typeLabel: meta.label,
    icon: row.icon || meta.icon,
    calendar: row.calendar,
    note: row.note,
    bills: sortedBills(row),
    background: row.background,
    remindDays: row.remindDays,
    remindTime: row.remindTime,
    occurrence,
    yearsLabel: yearsText(row.type, occurrence.years),
    draft: toDraft(row),
  };
}

function scope(access: PlatformAccess, userId: number) {
  return scopeCondition(access, userId);
}

export async function listAnniversaries(access: PlatformAccess, userId: number) {
  const rows = await prisma.anniversary.findMany({ where: scope(access, userId), include: withBills });
  return rows
    .map(present)
    .sort((a, b) => (a.occurrence.days ?? 99_999) - (b.occurrence.days ?? 99_999) || a.id - b.id);
}

/** 正好撞上用户勾选的那几天 */
function onReminderDay(days: number | null, remindDays: number[]): boolean {
  return days != null && remindDays.includes(days);
}

/**
 * 是否收成门户待办：到提醒日，或者已经进了 30 天窗口。
 * 没勾提醒日的纪念日只要进了窗口也收 —— 门户「近30天」卡片和待办列表的口径保持一致。
 */
function todoDue(days: number | null, remindDays: number[]): boolean {
  return days != null && (onReminderDay(days, remindDays) || days <= UPCOMING_DAYS);
}

/** 门户展示用：30 天内临近的都展示，不要求正好撞上提醒日 */
function withinUpcoming(rows: AnniversaryRow[]) {
  return rows
    .map(present)
    .filter((item) => item.occurrence.days != null && item.occurrence.days <= UPCOMING_DAYS)
    .sort((a, b) => (a.occurrence.days ?? 0) - (b.occurrence.days ?? 0) || a.id - b.id);
}

/** 门户汇总用：只看这个人自己的，取近30天临近的 */
export async function upcomingForUser(userId: number) {
  const rows = await prisma.anniversary.findMany({ where: { ownerId: userId }, include: withBills });
  return withinUpcoming(rows);
}

/** 管理员的待办页：所有人近30天临近的纪念日提醒 */
export async function upcomingAll() {
  const rows = await prisma.anniversary.findMany({ include: withBills });
  return withinUpcoming(rows);
}

export async function getAnniversary(access: PlatformAccess, userId: number, id: number) {
  const row = await prisma.anniversary.findFirst({
    where: { id, ...scope(access, userId) },
    include: withBills,
  });
  return row ? present(row) : null;
}

function readText(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AnniversaryError("日期不对");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new AnniversaryError("日期不对");
  }
  return date;
}

function parseRemindDays(form: FormData): number[] {
  const days = form
    .getAll("remindDays")
    .map((value) => Number(value))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  return [...new Set(days)].sort((a, b) => b - a).slice(0, 8);
}

function parseBackground(raw: string): string | null {
  if (!raw) return null;
  if (raw.startsWith("gallery:")) {
    const id = raw.slice("gallery:".length);
    if (!galleryById(id)) throw new AnniversaryError("没有这张背景");
    return `gallery:${id}`;
  }
  if (raw.startsWith("gradient:")) {
    const id = raw.slice("gradient:".length);
    if (!gradientById(id)) throw new AnniversaryError("没有这张背景");
    return `gradient:${id}`;
  }
  if (!isAllowedImageUrl(raw)) throw new AnniversaryError("这张图片不在图床上");
  return raw;
}

/** 账单链接必须落在账单应用里，避免变成任意外链 */
function parseBillHref(raw: string): string | null {
  if (!raw) return null;
  if (raw.length > 500) throw new AnniversaryError("账单链接太长了");
  const base = appBaseUrl("bill");
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return base ? `${base}${raw}` : raw;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AnniversaryError("账单链接格式不对");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AnniversaryError("账单链接格式不对");
  }
  if (!base) throw new AnniversaryError("还没配置账单地址，先填以 / 开头的路径");
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    throw new AnniversaryError("账单地址配置不对");
  }
  if (url.origin !== baseUrl.origin) throw new AnniversaryError("账单链接需要指向账单");
  return url.toString();
}

function parseForm(form: FormData) {
  const name = readText(form, "name");
  if (!name) throw new AnniversaryError("先写个名字");
  if (name.length > 40) throw new AnniversaryError("名字太长了");

  const type = readText(form, "type") as AnniversaryType;
  if (!TYPES.includes(type)) throw new AnniversaryError("类型不对");

  const calendar: CalendarType = readText(form, "calendar") === "LUNAR" ? "LUNAR" : "SOLAR";
  let date: Date;
  let lunarMonth: number | null = null;
  let lunarDay: number | null = null;
  let lunarLeap = false;

  if (calendar === "SOLAR") {
    const raw = readText(form, "date");
    if (type === "BIRTHDAY" && !raw) throw new AnniversaryError("先填出生年月日");
    date = parseIsoDate(raw);
  } else {
    const year = Number(readText(form, "lunarYear"));
    lunarMonth = Number(readText(form, "lunarMonth"));
    lunarDay = Number(readText(form, "lunarDay"));
    lunarLeap = form.get("lunarLeap") === "on";
    if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new AnniversaryError("农历年份不对");
    if (!Number.isInteger(lunarMonth) || lunarMonth < 1 || lunarMonth > 12) {
      throw new AnniversaryError("农历月份不对");
    }
    if (!Number.isInteger(lunarDay) || lunarDay < 1 || lunarDay > 30) throw new AnniversaryError("农历日子不对");
    const solar = lunarToSolar(year, lunarMonth, lunarDay, lunarLeap);
    if (!solar) {
      throw new AnniversaryError(lunarLeap ? "这一年没有这个闰月" : "农历里没有这一天");
    }
    if (type === "BIRTHDAY" && solar > zonedDate(new Date())) {
      throw new AnniversaryError("出生日期不能晚于今天");
    }
    date = new Date(Date.UTC(year, 0, 1));
  }

  if (type === "BIRTHDAY" && calendar === "SOLAR") {
    const born = ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    if (born > zonedDate(new Date())) throw new AnniversaryError("出生日期不能晚于今天");
  }

  const remindTimeRaw = readText(form, "remindTime").slice(0, 5);
  const remindTime = remindTimeRaw ? parseHm(remindTimeRaw) : null;
  if (remindTimeRaw && remindTime == null) throw new AnniversaryError("提醒时间不对");

  const note = readText(form, "note");
  if (note.length > 500) throw new AnniversaryError("备注太长了");
  const icon = readText(form, "icon");
  if (icon.length > 8) throw new AnniversaryError("图标太长了");
  return {
    name,
    type,
    calendar,
    date,
    lunarMonth,
    lunarDay,
    lunarLeap,
    remindDays: parseRemindDays(form),
    remindTime: remindTimeRaw && remindTime != null ? remindTimeRaw : null,
    note: note || null,
    icon: icon || null,
    background: parseBackground(readText(form, "background")),
  };
}

function parseBills(
  form: FormData,
): { id: number | null; year: number | null; label: string; href: string }[] {
  const ids = form.getAll("billId").map(String);
  const years = form.getAll("billYear").map(String);
  const labels = form.getAll("billLabel").map(String);
  const hrefs = form.getAll("billHref").map(String);
  if (ids.length !== hrefs.length || years.length !== hrefs.length || labels.length !== hrefs.length) {
    throw new AnniversaryError("账单没填完整");
  }

  const bills: { id: number | null; year: number | null; label: string; href: string }[] = [];
  for (let i = 0; i < hrefs.length; i += 1) {
    const hrefRaw = hrefs[i].trim();
    const label = labels[i].trim();
    const yearRaw = years[i].trim();
    if (!hrefRaw && !label) continue;
    const href = parseBillHref(hrefRaw);
    if (!href) throw new AnniversaryError("账单链接还没填");
    if (label.length > 24) throw new AnniversaryError("链接文字太长了");
    let year: number | null = null;
    if (yearRaw) {
      year = Number(yearRaw);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) {
        throw new AnniversaryError("账单年份不对");
      }
    }
    const rawId = ids[i].trim();
    let id: number | null = null;
    if (rawId) {
      id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) throw new AnniversaryError("账单不对");
    }
    bills.push({ id, year, label: label || "查看账单", href });
  }
  if (bills.length > 30) throw new AnniversaryError("账单太多了");
  return bills;
}

export async function saveAnniversary(
  user: SessionUser,
  access: PlatformAccess,
  form: FormData,
): Promise<number> {
  const data = parseForm(form);
  const bills = parseBills(form);
  const rawId = Number(readText(form, "id"));
  const id = Number.isInteger(rawId) && rawId > 0 ? rawId : null;

  return prisma.$transaction(async (tx) => {
    let anniversaryId = id;
    if (!anniversaryId) {
      const created = await tx.anniversary.create({
        data: { ...data, ownerId: user.id },
      });
      anniversaryId = created.id;
    } else {
      const existing = await tx.anniversary.findFirst({
        where: { id: anniversaryId, ...scope(access, user.id) },
        select: { id: true },
      });
      if (!existing) throw new AnniversaryError("找不到这个纪念日", 404);
      await tx.anniversary.update({ where: { id: anniversaryId }, data });
    }

    const owned = new Set(
      (
        await tx.anniversaryBill.findMany({
          where: { anniversaryId },
          select: { id: true },
        })
      ).map((bill) => bill.id),
    );
    const keep: number[] = [];
    for (const [sort, bill] of bills.entries()) {
      const fields = { year: bill.year, label: bill.label, href: bill.href, sort };
      if (bill.id && owned.has(bill.id)) {
        await tx.anniversaryBill.update({ where: { id: bill.id }, data: fields });
        keep.push(bill.id);
      } else {
        const created = await tx.anniversaryBill.create({
          data: { ...fields, anniversaryId },
        });
        keep.push(created.id);
      }
    }
    await tx.anniversaryBill.deleteMany({
      where: keep.length > 0 ? { anniversaryId, id: { notIn: keep } } : { anniversaryId },
    });
    return anniversaryId;
  });
}

/** 上海时区的那天、那个钟点。提醒时点按这个来，不跟服务器本地时区走 */
function shanghaiDue(iso: string, hm: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  const [hour, minute] = hm.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, (hour || 0) - 8, minute || 0, 0));
}

function utcDay(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * 把「到提醒日」或「已进 30 天窗口」的纪念日收成待办。
 *
 * 每个纪念日同时只留一条未完成的：重跑时先把 triggerDate 不是今天的未完成记录删掉，
 * 当天这条再 upsert 回来 —— 所以 30 天窗口不会堆成 30 条，勾了 30/7/1 也不会重复。
 * 已完成的记录不动，留作历史。既不是提醒日、又在窗口外的，把未完成的清掉。
 */
export async function syncReminderTodos(): Promise<number> {
  const rows = await prisma.anniversary.findMany({ include: withBills });
  const today = utcDay(zonedDate(new Date()));
  let count = 0;
  for (const row of rows) {
    const occurrence = nextOccurrence(row);
    const due = Boolean(occurrence.date) && todoDue(occurrence.days, row.remindDays);
    await prisma.todo.deleteMany({
      where: {
        source: "ANNIVERSARY",
        sourceBizId: `anniversary:${row.id}`,
        status: { not: "DONE" },
        ...(due ? { triggerDate: { not: today } } : {}),
      },
    });
    if (!due || !occurrence.date || occurrence.days == null) continue;

    const hm = row.remindTime ?? "09:00";
    const when = `${occurrence.countdown} · ${occurrence.when.replace("下次 ", "")}`;
    const billText = sortedBills(row)
      .map((bill) => (bill.year ? `${bill.year} ${bill.label}` : bill.label))
      .join("、");
    const description = [when, row.note, billText].filter(Boolean).join("\n");
    const remindRules = row.remindDays.map((offsetDays) => ({ offsetDays, time: hm }));
    const priority = occurrence.days <= 1 ? "HIGH" : "MEDIUM";
    const sourceBizId = `anniversary:${row.id}`;
    const triggerDate = today;

    await prisma.todo.upsert({
      where: {
        source_sourceBizId_triggerDate: {
          source: "ANNIVERSARY",
          sourceBizId,
          triggerDate,
        },
      },
      create: {
        title: row.name,
        description,
        source: "ANNIVERSARY",
        sourceBizId,
        priority,
        dueTime: shanghaiDue(occurrence.date, hm),
        remindRules,
        triggerDate,
        owner: { connect: { id: row.ownerId } },
      },
      update: {
        title: row.name,
        description,
        priority,
        dueTime: shanghaiDue(occurrence.date, hm),
        remindRules,
      },
    });
    count += 1;
  }
  return count;
}

export async function removeAnniversary(access: PlatformAccess, userId: number, id: number) {
  const existing = await prisma.anniversary.findFirst({
    where: { id, ...scope(access, userId) },
    select: { id: true },
  });
  if (!existing) throw new AnniversaryError("找不到这个纪念日", 404);
  await prisma.$transaction([
    prisma.todo.deleteMany({
      where: {
        source: "ANNIVERSARY",
        sourceBizId: `anniversary:${id}`,
        status: { not: "DONE" },
      },
    }),
    prisma.anniversary.delete({ where: { id } }),
  ]);
}

export function remindText(days: number[], time: string | null): string | null {
  if (days.length === 0) return null;
  const parts = [...days]
    .sort((a, b) => b - a)
    .map((day) => (day === 0 ? "当天" : `提前 ${day} 天`));
  return `${parts.join("、")}${time ? ` · ${time}` : ""}`;
}

export function emptyDraft(): AnniversaryDraft {
  const today = new Date();
  const year = today.getFullYear();
  const lunar = solarToLunar(year, today.getMonth() + 1, today.getDate());
  return {
    name: "",
    type: "BIRTHDAY",
    calendar: "SOLAR",
    date: "",
    lunarYear: lunar.year,
    lunarMonth: lunar.month,
    lunarDay: lunar.day,
    lunarLeap: lunar.leap,
    icon: "",
    background: "gallery:cake",
    note: "",
    bills: [],
    remindDays: [30, 7, 1, 0],
    remindTime: "09:00",
  };
}
