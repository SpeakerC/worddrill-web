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
import { BACKUP_KEEP_DEFAULT } from './settings.js';

const PREFIX = 'worddrill.db.';
const WRITE_DELAY = 120;

/** localStorage 在某些隐私模式下访问就会抛错，这里统一兜住。 */
export function getLocalStorage() {
  let storage = null;
  try {
    storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = '__worddrill_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch (err) {
    // 配额满时 setItem 也会抛 quota；但 localStorage 仍能读、能删，
    // 不能因此退回内存存储，否则用户会以为数据全丢了。
    if (storage && /quota/i.test(`${err && err.name} ${err && err.message}`)) return storage;
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
  const onOk = options.onOk || (() => {});
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
      seedVersion: meta.seedVersion,
      wordlistVersion: meta.wordlistVersion,
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
        seedVersion: db.seedVersion || 0,
        wordlistVersion: db.wordlistVersion || 0,
        nextBookId: db.nextBookId,
        nextWordId: db.nextWordId,
      }));
    }
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!db || dirty.size === 0) return;
    const parts = [...dirty];
    try {
      parts.forEach((part) => {
        writePart(part);
        dirty.delete(part);
      });
      onOk();
    } catch (err) {
      // 失败的 part 留在 dirty 里，下次保存再试；成功的不重复写
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

  const AB_PREFIX = 'worddrill.ab.';
  const AB_INDEX = 'worddrill.ab.index';
  const AB_IDB_NAME = 'worddrill-backups';
  const AB_IDB_STORE = 'snapshots';

  let idbPromise = null;
  let idbBroken = false;
  let migratedLegacy = false;

  /**
   * 快照不放 localStorage：整份数据约 1.3M 字符，三份就会把 5MB 配额吃光，
   * 之后「重新部署词库」写主数据时就会 quota exceeded。改用 IndexedDB，
   * 配额大得多，也不和主数据抢空间。
   */
  function openIdb() {
    if (idbBroken || typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB 不可用'));
    }
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(AB_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(AB_IDB_STORE)) {
          db.createObjectStore(AB_IDB_STORE, { keyPath: 'at' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
      req.onblocked = () => reject(new Error('IndexedDB 被其他页面占用'));
    }).catch((err) => {
      idbBroken = true;
      idbPromise = null;
      throw err;
    });
    return idbPromise;
  }

  function idbResult(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 操作失败'));
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB 写入失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 写入被中止'));
    });
  }

  async function idbKeys() {
    const db = await openIdb();
    const tx = db.transaction(AB_IDB_STORE, 'readonly');
    return idbResult(tx.objectStore(AB_IDB_STORE).getAllKeys());
  }

  async function idbSave(db, keep) {
    const conn = await openIdb();
    const keys = await idbKeys();
    let at = Date.now();
    while (keys.includes(at)) at += 1;
    const tx = conn.transaction(AB_IDB_STORE, 'readwrite');
    const os = tx.objectStore(AB_IDB_STORE);
    // 先删超出的旧快照，再写新的一份，避免写入瞬间超出配额
    const stale = keys.sort((a, b) => b - a).slice(Math.max(0, keep - 1));
    for (const key of stale) os.delete(key);
    os.put({ at, db });
    await txDone(tx);
    return Math.min(keys.length + 1, keep);
  }

  async function idbList() {
    const keys = await idbKeys();
    return keys.sort((a, b) => b - a).map((at) => ({ key: String(at), at }));
  }

  async function idbClear() {
    const conn = await openIdb();
    const tx = conn.transaction(AB_IDB_STORE, 'readwrite');
    tx.objectStore(AB_IDB_STORE).clear();
    await txDone(tx);
    return 0;
  }

  function localAbKeys() {
    const keys = [];
    try {
      if (typeof storage.length === 'number' && typeof storage.key === 'function') {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key && key.startsWith(AB_PREFIX) && key !== AB_INDEX) keys.push(key);
        }
      }
    } catch { /* 忽略 */ }
    return keys;
  }

  /** localStorage 兜底：先删旧快照再写，返回保留份数；失败返回 -1。 */
  function saveLocalBackup(db, keep) {
    const keys = localAbKeys();
    const stale = keys
      .sort((a, b) => Number(b.slice(AB_PREFIX.length)) - Number(a.slice(AB_PREFIX.length)))
      .slice(Math.max(0, keep - 1));
    for (const key of stale) {
      try { storage.removeItem(key); } catch { /* 忽略 */ }
    }
    let at = Date.now();
    while (keys.includes(`${AB_PREFIX}${at}`)) at += 1;
    try {
      storage.setItem(`${AB_PREFIX}${at}`, JSON.stringify({
        app: 'worddrill-web',
        schema: 2,
        exportedAt: new Date().toISOString(),
        db,
      }));
      try { storage.removeItem(AB_INDEX); } catch { /* 忽略 */ }
      return Math.min(keys.length - stale.length + 1, keep);
    } catch {
      return -1;
    }
  }

  function listLocalBackups() {
    return localAbKeys()
      .map((key) => ({ key, at: Number(key.slice(AB_PREFIX.length)) }))
      .filter((item) => Number.isFinite(item.at))
      .sort((a, b) => b.at - a.at);
  }

  /**
   * 把旧版存在 localStorage 里的快照搬到 IndexedDB，然后删掉旧键。
   * 这一步要在加载/迁移主数据之前跑，否则旧快照仍占着 5MB 配额。
   */
  async function prepareSnapshots() {
    if (migratedLegacy) return 0;
    migratedLegacy = true;
    const keys = localAbKeys();
    if (!keys.length) return 0;
    try {
      await openIdb();
      for (const key of keys) {
        const raw = storage.getItem(key);
        if (!raw) continue;
        let payload;
        try { payload = JSON.parse(raw); } catch { continue; }
        if (!payload || !payload.db) continue;
        const at = Number(key.slice(AB_PREFIX.length)) || Date.now();
        const conn = await openIdb();
        const tx = conn.transaction(AB_IDB_STORE, 'readwrite');
        tx.objectStore(AB_IDB_STORE).put({ at, db: payload.db });
        await txDone(tx);
        try { storage.removeItem(key); } catch { /* 忽略 */ }
      }
      try { storage.removeItem(AB_INDEX); } catch { /* 忽略 */ }
      return keys.length;
    } catch {
      // IndexedDB 不可用：保留旧快照，后续走 localStorage 兜底
      return 0;
    }
  }

  /** 把当前 db 另存为一份自动备份快照，并按 keep 保留最新若干份。 */
  async function saveAutoBackup(db, keep = BACKUP_KEEP_DEFAULT) {
    if (!db) return 0;
    const target = Math.max(1, Math.trunc(Number(keep) || BACKUP_KEEP_DEFAULT));
    if (!idbBroken) {
      try {
        return await idbSave(db, target);
      } catch {
        idbBroken = true;
      }
    }
    // 没有 IndexedDB 时 localStorage 放不下多份整库快照，只保一份，
    // 避免把主数据也顶到 quota exceeded。
    return saveLocalBackup(db, 1);
  }

  /** 列出现有自动备份快照，新在前。 */
  async function listAutoBackups() {
    if (!idbBroken) {
      try {
        return await idbList();
      } catch {
        idbBroken = true;
      }
    }
    return listLocalBackups();
  }

  /** 取最近一份快照的完整数据，供「恢复最近快照」用。 */
  async function latestAutoBackup() {
    if (!idbBroken) {
      try {
        const keys = await idbKeys();
        if (!keys.length) return null;
        const at = Math.max(...keys);
        const conn = await openIdb();
        const tx = conn.transaction(AB_IDB_STORE, 'readonly');
        return await idbResult(tx.objectStore(AB_IDB_STORE).get(at));
      } catch {
        idbBroken = true;
      }
    }
    const list = listLocalBackups();
    if (!list.length) return null;
    try {
      const payload = JSON.parse(storage.getItem(list[0].key));
      return payload && payload.db ? { at: list[0].at, db: payload.db } : null;
    } catch {
      return null;
    }
  }

  /** 清除全部自动备份快照，返回删掉的份数。 */
  async function clearAutoBackups() {
    let removed = 0;
    if (!idbBroken) {
      try {
        const keys = await idbKeys();
        removed += keys.length;
        await idbClear();
      } catch {
        idbBroken = true;
      }
    }
    const local = localAbKeys();
    local.forEach((key) => { try { storage.removeItem(key); } catch { /* 忽略 */ } });
    removed += local.length;
    try { storage.removeItem(AB_INDEX); } catch { /* 忽略 */ }
    return removed;
  }

  const api = {
    load,
    bind,
    save,
    flush,
    clear,
    usageBytes,
    prepareSnapshots,
    saveAutoBackup,
    listAutoBackups,
    latestAutoBackup,
    clearAutoBackups,
  };
  return api;
}

/** 清除 Service Worker 离线缓存（html/css/js/词表/图标），不删学习数据。 */
export async function clearCache() {
  if (!('caches' in globalThis)) return 0;
  const names = await caches.keys();
  let removed = 0;
  for (const name of names) {
    if (await caches.delete(name)) removed += 1;
  }
  return removed;
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
