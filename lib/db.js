'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 本地 JSON 存储，数据结构对应 Android 版的 SQLite 表：
 * books / words / mistakes / practice_log。
 *
 * 索引规则也一致：words.ord 是入库顺序（稳定），对外返回的 index 是
 * 「当前可见索引」——屏蔽词不占号，其余单词从 1 连续编号。
 */
class Store {
  constructor({ dataDir, seedFile }) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.seedFile = seedFile;
    this.db = null;
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!this.db.nextBookId) this.db.nextBookId = this.maxId(this.db.books) + 1;
      if (!this.db.nextWordId) this.db.nextWordId = this.maxId(this.db.words) + 1;
      return this;
    }
    this.db = {
      version: 1,
      nextBookId: 1,
      nextWordId: 1,
      books: [],
      words: [],
      mistakes: [],
      practiceLog: [],
    };
    this.seedBuiltin();
    this.save();
    return this;
  }

  maxId(list) {
    return list.reduce((max, item) => Math.max(max, item.id || 0), 0);
  }

  seedBuiltin() {
    const raw = JSON.parse(fs.readFileSync(this.seedFile, 'utf8'));
    const now = Date.now();
    const book = { id: this.db.nextBookId++, name: '高中 3500 词', builtin: true, createdAt: now };
    this.db.books.push(book);
    raw.forEach((entry, i) => {
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
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db), 'utf8');
    fs.renameSync(tmp, this.file);
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
    const blocked = this.db.words.filter((w) => w.bookId === bookId && w.blocked).length;
    return { id: book.id, name: book.name, builtin: Boolean(book.builtin), wordCount: visible, blockedCount: blocked };
  }

  addBook(name) {
    const book = { id: this.db.nextBookId++, name: String(name).trim(), builtin: false, createdAt: Date.now() };
    this.db.books.push(book);
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
    this.save();
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
    return this.db.mistakes
      .map((m) => {
        const word = this.db.words.find((w) => w.id === m.wordId);
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
    const wanted = new Set(ids);
    const out = [];
    const byId = new Map(this.db.words.map((w) => [w.id, w]));
    const indexCache = new Map();
    for (const id of ids) {
      const word = byId.get(id);
      if (!word || word.blocked) continue;
      if (!indexCache.has(word.bookId)) indexCache.set(word.bookId, this.indexMap(word.bookId));
      out.push(this.withIndex(word, indexCache.get(word.bookId).get(word.id)));
      wanted.delete(id);
    }
    return out;
  }

  setStar(wordId, starred) {
    const word = this.db.words.find((w) => w.id === wordId);
    if (!word) return false;
    word.starred = Boolean(starred);
    this.save();
    return true;
  }

  setBlocked(wordId, blocked) {
    const word = this.db.words.find((w) => w.id === wordId);
    if (!word) return false;
    word.blocked = Boolean(blocked);
    this.save();
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
    if (changed) this.save();
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
    this.save();
  }

  clearMistakes(bookId = null) {
    if (bookId == null) {
      this.db.mistakes = [];
    } else {
      const ids = new Set(this.db.words.filter((w) => w.bookId === bookId).map((w) => w.id));
      this.db.mistakes = this.db.mistakes.filter((m) => !ids.has(m.wordId));
    }
    this.save();
  }

  clearPracticeLog() {
    this.db.practiceLog = [];
    this.save();
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
    this.save();
    return { bookId: targetId, added, skipped };
  }
}

module.exports = { Store };
