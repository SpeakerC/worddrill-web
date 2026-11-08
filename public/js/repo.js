/**
 * 应用数据层：把 UI 需要的东西整理成一组异步函数。
 * 浏览器里直接读写本地存储，没有服务器、没有网络请求。
 */
import { Store } from './store.js';
import { buildItems, MODES, isCorrect } from './quiz.js';
import { parseMarkdown, decodeText } from './vocab.js';
import { parseAbout } from './about.js';
import { createStorage, getLocalStorage, memoryStorage, exportBackup, parseBackup, clearCache } from './persist.js';
import { autoBackupEnabled, backupIntervalHours, backupKeepCount } from './settings.js';

export const VERSION = 'web-1.13';
export { MODES, isCorrect };

let autoTimer = 0;

/** 启动定时自动备份：每 interval 小时落盘一份快照到 localStorage。interval <= 0 不定时。 */
function startAutoBackup() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = 0; }
  if (!autoBackupEnabled()) return;
  const hours = backupIntervalHours();
  if (hours <= 0) return;
  const ms = hours * 60 * 60 * 1000;
  autoTimer = setInterval(() => {
    if (store) storage.saveAutoBackup(store.db, backupKeepCount());
  }, ms);
  // 不保存定时器到 unref，页面关闭时自然停止
}

const SEED_URL = new URL('../assets/words3500.json', import.meta.url);
const ABOUT_URL = new URL('../assets/about.txt', import.meta.url);

let store = null;
let storage = null;
let about = null;
let persistent = false;
let storageError = null;

function requireStore() {
  if (!store) throw new Error('数据还没准备好');
  return store;
}

async function loadSeed() {
  const res = await fetch(SEED_URL);
  if (!res.ok) throw new Error(`内置词表加载失败（${res.status}）`);
  return res.json();
}

/**
 * 内置词库清单。seedId 一旦发布就不能改——老用户靠它判断「这本已经有了」。
 *
 * 更新规则：
 *   - 加词库：往数组末尾追加一条，BUILTIN_VERSION +1；
 *   - 删词库：从数组里删掉即可，同时把 seedId 记进 RETIRED_SEEDS，
 *     这样已经种过的老用户不会因为「清单里没有」而反复处理它。
 * 补种只会新增清单里尚未存在的词库，永远不会重建用户已有的或已删掉的词库。
 */
const BUILTIN_VERSION = 3;

/** 下架过的内置词库：不再出现在清单里，也不再补种。 */
const RETIRED_SEEDS = ['senior-ext'];

const BUILTIN_BOOKS = [
  {
    seedId: 'senior-3500',
    name: '高中 3500 词',
    url: SEED_URL,
  },
  {
    seedId: 'cet4',
    name: '大学英语四级',
    url: new URL('../assets/words-cet4.json', import.meta.url),
  },
];

/** 逐个取回内置词表；某一本取不到就跳过，不影响其他词库播种。 */
async function loadBuiltins() {
  const out = [];
  for (const book of BUILTIN_BOOKS) {
    try {
      const res = await fetch(book.url);
      if (!res.ok) continue;
      const entries = await res.json();
      if (Array.isArray(entries) && entries.length) {
        out.push({ seedId: book.seedId, name: book.name, entries });
      }
    } catch {
      // 断网或文件缺失：跳过这本，下次加载再补
    }
  }
  return out;
}

async function loadAbout() {
  const fallback = { name: '单词练习', version: VERSION, developer: '', summary: '', rows: [], note: '' };
  try {
    const res = await fetch(ABOUT_URL, { cache: 'no-cache' });
    if (!res.ok) return fallback;
    return parseAbout(await res.text(), fallback);
  } catch {
    return fallback;
  }
}

/**
 * 首次使用：播种内置词库；之后从 localStorage 恢复。
 * 老用户数据里 seedVersion 落后时，补种新增的内置词库（不动已有记录）。
 * @param {{onStorageError?: (err: Error) => void}} options
 */
export async function init(options = {}) {
  const backing = getLocalStorage();
  persistent = Boolean(backing);
  storage = createStorage({
    storage: backing || memoryStorage(),
    onError: (err) => {
      storageError = err;
      if (options.onStorageError) options.onStorageError(err);
    },
  });

  let db = storage.load();
  let seeded = false;
  if (!db) {
    // 全新用户：一次把清单里的词库全部种下
    const builtins = await loadBuiltins();
    const fresh = new Store();
    fresh.applyBuiltins(builtins, BUILTIN_VERSION);
    db = fresh.db;
    seeded = true;
  }
  store = new Store({ db, onChange: (part) => storage.save(part) });
  storage.bind(store.db);
  if (seeded) storage.save('all');

  // 老用户：清单版本落后时同步一次——补种新增的词库、删掉已下架的，已有词库不动
  if (store.db.seedVersion < BUILTIN_VERSION) {
    const builtins = await loadBuiltins();
    const { added, removed, merged } = store.syncBuiltins(builtins, BUILTIN_VERSION, RETIRED_SEEDS);
    if (added.length || removed.length || merged) storage.save('all');
  } else {
    // 版本已最新：仍跑一次去重，收拾早期版本留下的重名内置词库（例如两个「高中 3500 词」）
    const { merged } = store.dedupeBuiltins();
    if (merged) storage.save('all');
  }

  // 老数据可能「练过但没有复习排期」，加载时补齐，保证所有练过的词都进复习
  store.ensureReviewRecords();
  about = await loadAbout();
  startAutoBackup();
  return bootstrap();
}

/** 数据里记的内置词库版本与清单版本，设置页用来显示。 */
export function builtinInfo() {
  const s = requireStore();
  return {
    seedVersion: s.db.seedVersion,
    latest: BUILTIN_VERSION,
    books: s.books().filter((b) => b.builtin),
  };
}

export function bootstrap() {
  return { books: requireStore().books(), about, modes: MODES, version: VERSION };
}

export function info() {
  return {
    persistent,
    usageBytes: storage ? storage.usageBytes() : 0,
    storageError: storageError ? storageError.message : '',
  };
}

export function stats(bookId) {
  const book = requireStore().book(bookId);
  if (!book) throw new Error('词库不存在');
  return { ...book, ...requireStore().stats(book.id) };
}

export function listWords(bookId, filter = 'all', query = '') {
  return { words: requireStore().words(bookId, filter, query) };
}

/**
 * 错题本。
 * @param {number} bookId
 * @param {{sort?: string, query?: string}} opts sort: recent / wrong / alpha
 */
export function listMistakes(bookId, opts = {}) {
  const items = requireStore().mistakes(bookId, opts);
  return {
    words: items.map((item) => item.word),
    counts: Object.fromEntries(items.map((item) => [item.word.id, item.wrong])),
    streaks: Object.fromEntries(items.map((item) => [item.word.id, item.streak])),
    items,
  };
}

/** 从错题本手动移出一个词。 */
export function removeMistake(wordId) {
  const ok = requireStore().removeMistake(Number(wordId));
  if (!ok) throw new Error('这个词不在错题本里');
  return { ok };
}

/**
 * 「已学过」：当前词库练过的词。
 * @param {number} bookId
 * @param {'all'|'unmastered'|'mastered'|'forgetting'} filter
 */
export function studied(bookId, filter = 'all', query = '') {
  const s = requireStore();
  s.ensureReviewRecords();
  return {
    words: s.studiedWords(Number(bookId), filter, query),
    counts: s.studiedCounts(Number(bookId)),
  };
}

export function answer(wordId, mode, correct) {
  const id = Number(wordId);
  if (!id) throw new Error('缺少单词');
  requireStore().recordAnswer(id, MODES[mode] ? mode : 'en_zh', Boolean(correct));
  return { ok: true };
}

export function startPractice(body = {}) {
  const s = requireStore();
  const mode = MODES[body.mode] ? body.mode : 'en_zh';
  const book = s.book(Number(body.bookId));
  if (!book) throw new Error('词库不存在');
  const count = Math.min(Math.max(Number.parseInt(body.count, 10) || 20, 1), 200);
  const start = Number.isFinite(Number(body.start)) ? Number(body.start) : 1;
  const end = Number.isFinite(Number(body.end)) ? Number(body.end) : Number.MAX_SAFE_INTEGER;
  const filter = ['all', 'starred', 'mistakes'].includes(body.filter) ? body.filter : 'all';
  const allowRepeat = body.allowRepeat !== false;
  const ids = Array.isArray(body.wordIds) ? body.wordIds.map(Number) : [];
  const words = ids.length > 0
    ? s.wordsByIds(ids)
    : s.pickWords(book.id, { start, end, count, allowRepeat, filter });
  const requested = ids.length > 0 ? ids.length : count;
  return {
    items: buildItems(words, s.allWords(), requested, mode),
    requested,
    mode,
    bookName: body.bookName || book.name,
  };
}

/**
 * 复习列表：练过的词都进来，不只是错题。
 * scope = 'due'（今天该复习，默认）或 'all'（全部练过的词）。
 */
export function dueReview(limit = 200, scope = 'due') {
  const s = requireStore();
  s.ensureReviewRecords();
  return {
    count: s.reviewWordCount(scope),
    words: s.reviewWords(limit, scope),
    stats: s.reviewStats(),
    scope,
  };
}

/** 学习报告：近 days 天统计 + 掌握度 + 未来复习量 + 最该复习的词。 */
export function report(days = 7, goal = 30) {
  const s = requireStore();
  return {
    summary: s.studySummary(days, goal),
    mastery: s.masteryStats(null),
    upcoming: s.upcomingReview(days),
    wrong: s.topWrongWords(null, 8),
  };
}

/**
 * 一组词练完后的下次复习情况，结果页用。
 * @param {number[]} wordIds
 */
export function nextReviewOf(wordIds) {
  const s = requireStore();
  const ids = new Set((Array.isArray(wordIds) ? wordIds : []).map(Number));
  const now = Date.now();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const records = s.db.review.filter((r) => ids.has(r.wordId));
  if (!records.length) {
    return { total: 0, today: 0, tomorrow: 0, later: 0, label: '还没排期', earliestDueAt: 0 };
  }
  let today = 0;
  let tomorrow = 0;
  let later = 0;
  let earliest = Infinity;
  for (const r of records) {
    earliest = Math.min(earliest, r.dueAt || 0);
    const d = new Date(r.dueAt || 0); d.setHours(0, 0, 0, 0);
    const days = Math.round((d - startToday) / 86400000);
    if (days <= 0) today += 1;
    else if (days === 1) tomorrow += 1;
    else later += 1;
  }
  const days = Math.round((new Date(earliest).setHours(0, 0, 0, 0) - startToday) / 86400000);
  const label = days <= 0 ? '今天' : (days === 1 ? '明天' : `${days} 天后`);
  return { total: records.length, today, tomorrow, later, label, earliestDueAt: earliest };
}

export function setStar(wordId, starred) {
  const ok = requireStore().setStar(Number(wordId), Boolean(starred));
  if (!ok) throw new Error('单词不存在');
  return { ok };
}

export function setBlocked(wordId, blocked) {
  const ok = requireStore().setBlocked(Number(wordId), Boolean(blocked));
  if (!ok) throw new Error('单词不存在');
  return { ok };
}

export function unblockAll(bookId) {
  return { changed: requireStore().unblockAll(Number(bookId)) };
}

export function clearMistakes(bookId) {
  requireStore().clearMistakes(Number(bookId));
  return { ok: true };
}

export function clearLog() {
  const s = requireStore();
  s.clearPracticeLog();
  return { ok: true };
}

/** 全部练过的单词（复习页用）。 */
export function reviewTotal() {
  return requireStore().reviewWordCount('all');
}

export function deleteBook(bookId) {
  if (!requireStore().deleteBook(Number(bookId))) throw new Error('内置词库不能删除');
  return { ok: true };
}

export function createBook(name, entries) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('请填写词库名称');
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('没有可导入的单词');
  return requireStore().importEntries(null, trimmed, entries);
}

export function importInto(bookId, entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('没有可导入的单词');
  return requireStore().importEntries(Number(bookId), null, entries);
}

/** 解析 Markdown / 文本文件（自动识别编码）。 */
export function parseText(bytes) {
  if (!bytes || bytes.length === 0) throw new Error('文件是空的');
  if (bytes.length > 4 * 1024 * 1024) throw new Error('文件超过 4 MB，请拆分后再导入');
  let text;
  try {
    text = decodeText(bytes);
  } catch {
    throw new Error('无法识别文件编码');
  }
  const entries = parseMarkdown(text);
  return { entries, total: entries.length };
}

export function backupText() {
  return exportBackup(requireStore().serialize());
}

/** 恢复备份（会用文件内容整体替换当前数据）。 */
export function restoreText(text) {
  const db = parseBackup(text);
  requireStore().replaceDb(db);
  return { books: requireStore().books().length, words: db.words.length };
}

export function flush() {
  if (storage) storage.flush();
}

/** 自动备份开关 */
export function getAutoBackupEnabled() {
  return autoBackupEnabled();
}
export function setAutoBackupEnabled(enabled) {
  const next = enabled ? 'on' : 'off';
  try { localStorage.setItem('worddrill.autobackup', next); } catch { /* 忽略 */ }
  startAutoBackup();
  return next === 'on';
}

/** 自动备份间隔（小时） */
export function getBackupIntervalHours() {
  return backupIntervalHours();
}
export function setBackupIntervalHours(hours) {
  try { localStorage.setItem('worddrill.backupInterval', String(hours)); } catch { /* 忽略 */ }
  startAutoBackup();
  return backupIntervalHours();
}

/** 最多保留多少份自动备份快照 */
export function getBackupKeepCount() {
  return backupKeepCount();
}
export function setBackupKeepCount(count) {
  try { localStorage.setItem('worddrill.backupKeep', String(count)); } catch { /* 忽略 */ }
  return backupKeepCount();
}

/** 立即保存一份自动备份快照，返回保留的份数（旧的会按上限删掉）。 */
export function saveAutoBackupNow() {
  if (!store) return 0;
  return storage.saveAutoBackup(store.db, backupKeepCount());
}

/** 列出自动备份快照，新在前。 */
export function listAutoBackups() {
  if (!storage) return [];
  return storage.listAutoBackups();
}

/** 清除全部自动备份快照，返回删掉的份数。 */
export function clearAutoBackups() {
  if (!storage) return 0;
  return storage.clearAutoBackups();
}

/** 清除 Service Worker 离线缓存，返回删掉的缓存数。不删学习数据。 */
export async function clearOfflineCache() {
  return clearCache();
}











