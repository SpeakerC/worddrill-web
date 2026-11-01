/**
 * 应用数据层：把 UI 需要的东西整理成一组异步函数。
 * 浏览器里直接读写本地存储，没有服务器、没有网络请求。
 */
import { Store } from './store.js';
import { buildItems, MODES, isCorrect } from './quiz.js';
import { parseMarkdown, decodeText } from './vocab.js';
import { parseAbout } from './about.js';
import { createStorage, getLocalStorage, memoryStorage, exportBackup, parseBackup } from './persist.js';

export const VERSION = '1.0.0';
export { MODES, isCorrect };

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
    const entries = await loadSeed();
    const fresh = new Store();
    fresh.seedBuiltin(entries.map((e) => ({ w: e.w, pos: e.pos, m: e.m })));
    db = fresh.db;
    seeded = true;
  }
  store = new Store({ db, onChange: (part) => storage.save(part) });
  storage.bind(store.db);
  if (seeded) storage.save('all');
  about = await loadAbout();
  return bootstrap();
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

export function listMistakes(bookId) {
  const items = requireStore().mistakes(bookId);
  return {
    words: items.map((item) => item.word),
    counts: Object.fromEntries(items.map((item) => [item.word.id, item.wrong])),
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
  return { items: buildItems(words, s.allWords(), requested, mode), requested, mode, bookName: book.name };
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
  requireStore().clearPracticeLog();
  return { ok: true };
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
