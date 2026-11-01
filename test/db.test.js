'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../lib/db');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worddrill-'));
  return new Store({ dataDir: dir, seedFile: path.join(__dirname, 'fixtures', 'seed.json') }).load();
}

test('内置词库按顺序播种，索引从 1 开始', () => {
  const store = tempStore();
  const books = store.books();
  assert.equal(books.length, 1);
  assert.equal(books[0].builtin, true);
  assert.equal(books[0].wordCount, 4);
  assert.deepEqual(store.words(books[0].id).map((w) => w.index), [1, 2, 3, 4]);
  assert.equal(store.words(books[0].id)[0].word, 'alpha');
});

test('屏蔽后索引连续重排，恢复后回到原位', () => {
  const store = tempStore();
  const book = store.books()[0];
  const words = store.words(book.id);

  store.setBlocked(words[2].id, true);
  const visible = store.words(book.id);
  assert.deepEqual(visible.map((w) => w.word), ['alpha', 'beta', 'delta']);
  assert.deepEqual(visible.map((w) => w.index), [1, 2, 3]);
  assert.equal(store.stats(book.id).wordCount, 3);
  assert.equal(store.stats(book.id).blockedCount, 1);
  assert.equal(store.words(book.id, 'blocked').length, 1);

  const picked = store.pickWords(book.id, { start: 2, end: 2, count: 5 });
  assert.deepEqual(picked.map((w) => w.word), ['beta']);

  store.setBlocked(store.words(book.id, 'blocked')[0].id, false);
  assert.deepEqual(store.words(book.id).map((w) => w.index), [1, 2, 3, 4]);
});

test('导入按出现顺序递增，重复词跳过', () => {
  const store = tempStore();
  const result = store.importEntries(null, '我的词表', [
    { word: 'apple', pos: 'n.', meaning: '苹果' },
    { word: 'pick out', pos: '', meaning: '挑选' },
    { word: 'apple', pos: 'n.', meaning: '苹果' },
  ]);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  const words = store.words(result.bookId);
  assert.deepEqual(words.map((w) => w.word), ['apple', 'pick out']);
  assert.deepEqual(words.map((w) => w.index), [1, 2]);

  const more = store.importEntries(result.bookId, null, [{ word: 'jump', pos: 'v.', meaning: '跳' }]);
  assert.equal(more.added, 1);
  assert.deepEqual(store.words(result.bookId).map((w) => w.index), [1, 2, 3]);
});

test('答错进错题，答对移出；关闭重复时不再抽已练词', () => {
  const store = tempStore();
  const book = store.books()[0];
  const word = store.words(book.id)[0];

  store.recordAnswer(word.id, 'en_zh', false);
  assert.equal(store.mistakes(book.id).length, 1);
  assert.equal(store.mistakes(book.id)[0].wrong, 1);

  const left = store.pickWords(book.id, { start: 1, end: 4, count: 10, allowRepeat: false });
  assert.equal(left.length, 3);
  assert.ok(!left.some((w) => w.id === word.id));

  store.recordAnswer(word.id, 'en_zh', true);
  assert.equal(store.mistakes(book.id).length, 0);

  store.clearPracticeLog();
  assert.equal(store.pickWords(book.id, { start: 1, end: 4, count: 10, allowRepeat: false }).length, 4);
});
