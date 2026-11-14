import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store } from '../public/js/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'seed.json'), 'utf8'));

function tempStore() {
  const store = new Store();
  store.seedBuiltin(SEED, { name: '测试词库', seedId: 'test' });
  return store;
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

test('答错进错题，连续答对 2 次才移出；新练习不再抽已练词', () => {
  const store = tempStore();
  const book = store.books()[0];
  const word = store.words(book.id)[0];

  store.recordAnswer(word.id, 'en_zh', false);
  assert.equal(store.mistakes(book.id).length, 1);
  assert.equal(store.mistakes(book.id)[0].wrong, 1);
  assert.equal(store.mistakes(book.id)[0].streak, 0);

  const left = store.pickWords(book.id, { start: 1, end: 4, count: 10 });
  assert.equal(left.length, 3);
  assert.ok(!left.some((w) => w.id === word.id));

  // 第一次答对：还在错题本里
  store.recordAnswer(word.id, 'en_zh', true);
  assert.equal(store.mistakes(book.id).length, 1, '只答对 1 次不该移出');
  assert.equal(store.mistakes(book.id)[0].streak, 1);

  // 第二次连续答对：移出
  store.recordAnswer(word.id, 'en_zh', true);
  assert.equal(store.mistakes(book.id).length, 0, '连续答对 2 次才移出');

  store.clearPracticeLog();
  assert.equal(store.pickWords(book.id, { start: 1, end: 4, count: 10 }).length, 4);
});

test('首练标成已掌握后不再抽到、不进复习计划，算已掌握并能恢复', () => {
  const store = tempStore();
  const book = store.books()[0];
  const words = store.words(book.id);
  const skipped = words[0];
  const practiced = words[1];

  // 首练时手动标成已掌握
  assert.equal(store.setLearned(skipped.id, true), true);
  const picked = store.pickWords(book.id, { start: 1, end: 4, count: 10 });
  assert.equal(picked.length, 3, '已掌握的不该被抽到');
  assert.ok(!picked.some((w) => w.id === skipped.id));

  // 练过的词也不该再进新练习
  store.recordAnswer(practiced.id, 'en_zh', true);
  const after = store.pickWords(book.id, { start: 1, end: 4, count: 10 });
  assert.equal(after.length, 2);
  assert.ok(!after.some((w) => w.id === practiced.id));

  // 已懂的不进学习计划：不补复习排期、复习列表里也没有
  store.ensureReviewRecords();
  assert.ok(!store.db.review.some((r) => r.wordId === skipped.id), '不该补复习排期');
  assert.equal(store.reviewWordCount('all'), 1, '复习里只应有练过的那一个');

  // 已练词汇里按「已掌握」算
  const mastered = store.studiedWords(book.id, 'mastered');
  assert.ok(mastered.some((w) => w.id === skipped.id), '已掌握筛选里应有这个词');
  assert.equal(store.studiedCounts(book.id).mastered, 1);
  assert.equal(store.stats(book.id).learned, 1);
  assert.equal(store.stats(book.id).fresh, 2);

  // 报告里的掌握度也算已掌握
  assert.equal(store.masteryStats(book.id).mastered, 1);

  // 恢复：又变成没练过的词，能重新抽到
  assert.equal(store.setLearned(skipped.id, false), true);
  assert.equal(store.stats(book.id).learned, 0);
  assert.equal(store.pickWords(book.id, { start: 1, end: 4, count: 10 }).length, 3);
});

test('已掌握的词再被练也不会重新排进复习计划', () => {
  const store = tempStore();
  const book = store.books()[0];
  const word = store.words(book.id)[0];
  store.setLearned(word.id, true);

  store.recordAnswer(word.id, 'en_zh', false);
  assert.equal(store.db.review.length, 0, '不该新增复习排期');
  store.ensureReviewRecords();
  assert.equal(store.db.review.length, 0, 'ensureReviewRecords 也应跳过它');
  assert.equal(store.reviewWords(10, 'all').length, 0);
});

test('答错一次会把连对次数清零', () => {
  const store = tempStore();
  const book = store.books()[0];
  const word = store.words(book.id)[0];

  store.recordAnswer(word.id, 'en_zh', false); // 进错题
  store.recordAnswer(word.id, 'en_zh', true);  // 连对 1
  store.recordAnswer(word.id, 'en_zh', true);  // 连对 2 -> 移出
  assert.equal(store.mistakes(book.id).length, 0);

  store.recordAnswer(word.id, 'en_zh', false); // 又错，重新进
  store.recordAnswer(word.id, 'en_zh', true);  // 连对 1
  store.recordAnswer(word.id, 'en_zh', false); // 答错，清零
  assert.equal(store.mistakes(book.id)[0].streak, 0, '答错后连对次数归零');
  assert.equal(store.mistakes(book.id).length, 1);

  store.recordAnswer(word.id, 'en_zh', true);
  assert.equal(store.mistakes(book.id).length, 1, '只连对 1 次不移出');
  store.recordAnswer(word.id, 'en_zh', true);
  assert.equal(store.mistakes(book.id).length, 0, '重新连对 2 次才移出');
});

test('删除词库会一起清掉错题与练习记录，内置词库删不掉', () => {
  const store = tempStore();
  const builtin = store.books()[0];
  assert.equal(store.deleteBook(builtin.id), false);

  const imported = store.importEntries(null, '临时', [{ word: 'temp', pos: '', meaning: '临时' }]);
  const word = store.words(imported.bookId)[0];
  store.recordAnswer(word.id, 'en_zh', false);
  assert.equal(store.mistakes().length, 1);

  assert.equal(store.deleteBook(imported.bookId), true);
  assert.equal(store.mistakes().length, 0);
  assert.equal(store.books().length, 1);
});

