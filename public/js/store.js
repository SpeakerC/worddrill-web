/**
 * 纯状态层：只操作内存里的数据结构，不碰文件、网络、浏览器 API。
 * Node 的单元测试和浏览器里的应用共用这一份代码。
 *
 * 数据结构对应 Android 版的 SQLite 表 books / words / mistakes / practice_log。
 * 索引规则也一致：words.ord 是入库顺序（稳定），对外返回的 index 是
 * 「当前可见索引」——屏蔽词不占号，其余单词从 1 连续编号。
 */

export function emptyDb() {
  return {
    version: 1,
    nextBookId: 1,
    nextWordId: 1,
    books: [],
    words: [],
    mistakes: [],
    practiceLog: [],
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
  if (!Number.isFinite(raw && raw.nextBookId)) db.nextBookId = maxId(db.books) + 1;
  if (!Number.isFinite(raw && raw.nextWordId)) db.nextWordId = maxId(db.words) + 1;
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

  /** 用内置词表播种（只在没有词库时调用一次）。 */
  seedBuiltin(entries, name = '高中 3500 词') {
    const now = Date.now();
    const book = { id: this.db.nextBookId++, name, builtin: true, createdAt: now };
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

  /** 整体替换（恢复备份用）。 */
  replaceDb(raw) {
    this.db = normalizeDb(raw);
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
    this.change('mistakes');
    this.change('log');
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
