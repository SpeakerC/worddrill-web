/**
 * 间隔重复与打卡统计，纯函数，浏览器与 Node 共用。
 * 规则与 Android 版 ReviewScheduler / StreakCalc 一致：
 *   答对：等级 + 1，按 1 → 2 → 4 → 7 → 15 → 30 → 60 天安排下次复习；
 *   答错：等级归零，第二天再来，并累加遗忘次数。
 * 所有练过的单词都会进入复习排期（见 store.js 的 recordAnswer / ensureReviewRecords），
 * 不只是错题：新练的词等级为 0，当天随时可以在「复习」里再过一遍。
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_LEVEL = 7;

const INTERVALS = [1, 2, 4, 7, 15, 30, 60];

/** 答完题后的新等级。 */
export function nextLevel(level, correct) {
  if (!correct) return 0;
  return Math.min(Math.max(Math.trunc(Number(level) || 0), 0) + 1, MAX_LEVEL);
}

/** 距离下次复习的天数。答错固定 1 天。 */
export function intervalDays(level, correct) {
  if (!correct) return 1;
  const index = Math.min(Math.max(Math.trunc(Number(level) || 1), 1), MAX_LEVEL);
  return INTERVALS[index - 1];
}

/** 下次复习的时间戳。 */
export function nextDueAt(level, correct, now = Date.now()) {
  return now + intervalDays(nextLevel(level, correct), correct) * DAY_MS;
}

/**
 * 复习曲线见上。这里只放纯函数；排期读写、复习列表在 store.js。
 */

/** 本地时区的日期键：2026-11-03。 */
export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 最近 days 天（含今天）的日期键，从旧到新。 */
export function recentDayKeys(days, now = Date.now()) {
  const count = Math.max(0, Math.trunc(Number(days) || 0));
  const out = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    out.push(dayKey(d));
  }
  return out;
}

/** 从今天起往后 days 天（含今天）的日期键，从近到远。 */
export function upcomingDayKeys(days, now = Date.now()) {
  const count = Math.max(0, Math.trunc(Number(days) || 0));
  const out = [];
  for (let offset = 0; offset < count; offset += 1) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    out.push(dayKey(d));
  }
  return out;
}

/**
 * 连续打卡天数。今天练过就从今天往前数；今天还没练不算断签，从昨天开始数。
 */
export function streak(today, studiedDates) {
  const set = studiedDates instanceof Set ? studiedDates : new Set(studiedDates || []);
  const cursor = new Date(`${today}T12:00:00`);
  if (Number.isNaN(cursor.getTime())) return 0;
  if (!set.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (set.has(dayKey(cursor)) && count <= 3650) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}
