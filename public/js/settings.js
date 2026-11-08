/** 界面设置：每日目标、朗读开关。和词库数据分开存在 localStorage。 */

const GOAL_KEY = 'worddrill.goal';
const TTS_KEY = 'worddrill.tts';
const AUTO_BACKUP_KEY = 'worddrill.autobackup';
const BACKUP_INTERVAL_KEY = 'worddrill.backupInterval';
const BACKUP_KEEP_KEY = 'worddrill.backupKeep';

export const GOAL_DEFAULT = 30;
export const GOAL_MIN = 5;
export const GOAL_MAX = 200;

export const AUTO_BACKUP_DEFAULT = 'on';
export const BACKUP_INTERVAL_DEFAULT = 6;
export const BACKUP_INTERVAL_MIN = 0;
export const BACKUP_INTERVAL_MAX = 168;
export const BACKUP_KEEP_DEFAULT = 3;
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 50;

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* 隐私模式下写不进去，忽略 */ }
}

/** 每日目标题量，超出范围时回到默认值。 */
export function dailyGoal() {
  const value = Number(read(GOAL_KEY, GOAL_DEFAULT));
  if (!Number.isFinite(value)) return GOAL_DEFAULT;
  return Math.min(Math.max(Math.trunc(value), GOAL_MIN), GOAL_MAX);
}

export function setDailyGoal(value) {
  const next = Math.min(Math.max(Math.trunc(Number(value) || GOAL_DEFAULT), GOAL_MIN), GOAL_MAX);
  write(GOAL_KEY, next);
  return next;
}

/** 练习时是否自动/手动朗读，默认开启。 */
export function ttsEnabled() {
  return read(TTS_KEY, 'on') !== 'off';
}

export function setTtsEnabled(enabled) {
  write(TTS_KEY, enabled ? 'on' : 'off');
}

/** 是否启用自动备份，默认开启。 */
export function autoBackupEnabled() {
  return read(AUTO_BACKUP_KEY, AUTO_BACKUP_DEFAULT) !== 'off';
}

export function setAutoBackupEnabled(enabled) {
  write(AUTO_BACKUP_KEY, enabled ? 'on' : 'off');
}

/** 自动备份间隔（小时），0 表示只在页面关闭/隐藏前防抖写入，不定时落盘快照。 */
export function backupIntervalHours() {
  const value = Number(read(BACKUP_INTERVAL_KEY, BACKUP_INTERVAL_DEFAULT));
  if (!Number.isFinite(value)) return BACKUP_INTERVAL_DEFAULT;
  return Math.min(Math.max(Math.trunc(value), BACKUP_INTERVAL_MIN), BACKUP_INTERVAL_MAX);
}

export function setBackupIntervalHours(hours) {
  const next = Math.min(Math.max(Math.trunc(Number(hours) || BACKUP_INTERVAL_DEFAULT), BACKUP_INTERVAL_MIN), BACKUP_INTERVAL_MAX);
  write(BACKUP_INTERVAL_KEY, next);
  return next;
}

/** 最多保留多少份自动备份快照（Web 里体现为 localStorage 备份快照份数）。 */
export function backupKeepCount() {
  const value = Number(read(BACKUP_KEEP_KEY, BACKUP_KEEP_DEFAULT));
  if (!Number.isFinite(value)) return BACKUP_KEEP_DEFAULT;
  return Math.min(Math.max(Math.trunc(value), BACKUP_KEEP_MIN), BACKUP_KEEP_MAX);
}

export function setBackupKeepCount(count) {
  const next = Math.min(Math.max(Math.trunc(Number(count) || BACKUP_KEEP_DEFAULT), BACKUP_KEEP_MIN), BACKUP_KEEP_MAX);
  write(BACKUP_KEEP_KEY, next);
  return next;
}
