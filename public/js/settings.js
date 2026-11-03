/** 界面设置：每日目标、朗读开关。和词库数据分开存在 localStorage。 */

const GOAL_KEY = 'worddrill.goal';
const TTS_KEY = 'worddrill.tts';

export const GOAL_DEFAULT = 30;
export const GOAL_MIN = 5;
export const GOAL_MAX = 200;

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
