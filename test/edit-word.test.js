import { test } from 'node:test';
import assert from 'node:assert';

import { Store } from '../public/js/store.js';

function importedStore() {
  const store = new Store();
  const result = store.importEntries(null, '自建词库', [
    { word: 'abandon', pos: 'v.', meaning: '放弃' },
    { word: 'ability', pos: 'n.', meaning: '能力' },
  ]);
  return { store, bookId: result.bookId };
}

test('自建词库可以修改拼写、词性和释义，学习记录保留', () => {
  const { store, bookId } = importedStore();
  const word = store.words(bookId)[0];
  store.recordAnswer(word.id, 'en_zh', true);

  const updated = store.updateWord(word.id, {
    word: 'abandoned',
    pos: 'adj.',
    meaning: '被放弃的',
  });

  assert.equal(updated.word, 'abandoned');
  assert.equal(updated.pos, 'adj.');
  assert.equal(updated.meaning, '被放弃的');
  assert.equal(store.words(bookId)[0].word, 'abandoned');
  assert.ok(store.db.practiceLog.some((p) => p.wordId === word.id), '练习记录按 id 保留');
  assert.ok(store.db.review.some((r) => r.wordId === word.id), '复习排期也保留');
});

test('自建词库改词时不允许空拼写、空释义、重复词和非法字符', () => {
  const { store, bookId } = importedStore();
  const [first, second] = store.words(bookId);

  assert.throws(() => store.updateWord(first.id, { word: '', meaning: '空' }), /不能为空/);
  assert.throws(() => store.updateWord(first.id, { word: 'fine', meaning: '' }), /不能为空/);
  assert.throws(() => store.updateWord(first.id, { word: 'ability', meaning: '能力' }), /已经有/);
  assert.throws(() => store.updateWord(first.id, { word: 'a|b', meaning: '管道' }), /不合法/);
  assert.equal(store.words(bookId)[1].word, second.word, '失败时不应改到其他词');
});

test('内置词库不能修改', () => {
  const store = new Store();
  store.seedBuiltin([{ w: 'alpha', pos: 'n.', m: '甲' }], { name: '内置', seedId: 'builtin' });
  const word = store.words(1)[0];
  assert.throws(() => store.updateWord(word.id, { word: 'beta', meaning: '乙' }), /内置词库不能修改/);
});