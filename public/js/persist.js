/**
 * 浏览器本地存储：localStorage 分键存放，避免每次答题都重写整份词表。
 *
 *   worddrill.db.books     词库
 *   worddrill.db.words     全部单词（最大的一份，只在增删改词时重写）
 *   worddrill.db.mistakes  错题
 *   worddrill.db.log       练习记录
 *   worddrill.db.review    复习排期（间隔重复）
 *   worddrill.db.daily     每天答题量（打卡与报告）
 *   worddrill.db.meta      自增 id / 结构版本
 *
 * 写入做了 120ms 防抖，页面隐藏或关闭前会立即落盘。
 */
import { normalizeDb } from './store.js';

const PREFIX = 'worddrill.db.';
const WRITE_DELAY = 120;

/** localStorage 在某些隐私模式下访问就会抛错，这里统一兜住。 */
export function getLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = '__worddrill_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** 拿不到 localStorage 时的内存兜底：本次打开期间一切照常，只是关掉就没了。 */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}


export function createStorage(options = {}) {
  const storage = options.storage || globalThis.localStorage;
  const onError = options.onError || (() => {});
  const dirty = new Set();
  let db = null;
  let timer = 0;

  function readJSON(key, fallback) {
    try {
      const raw = storage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function load() {
    const books = readJSON('books', null);
    if (!Array.isArray(books)) return null;
    const meta = readJSON('meta', {}) || {};
    return normalizeDb({
      version: meta.version || 1,
      nextBookId: meta.nextBookId,
      nextWordId: meta.nextWordId,
      books,
      words: readJSON('words', []),
      mistakes: readJSON('mistakes', []),
      practiceLog: readJSON('log', []),
      review: readJSON('review', []),
      daily: readJSON('daily', []),
    });
  }

  function writePart(part) {
    if (!db) return;
    if (part === 'books') storage.setItem(`${PREFIX}books`, JSON.stringify(db.books));
    else if (part === 'words') storage.setItem(`${PREFIX}words`, JSON.stringify(db.words));
    else if (part === 'mistakes') storage.setItem(`${PREFIX}mistakes`, JSON.stringify(db.mistakes));
    else if (part === 'log') storage.setItem(`${PREFIX}log`, JSON.stringify(db.practiceLog));
    else if (part === 'review') storage.setItem(`${PREFIX}review`, JSON.stringify(db.review));
    else if (part === 'daily') storage.setItem(`${PREFIX}daily`, JSON.stringify(db.daily));
    else if (part === 'meta') {
      storage.setItem(`${PREFIX}meta`, JSON.stringify({
        version: db.version || 1,
        nextBookId: db.nextBookId,
        nextWordId: db.nextWordId,
      }));
    }
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!db || dirty.size === 0) return;
    const parts = [...dirty];
    dirty.clear();
    try {
      parts.forEach(writePart);
    } catch (err) {
      onError(err);
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; flush(); }, WRITE_DELAY);
  }

  /** 绑定数据对象；之后 save() 才有效。 */
  function bind(nextDb) {
    db = nextDb;
    return api;
  }

  /** Store 的 onChange 直接传进来即可。 */
  function save(part = 'all') {
    if (!db) return;
    if (part === 'all') {
      dirty.add('meta'); dirty.add('books'); dirty.add('words');
      dirty.add('mistakes'); dirty.add('log'); dirty.add('review'); dirty.add('daily');
    } else {
      dirty.add(part);
      if (part === 'books' || part === 'words') dirty.add('meta');
    }
    schedule();
  }

  function clear() {
    dirty.clear();
    if (timer) { clearTimeout(timer); timer = 0; }
    ['books', 'words', 'mistakes', 'log', 'review', 'daily', 'meta'].forEach((key) => {
      try { storage.removeItem(PREFIX + key); } catch { /* 忽略 */ }
    });
  }

  function usageBytes() {
    let total = 0;
    for (const key of ['books', 'words', 'mistakes', 'log', 'review', 'daily', 'meta']) {
      try {
        const raw = storage.getItem(PREFIX + key);
        if (raw) total += raw.length * 2;
      } catch { /* 忽略 */ }
    }
    return total;
  }

  const api = { load, bind, save, flush, clear, usageBytes };
  return api;
}

/** 导出成备份文件内容（兼容旧版 data/db.json 的结构，方便互相恢复）。 */
export function exportBackup(db) {
  return JSON.stringify({
    app: 'worddrill-web',
    schema: 2,
    exportedAt: new Date().toISOString(),
    db,
  }, null, 1);
}

/** 读取备份文件；旧版 data/db.json 也能直接导入。 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  const db = data && data.db ? data.db : data;
  if (!db || !Array.isArray(db.books) || !Array.isArray(db.words)) {
    throw new Error('不是「单词练习」的备份文件');
  }
  return normalizeDb(db);
}
