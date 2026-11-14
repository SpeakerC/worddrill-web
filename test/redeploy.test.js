import { test } from 'node:test';
import assert from 'node:assert';

import { Store } from '../public/js/store.js';

function seedOld() {
  const store = new Store();
  const book = store.seedBuiltin([
    { w: 'v]', pos: '', m: 't. 把…分类，拣选' },
    { w: 'body', pos: 'n.', m: '旧身体' },
    { w: 'obsolete', pos: 'n.', m: '将被删除' },
  ], { name: '测试词库', seedId: 'test' });
  return { store, book };
}

test('重新部署：按词头保留 id/进度，补新词、删废词', () => {
  const { store, book } = seedOld();
  const old = store.db.words.filter((w) => w.bookId === book.id);
  const broken = old.find((w) => w.word === 'v]');
  const body = old.find((w) => w.word === 'body');
  const obsolete = old.find((w) => w.word === 'obsolete');
  const imported = store.importEntries(null, '自建', [{ word: 'keep', pos: 'n.', meaning: '保留' }]);

  store.setStar(broken.id, true);
  store.recordAnswer(broken.id, 'en_zh', false);
  store.setBlocked(body.id, true);
  store.setLearned(body.id, true);
  store.recordAnswer(obsolete.id, 'en_zh', true);

  const entries = [
    { w: 'sort', pos: 'v.&n.', m: '把…分类，拣选；种类，类别' },
    { w: 'body', pos: 'n.', m: '身体' },
    { w: 'new', pos: 'a.', m: '新的' },
  ];
  const result = store.redeployBuiltinBooks(
    [{ seedId: 'test', name: '测试词库', entries }],
    { 'v]': 'sort' },
  );

  assert.deepEqual(
    { added: result.added, removed: result.removed, merged: result.merged, renamed: result.renamed },
    { added: 1, removed: 1, merged: 0, renamed: 1 },
  );

  const by = new Map(store.db.words.filter((w) => w.bookId === book.id).map((w) => [w.word, w]));
  assert.equal(by.get('sort').id, broken.id, 'v] 的 id 应跟到 sort');
  assert.equal(by.get('sort').pos, 'v.&n.');
  assert.equal(by.get('sort').meaning, '把…分类，拣选；种类，类别');
  assert.equal(by.get('sort').starred, true);
  assert.equal(by.get('sort').ord, 1);
  assert.equal(by.get('body').id, body.id);
  assert.equal(by.get('body').meaning, '身体');
  assert.equal(by.get('body').blocked, true);
  assert.equal(by.get('body').learned, true);
  assert.equal(by.get('new').ord, 3);
  assert.ok(!by.has('obsolete'));

  assert.equal(store.db.practiceLog.find((p) => p.wordId === broken.id).times, 1);
  assert.equal(store.db.mistakes.find((m) => m.wordId === broken.id).wrong, 1);
  assert.ok(store.db.review.some((r) => r.wordId === broken.id));
  assert.equal(store.db.practiceLog.some((p) => p.wordId === obsolete.id), false);
  assert.equal(store.db.mistakes.some((m) => m.wordId === obsolete.id), false);
  assert.equal(store.db.review.some((r) => r.wordId === obsolete.id), false);

  assert.ok(store.db.words.some((w) => w.bookId === imported.bookId && w.word === 'keep'), '自建词库不能动');

  // 再跑一次应该是幂等的
  const again = store.redeployBuiltinBooks([{ seedId: 'test', name: '测试词库', entries }], { 'v]': 'sort' });
  assert.equal(again.added, 0);
  assert.equal(again.removed, 0);
  assert.equal(again.merged, 0);
  assert.equal(again.renamed, 0);
  assert.equal(store.db.words.find((w) => w.word === 'sort').id, broken.id);
  assert.equal(store.db.practiceLog.find((p) => p.wordId === broken.id).times, 1);
});

test('重新部署：旧坏词头并进同名新词，记录合并', () => {
  const store = new Store();
  const book = store.seedBuiltin([
    { w: 'ad.', pos: '', m: '也' },
    { w: 'either', pos: 'a.', m: '二者之一' },
  ], { name: '测试词库', seedId: 'test' });
  const words = store.db.words.filter((w) => w.bookId === book.id);
  const broken = words.find((w) => w.word === 'ad.');
  const either = words.find((w) => w.word === 'either');

  store.setStar(broken.id, true);
  store.recordAnswer(broken.id, 'en_zh', true);
  store.recordAnswer(either.id, 'en_zh', false);

  const result = store.redeployBuiltinBooks(
    [{ seedId: 'test', name: '测试词库', entries: [{ w: 'either', pos: 'a.&conj.', m: '二者之一；也' }] }],
    { 'ad.': 'either' },
  );
  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
  assert.equal(result.merged, 1);
  assert.equal(result.renamed, 0);

  const target = store.db.words.find((w) => w.word === 'either');
  assert.equal(target.id, either.id);
  assert.equal(target.starred, true);
  assert.equal(target.pos, 'a.&conj.');
  assert.equal(store.db.practiceLog.find((p) => p.wordId === target.id).times, 2);
  assert.equal(store.db.mistakes.find((m) => m.wordId === target.id).wrong, 1);
  assert.equal(store.db.review.find((r) => r.wordId === target.id).level, 1, '复习等级取更高的那条');
  assert.ok(!store.db.words.some((w) => w.word === 'ad.'));
  assert.ok(!store.db.practiceLog.some((p) => p.wordId === broken.id));
});

test('重新部署：只有星号/重音差异的词按归一化对齐，保留 id', () => {
  const store = new Store();
  const book = store.seedBuiltin(
    [{ w: 'Egypt*', pos: 'n.', m: '埃及' }],
    { name: '测试词库', seedId: 'test' },
  );
  const old = store.db.words[0];
  store.setStar(old.id, true);

  const result = store.redeployBuiltinBooks(
    [{ seedId: 'test', name: '测试词库', entries: [{ w: 'Egypt', pos: 'n.', m: '埃及' }] }],
    {},
  );
  assert.equal(result.renamed, 1);
  const word = store.db.words.find((w) => w.word === 'Egypt');
  assert.equal(word.id, old.id);
  assert.equal(word.starred, true);
});

test('重新部署成功后写入词表内容版本', () => {
  const { store, book } = seedOld();
  assert.equal(store.db.wordlistVersion, 0);
  const entries = store.db.words
    .filter((w) => w.bookId === book.id)
    .map((w) => ({ w: w.word, pos: w.pos, m: w.meaning }));
  store.redeployBuiltinBooks([{ seedId: 'test', name: '测试词库', entries }], {}, 2);
  assert.equal(store.db.wordlistVersion, 2);
});

test('重新部署：缺书时新建，导入词库完全不动', () => {
  const store = new Store();
  const imported = store.importEntries(null, '自建', [{ word: 'keep', pos: 'n.', meaning: '保留' }]);
  const result = store.redeployBuiltinBooks(
    [{ seedId: 'test', name: '新内置库', entries: [{ w: 'alpha', pos: 'n.', m: '甲' }] }],
    {},
  );
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].before, 0);
  assert.equal(result.added, 1);
  assert.equal(store.books().length, 2);
  assert.equal(store.words(imported.bookId).length, 1);
  assert.equal(store.words(imported.bookId)[0].word, 'keep');
});