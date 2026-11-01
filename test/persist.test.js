import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store } from '../public/js/store.js';
import { createStorage, exportBackup, parseBackup } from '../public/js/persist.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'seed.json'), 'utf8'));

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function connected() {
  const storage = fakeStorage();
  const persist = createStorage({ storage });
  const store = new Store({ onChange: (part) => persist.save(part) });
  persist.bind(store.db);
  store.seedBuiltin(SEED);
  return { storage, persist, store };
}

test('首次打开没有数据，读取时返回 null', () => {
  assert.equal(createStorage({ storage: fakeStorage() }).load(), null);
});

test('改动防抖写入，flush 之后重新加载能拿到同样的数据', () => {
  const { storage, persist, store } = connected();
  const book = store.books()[0];
  const word = store.words(book.id)[0];

  store.setStar(word.id, true);
  store.setBlocked(word.id, true);
  persist.flush();

  const reloaded = createStorage({ storage }).load();
  assert.ok(reloaded, '应该能读回数据');
  assert.equal(reloaded.words.length, SEED.length);
  assert.equal(reloaded.books[0].name, '高中 3500 词');
  const target = reloaded.words.find((w) => w.id === word.id);
  assert.equal(target.starred, true);
  assert.equal(target.blocked, true);
});

test('答题记录分开存放，不会重写词表', () => {
  const { storage, persist, store } = connected();
  const word = store.words(store.books()[0].id)[0];
  store.recordAnswer(word.id, 'en_zh', false);
  persist.flush();

  assert.ok(storage.map.has('worddrill.db.mistakes'));
  assert.ok(storage.map.has('worddrill.db.log'));
  const reloaded = createStorage({ storage }).load();
  assert.equal(reloaded.mistakes.length, 1);
  assert.equal(reloaded.practiceLog[0].times, 1);
});

test('导出再导入，数据一致', () => {
  const { store } = connected();
  const book = store.books()[0];
  store.setStar(store.words(book.id)[1].id, true);
  const text = exportBackup(store.serialize());

  const restored = new Store();
  restored.replaceDb(parseBackup(text));
  assert.deepEqual(restored.words(book.id).map((w) => w.word), store.words(book.id).map((w) => w.word));
  assert.equal(restored.words(book.id)[1].starred, true);
});

test('旧版 data/db.json 也能直接恢复，缺失的自增 id 会自动补上', () => {
  const legacy = {
    version: 1,
    books: [{ id: 1, name: '高中 3500 词', builtin: true, createdAt: 1 }],
    words: [{ id: 7, bookId: 1, ord: 1, word: 'alpha', pos: 'n.', meaning: '甲', starred: false, blocked: false }],
    mistakes: [],
    practiceLog: [],
  };
  const db = parseBackup(JSON.stringify(legacy));
  assert.equal(db.nextBookId, 2);
  assert.equal(db.nextWordId, 8);

  const store = new Store({ db });
  const added = store.importEntries(1, null, [{ word: 'beta', pos: '', meaning: '乙' }]);
  assert.equal(added.added, 1);
  assert.equal(store.words(1).length, 2);
});

test('不是备份文件时给出明确错误', () => {
  assert.throws(() => parseBackup('not json'), /不是有效的 JSON/);
  assert.throws(() => parseBackup('{"foo":1}'), /不是「单词练习」的备份文件/);
});
