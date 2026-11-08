/**
 * 纯状态层：只操作内存里的数据结构，不碰文件、网络、浏览器 API。
 * Node 的单元测试和浏览器里的应用共用这一份代码。
 *
 * 数据结构对应 Android 版的 SQLite 表 books / words / mistakes / practice_log。
 * 索引规则也一致：words.ord 是入库顺序（稳定），对外返回的 index 是
 * 「当前可见索引」——屏蔽词不占号，其余单词从 1 连续编号。
 */

import { nextLevel, nextDueAt, dayKey, recentDayKeys, streak } from './review.js';

export function emptyDb() {
  return {
    version: 2,
    seedVersion: 0,
    nextBookId: 1,
    nextWordId: 1,
    books: [],
    words: [],
    mistakes: [],
    practiceLog: [],
    review: [],
    daily: [],
  };
}

function maxId(list) {
  return list.reduce((max, item) => Math.max(max, item.id || 0), 0);
}

/** 兼容旧备份 / 手工改过的数据：补全缺失字段与自增 id。 */
export function normalizeDb(raw) {
  const db = { ...emptyDb(), ...(raw || {}) };
  db.books = Array.isArray(db.books) ? db.books : [];
  db.words = Array.isArray(db.words) ? db.words : [];
  db.mistakes = Array.isArray(db.mistakes) ? db.mistakes : [];
  db.practiceLog = Array.isArray(db.practiceLog) ? db.practiceLog : [];
  db.review = Array.isArray(db.review) ? db.review : [];
  db.daily = Array.isArray(db.daily) ? db.daily : [];
  if (!Number.isFinite(raw && raw.nextBookId)) db.nextBookId = maxId(db.books) + 1;
  if (!Number.isFinite(raw && raw.nextWordId)) db.nextWordId = maxId(db.words) + 1;
  if (!Number.isFinite(raw && raw.seedVersion)) db.seedVersion = 0;
  return db;
}

export class Store {
  /**
   * @param {{db?: object, onChange?: (part: string) => void}} options
   *   onChange 在数据被修改后调用，参数是变化的部分：
   *   'books' | 'words' | 'mistakes' | 'log' | 'all'
   */
  constructor({ db, onChange } = {}) {
    this.db = db ? normalizeDb(db) : emptyDb();
    this.onChange = onChange || null;
  }

  change(part) {
    if (this.onChange) this.onChange(part);
  }

  // ---------- 初始化 ----------

  /**
   * 播种一本内置词库。只在「还没有同款内置词库」时新建，改动只影响词库本身，
   * 不碰用户已有的练习记录、错题、星标。
   * @param {Array<{w:string,pos?:string,m:string}>} entries
   * @param {{name?:string, seedId?:string}} options seedId 用来判断这本词库是否已存在
   */
  seedBuiltin(entries, { name = '高中 3500 词', seedId = '' } = {}) {
    const now = Date.now();
    const book = {
      id: this.db.nextBookId++,
      name,
      builtin: true,
      seedId: seedId || name,
      createdAt: now,
    };
    this.db.books.push(book);
    entries.forEach((entry, i) => {
      this.db.words.push({
        id: this.db.nextWordId++,
        bookId: book.id,
        ord: i + 1,
        word: entry.w,
        pos: entry.pos || '',
        meaning: entry.m,
        starred: false,
        blocked: false,
        createdAt: now,
      });
    });
    this.change('all');
    return book;
  }

  /**
   * 下架内置词库：按 seedId 删掉这些内置词库及其单词、练习记录、错题、复习排期。
   * 只动 builtin 词库，用户自己导入的（没有 seedId）一律不碰。
   * @param {string[]} seedIds
   * @returns {string[]} 实际删掉的词库名
   */
  removeBuiltins(seedIds) {
    const targets = new Set(Array.isArray(seedIds) ? seedIds : []);
    if (!targets.size) return [];
    const removedBooks = this.db.books.filter((b) => b.builtin && targets.has(b.seedId));
    if (!removedBooks.length) return [];
    const bookIds = new Set(removedBooks.map((b) => b.id));
    const wordIds = new Set(
      this.db.words.filter((w) => bookIds.has(w.bookId)).map((w) => w.id),
    );
    this.db.books = this.db.books.filter((b) => !bookIds.has(b.id));
    this.db.words = this.db.words.filter((w) => !wordIds.has(w.id));
    this.db.mistakes = this.db.mistakes.filter((m) => !wordIds.has(m.wordId));
    this.db.practiceLog = this.db.practiceLog.filter((p) => !wordIds.has(p.wordId));
    this.db.review = this.db.review.filter((r) => !wordIds.has(r.wordId));
    this.change('all');
    return removedBooks.map((b) => b.name);
  }

  /**
   * 同步内置词库：补种清单里缺失的，删掉已下架的，顺带合并早期版本留下的重名词库。
   * 已有且仍在清单里的词库完全不动，所以不会重建用户删掉的内容、也不会重复写入。
   * @param {Array<{seedId:string,name:string,entries:Array}>} builtins 当前清单
   * @param {number} version 清单版本，写进 db.seedVersion
   * @param {string[]} retired 已下架的 seedId
   * @returns {{added:string[], removed:string[], merged:string[], version:number}}
   */
  syncBuiltins(builtins, version, retired = []) {
    const removed = this.removeBuiltins(retired);
    const before = new Set(this.db.books.map((b) => b.id));
    const { added } = this.applyBuiltins(builtins, version);
    // applyBuiltins 可能顺手合并掉重复词库，把它们也算进 removed
    const alive = new Set(this.db.books.map((b) => b.id));
    const merged = [...before].filter((id) => !alive.has(id)).length;
    return { added, removed, merged, version: this.db.seedVersion };
  }

  /**
   * 已有某本内置词库？
   * 优先按 seedId 判断；同时对「早期版本种下、没有 seedId 的内置词库」按名字兜底，
   * 否则老数据会被当成"没有"，于是重复种出一模一样的一本（曾出现过两个「高中 3500 词」）。
   * 用户自建的词库 builtin 为 false，不会被算进来。
   */
  hasSeed(seedId, name = '') {
    return this.db.books.some((b) => {
      if (!b.builtin) return false;
      if (b.seedId) return b.seedId === seedId;
      return Boolean(name) && b.name === name;
    });
  }

  /**
   * 按内置词库清单补种：只补当前缺失的词库，已存在的跳过。
   * 用来让老用户在不丢数据的前提下拿到新增的内置词库。
   * @param {Array<{seedId:string,name:string,entries:Array}>} builtins
   * @param {number} version 清单版本，写进 db.seedVersion
   * @returns {{added:string[], version:number}}
   */
  applyBuiltins(builtins, version) {
    const added = [];
    for (const item of builtins) {
      if (!item || !item.seedId || !Array.isArray(item.entries) || !item.entries.length) continue;
      if (this.hasSeed(item.seedId, item.name)) {
        // 已有（可能是早期没有 seedId 的内置词库）：补上 seedId，以后就按 id 认了
        this.adoptSeed(item.seedId, item.name);
        continue;
      }
      this.seedBuiltin(item.entries, { name: item.name, seedId: item.seedId });
      added.push(item.name);
    }
    if (version !== this.db.seedVersion) {
      this.db.seedVersion = version;
      this.change('meta');
    }
    return { added, version: this.db.seedVersion };
  }

  /**
   * 给早期版本种下、没有 seedId 的内置词库补上 seedId。
   * 同名的多本（曾经因为认不出而重复种出）只认最早的一本，其余视为重复删掉，
   * 删的时候只清它自己的单词与记录，最早那本的进度不受影响。
   * @returns {string[]} 被合并掉的重复词库名
   */
  adoptSeed(seedId, name) {
    const matches = this.db.books
      .filter((b) => b.builtin && (b.seedId === seedId || (!b.seedId && b.name === name)))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id - b.id);
    if (!matches.length) return [];
    const [keep, ...dupes] = matches;
    if (!keep.seedId) {
      keep.seedId = seedId;
      this.change('books');
    }
    const removed = [];
    for (const dupe of dupes) {
      const ids = new Set(this.db.words.filter((w) => w.bookId === dupe.id).map((w) => w.id));
      this.db.books = this.db.books.filter((b) => b.id !== dupe.id);
      this.db.words = this.db.words.filter((w) => !ids.has(w.id));
      this.db.mistakes = this.db.mistakes.filter((m) => !ids.has(m.wordId));
      this.db.practiceLog = this.db.practiceLog.filter((p) => !ids.has(p.wordId));
      this.db.review = this.db.review.filter((r) => !ids.has(r.wordId));
      removed.push(dupe.name);
    }
    if (removed.length) this.change('all');
    return removed;
  }

  /**
   * 收拾重名的内置词库（早期版本重复播种留下的，例如两个「高中 3500 词」）。
   * 每本内置词库只保留最早的一份，其余连同它的单词与记录一起删掉。
   * 不依赖清单版本，所以已经在最新版本上的用户也能被修好。
   * @returns {{merged:number}}
   */
  dedupeBuiltins() {
    // 两本内置词库算重复的条件：seedId 相同，或名字相同（早期版本没有 seedId）
    const isSame = (a, b) => (a.seedId && b.seedId ? a.seedId === b.seedId : a.name === b.name);
    const keptList = [];
    const drop = new Set();
    for (const book of [...this.db.books].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id - b.id)) {
      if (!book.builtin) continue;
      const kept = keptList.find((k) => isSame(k, book));
      if (!kept) { keptList.push(book); continue; }
      // 先出现的留下；后来的同名书若带了 seedId 而 kept 没有，就把 seedId 补给 kept
      if (!kept.seedId && book.seedId) {
        kept.seedId = book.seedId;
        this.change('books');
      }
      drop.add(book.id);
    }
    if (!drop.size) return { merged: 0 };
    const ids = new Set(this.db.words.filter((w) => drop.has(w.bookId)).map((w) => w.id));
    this.db.books = this.db.books.filter((b) => !drop.has(b.id));
    this.db.words = this.db.words.filter((w) => !ids.has(w.id));
    this.db.mistakes = this.db.mistakes.filter((m) => !ids.has(m.wordId));
    this.db.practiceLog = this.db.practiceLog.filter((p) => !ids.has(p.wordId));
    this.db.review = this.db.review.filter((r) => !ids.has(r.wordId));
    this.change('all');
    return { merged: drop.size };
  }

  /** 整体替换（恢复备份用）。旧备份里练过但没排期的词会一起补齐。 */
  replaceDb(raw) {
    this.db = normalizeDb(raw);
    this.ensureReviewRecords();
    this.change('all');
    return this;
  }

  serialize() {
    return this.db;
  }

  // ---------- 词库 ----------

  visibleWords(bookId) {
    return this.db.words
      .filter((w) => w.bookId === bookId && !w.blocked)
      .sort((a, b) => a.ord - b.ord);
  }

  indexMap(bookId) {
    const map = new Map();
    this.visibleWords(bookId).forEach((w, i) => map.set(w.id, i + 1));
    return map;
  }

  books() {
    return this.db.books
      .map((book) => {
        const visible = this.visibleWords(book.id).length;
        const blocked = this.db.words.filter((w) => w.bookId === book.id && w.blocked).length;
        return { id: book.id, name: book.name, builtin: Boolean(book.builtin), wordCount: visible, blockedCount: blocked };
      })
      .sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.id - b.id);
  }

  book(bookId) {
    const book = this.db.books.find((b) => b.id === bookId);
    if (!book) return null;
    const visible = this.visibleWords(bookId).length;
    const blocked = this.blockedCount(bookId);
    return { id: book.id, name: book.name, builtin: Boolean(book.builtin), wordCount: visible, blockedCount: blocked };
  }

  addBook(name) {
    const book = { id: this.db.nextBookId++, name: String(name).trim(), builtin: false, createdAt: Date.now() };
    this.db.books.push(book);
    this.change('books');
    return book;
  }

  deleteBook(bookId) {
    const book = this.db.books.find((b) => b.id === bookId);
    if (!book || book.builtin) return false;
    const ids = new Set(this.db.words.filter((w) => w.bookId === bookId).map((w) => w.id));
    this.db.books = this.db.books.filter((b) => b.id !== bookId);
    this.db.words = this.db.words.filter((w) => w.bookId !== bookId);
    this.db.mistakes = this.db.mistakes.filter((m) => !ids.has(m.wordId));
    this.db.practiceLog = this.db.practiceLog.filter((p) => !ids.has(p.wordId));
    this.db.review = this.db.review.filter((r) => !ids.has(r.wordId));
    this.change('all');
    return true;
  }

  blockedCount(bookId) {
    return this.db.words.filter((w) => w.bookId === bookId && w.blocked).length;
  }

  stats(bookId) {
    const visible = this.visibleWords(bookId);
    const practiced = new Set(this.db.practiceLog.map((p) => p.wordId));
    return {
      wordCount: visible.length,
      blockedCount: this.blockedCount(bookId),
      practiced: visible.filter((w) => practiced.has(w.id)).length,
      range: visible.length ? { start: 1, end: visible.length } : null,
    };
  }

  // ---------- 单词 ----------

  withIndex(word, index) {
    return {
      id: word.id,
      bookId: word.bookId,
      ord: word.ord,
      index,
      word: word.word,
      pos: word.pos,
      meaning: word.meaning,
      starred: Boolean(word.starred),
      blocked: Boolean(word.blocked),
    };
  }

  words(bookId, filter = 'all', query = '') {
    const q = String(query || '').trim().toLowerCase();
    if (filter === 'blocked') {
      return this.db.words
        .filter((w) => w.bookId === bookId && w.blocked)
        .sort((a, b) => a.ord - b.ord)
        .map((w) => this.withIndex(w, null));
    }
    const index = this.indexMap(bookId);
    let list = this.visibleWords(bookId);
    if (filter === 'starred') list = list.filter((w) => w.starred);
    if (q) {
      list = list.filter(
        (w) => w.word.toLowerCase().includes(q) || String(w.meaning).toLowerCase().includes(q),
      );
    }
    return list.map((w) => this.withIndex(w, index.get(w.id)));
  }

  mistakes(bookId = null) {
    const indexCache = new Map();
    const byId = new Map(this.db.words.map((w) => [w.id, w]));
    return this.db.mistakes
      .map((m) => {
        const word = byId.get(m.wordId);
        if (!word || word.blocked) return null;
        if (bookId != null && word.bookId !== bookId) return null;
        if (!indexCache.has(word.bookId)) indexCache.set(word.bookId, this.indexMap(word.bookId));
        return { word: this.withIndex(word, indexCache.get(word.bookId).get(word.id)), wrong: m.wrong, lastAt: m.lastAt };
      })
      .filter(Boolean)
      .sort((a, b) => b.lastAt - a.lastAt);
  }

  allWords() {
    return this.db.words.filter((w) => !w.blocked);
  }

  wordsByIds(ids) {
    const out = [];
    const byId = new Map(this.db.words.map((w) => [w.id, w]));
    const indexCache = new Map();
    for (const id of ids) {
      const word = byId.get(id);
      if (!word || word.blocked) continue;
      if (!indexCache.has(word.bookId)) indexCache.set(word.bookId, this.indexMap(word.bookId));
      out.push(this.withIndex(word, indexCache.get(word.bookId).get(word.id)));
    }
    return out;
  }

  setStar(wordId, starred) {
    const word = this.db.words.find((w) => w.id === wordId);
    if (!word) return false;
    word.starred = Boolean(starred);
    this.change('words');
    return true;
  }

  setBlocked(wordId, blocked) {
    const word = this.db.words.find((w) => w.id === wordId);
    if (!word) return false;
    word.blocked = Boolean(blocked);
    this.change('words');
    return true;
  }

  unblockAll(bookId) {
    let changed = 0;
    for (const word of this.db.words) {
      if (word.bookId === bookId && word.blocked) {
        word.blocked = false;
        changed += 1;
      }
    }
    if (changed) this.change('words');
    return changed;
  }

  // ---------- 抽题 ----------

  pickWords(bookId, { start = 1, end = Number.MAX_SAFE_INTEGER, count = 20, allowRepeat = true, filter = 'all' } = {}) {
    const index = this.indexMap(bookId);
    let list = this.visibleWords(bookId);
    if (filter === 'starred' || filter === 'mistakes') {
      const allowed = filter === 'mistakes'
        ? new Set(this.db.mistakes.map((m) => m.wordId))
        : null;
      list = list.filter((w) => (filter === 'starred' ? w.starred : allowed.has(w.id)));
    }
    let candidates = list
      .map((w) => this.withIndex(w, index.get(w.id)))
      .filter((w) => w.index >= start && w.index <= end);

    if (filter === 'all' && !allowRepeat) {
      const practiced = new Set(this.db.practiceLog.map((p) => p.wordId));
      candidates = candidates.filter((w) => !practiced.has(w.id));
    }
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates.slice(0, Math.max(0, count));
  }

  // ---------- 答题记录 ----------

  recordAnswer(wordId, mode, correct) {
    const now = Date.now();
    const mistake = this.db.mistakes.find((m) => m.wordId === wordId);
    if (correct) {
      this.db.mistakes = this.db.mistakes.filter((m) => m.wordId !== wordId);
    } else if (mistake) {
      mistake.wrong += 1;
      mistake.mode = mode;
      mistake.lastAt = now;
    } else {
      this.db.mistakes.push({ wordId, mode, wrong: 1, lastAt: now });
    }
    const log = this.db.practiceLog.find((p) => p.wordId === wordId);
    if (log) {
      log.times += 1;
      log.lastAt = now;
    } else {
      this.db.practiceLog.push({ wordId, times: 1, lastAt: now });
    }

    // 间隔重复：答对升级、答错归零，据此算下次复习时间
    const record = this.db.review.find((r) => r.wordId === wordId);
    const currentLevel = record ? record.level : 0;
    const lapses = (record ? record.lapses : 0) + (correct ? 0 : 1);
    const level = nextLevel(currentLevel, correct);
    const dueAt = nextDueAt(currentLevel, correct, now);
    if (record) {
      record.level = level;
      record.dueAt = dueAt;
      record.lastAt = now;
      record.lapses = lapses;
    } else {
      this.db.review.push({ wordId, level, dueAt, lastAt: now, lapses });
    }

    // 打卡：按本地日期累加当天答题数与正确数
    const key = dayKey(new Date(now));
    const day = this.db.daily.find((d) => d.date === key);
    if (day) {
      day.answered += 1;
      day.correct += correct ? 1 : 0;
    } else {
      this.db.daily.push({ date: key, answered: 1, correct: correct ? 1 : 0 });
    }

    this.change('mistakes');
    this.change('log');
    this.change('review');
    this.change('daily');
  }

  // ---------- 复习 / 统计 ----------

  /**
   * 练过（见过面）的单词：有练习记录、或已有复习排期的都算。
   * 只认练习记录，不看对错——答对过一次也算练过。
   */
  studiedIds() {
    const ids = new Set();
    for (const p of this.db.practiceLog) ids.add(p.wordId);
    for (const r of this.db.review) ids.add(r.wordId);
    return ids;
  }

  /**
   * 老数据里可能有「练过但没有复习排期」的词，这里补齐 level 0 / dueAt 0 的记录，
   * 从此所有练过的词都进复习。返回新补的条数。
   */
  ensureReviewRecords() {
    const known = new Set(this.db.review.map((r) => r.wordId));
    const lastAt = new Map(this.db.practiceLog.map((p) => [p.wordId, p.lastAt || 0]));
    let created = 0;
    for (const wordId of this.studiedIds()) {
      if (known.has(wordId)) continue;
      this.db.review.push({ wordId, level: 0, dueAt: 0, lastAt: lastAt.get(wordId) || 0, lapses: 0 });
      known.add(wordId);
      created += 1;
    }
    if (created) this.change('review');
    return created;
  }

  /**
   * 所有练过的、没被屏蔽的单词都排进复习列表（不只是错题）。
   * 只读：没有复习排期的词按 level 0 / dueAt 0 现场补上，不写库。
   * @param {'due'|'all'} scope due 只取今天该复习的，all 取全部练过的词
   */
  reviewWords(limit = 200, scope = 'due', now = Date.now()) {
    const byId = new Map(this.db.words.map((w) => [w.id, w]));
    const records = new Map(this.db.review.map((r) => [r.wordId, r]));
    const indexCache = new Map();
    const list = [];
    for (const wordId of this.studiedIds()) {
      const word = byId.get(wordId);
      if (!word || word.blocked) continue;
      const record = records.get(wordId);
      const level = record ? (record.level || 0) : 0;
      const dueAt = record ? (record.dueAt || 0) : 0;
      if (scope === 'due' && dueAt > now) continue;
      list.push({ word, level, dueAt });
    }
    list.sort((a, b) => a.dueAt - b.dueAt || a.level - b.level);
    return list.slice(0, Math.max(0, limit)).map(({ word, level, dueAt }) => {
      if (!indexCache.has(word.bookId)) indexCache.set(word.bookId, this.indexMap(word.bookId));
      return {
        ...this.withIndex(word, indexCache.get(word.bookId).get(word.id)),
        level,
        dueAt,
        overdue: dueAt <= now,
      };
    });
  }

  /** 今天该复习的词数（含刚练完还没排上的）。 */
  reviewWordCount(scope = 'due', now = Date.now()) {
    return this.reviewWords(Number.MAX_SAFE_INTEGER, scope, now).length;
  }

  /** 复习统计：待复习量、练过的总量、今天已经复习过多少。 */
  reviewStats(now = Date.now()) {
    const due = this.reviewWords(Number.MAX_SAFE_INTEGER, 'due', now);
    const all = this.reviewWords(Number.MAX_SAFE_INTEGER, 'all', now);
    const today = dayKey(new Date(now));
    const answered = new Set(
      this.db.practiceLog
        .filter((p) => dayKey(new Date(p.lastAt || 0)) === today)
        .map((p) => p.wordId),
    );
    return {
      due: due.length,
      total: all.length,
      overdue: due.filter((item) => item.level > 0).length,
      fresh: due.filter((item) => item.level === 0).length,
      answeredToday: all.filter((item) => answered.has(item.id)).length,
    };
  }

  /** 掌握度：按复习等级把词分成「新词 / 学习中 / 已掌握」三档。 */
  masteryStats(bookId = null) {
    const words = this.db.words.filter(
      (w) => !w.blocked && (bookId == null || w.bookId === bookId),
    );
    const levels = new Map(this.db.review.map((r) => [r.wordId, r.level || 0]));
    let fresh = 0;
    let learning = 0;
    let mastered = 0;
    for (const word of words) {
      const level = levels.get(word.id) || 0;
      if (level >= 5) mastered += 1;
      else if (level >= 1) learning += 1;
      else fresh += 1;
    }
    const total = words.length;
    return {
      total,
      fresh,
      learning,
      mastered,
      masteredPercent: total ? Math.round((mastered * 100) / total) : 0,
    };
  }

  /** 错得最多的词，用于报告页的「最该复习的词」。 */
  topWrongWords(bookId = null, limit = 8) {
    return this.mistakes(bookId)
      .sort((a, b) => b.wrong - a.wrong || b.lastAt - a.lastAt)
      .slice(0, Math.max(0, limit));
  }

  /** 近 days 天每天的答题量与正确数。 */
  dailyStats(days, now = Date.now()) {
    const keys = recentDayKeys(days, now);
    const map = new Map(this.db.daily.map((d) => [d.date, d]));
    return keys.map((key) => {
      const value = map.get(key);
      return { date: key, answered: value ? value.answered : 0, correct: value ? value.correct : 0 };
    });
  }

  /** 学习报告需要的汇总。 */
  studySummary(days = 7, goal = 30, now = Date.now()) {
    const stats = this.dailyStats(days, now);
    const studied = new Set(this.db.daily.filter((d) => d.answered > 0).map((d) => d.date));
    const totalAnswered = this.db.daily.reduce((sum, d) => sum + (d.answered || 0), 0);
    const totalCorrect = this.db.daily.reduce((sum, d) => sum + (d.correct || 0), 0);
    return {
      todayAnswered: stats.length ? stats[stats.length - 1].answered : 0,
      dailyGoal: goal,
      streak: streak(dayKey(new Date(now)), studied),
      totalAnswered,
      totalCorrect,
      dueReview: this.reviewWordCount('due', now),
      reviewTotal: this.reviewWordCount('all', now),
      days: stats,
    };
  }

  clearMistakes(bookId = null) {
    if (bookId == null) {
      this.db.mistakes = [];
    } else {
      const ids = new Set(this.db.words.filter((w) => w.bookId === bookId).map((w) => w.id));
      this.db.mistakes = this.db.mistakes.filter((m) => !ids.has(m.wordId));
    }
    this.change('mistakes');
  }

  clearPracticeLog() {
    this.db.practiceLog = [];
    this.change('log');
  }

  // ---------- 导入 ----------

  importEntries(bookId, newBookName, entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { bookId: bookId || -1, added: 0, skipped: 0 };
    }
    let targetId = bookId;
    if (!targetId) {
      const book = this.addBook(newBookName || '自组词汇库');
      targetId = book.id;
    }
    const existing = new Set(
      this.db.words.filter((w) => w.bookId === targetId).map((w) => w.word.toLowerCase()),
    );
    let ord = this.db.words
      .filter((w) => w.bookId === targetId)
      .reduce((max, w) => Math.max(max, w.ord), 0);
    const now = Date.now();
    let added = 0;
    let skipped = 0;
    for (const entry of entries) {
      const word = String(entry.word || '').trim();
      const meaning = String(entry.meaning || '').trim();
      if (!word || !meaning) {
        skipped += 1;
        continue;
      }
      const key = word.toLowerCase();
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      existing.add(key);
      ord += 1;
      this.db.words.push({
        id: this.db.nextWordId++,
        bookId: targetId,
        ord,
        word,
        pos: String(entry.pos || '').trim(),
        meaning,
        starred: false,
        blocked: false,
        createdAt: now,
      });
      added += 1;
    }
    this.change(added ? 'all' : 'books');
    return { bookId: targetId, added, skipped };
  }
}
