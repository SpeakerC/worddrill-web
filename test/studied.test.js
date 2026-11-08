import { test } from 'node:test';
import assert from 'node:assert';

import { Store } from '../public/js/store.js';
import { dayKey } from '../public/js/review.js';

const SEED = [
  { w: 'alpha', pos: 'n.', m: '甲' },
  { w: 'bravo', pos: 'n.', m: '乙' },
  { w: 'charlie', pos: 'n.', m: '丙' },
  { w: 'delta', pos: 'n.', m: '丁' },
];

function tempStore() {
  const store = new Store();
  store.seedBuiltin(SEED, { name: '测试词库', seedId: 'test' });
  return store;
}

/* ---------- 错题本 ---------- */

test('错题本支持搜索、三种排序', () => {
  const store = tempStore();
  const words = store.words(1);
  // alpha 错 1 次、bravo 错 3 次、charlie 错 2 次
  store.recordAnswer(words[0].id, 'en_zh', false);
  for (let i = 0; i < 3; i += 1) store.recordAnswer(words[1].id, 'en_zh', false);
  store.recordAnswer(words[2].id, 'en_zh', false);
  store.recordAnswer(words[2].id, 'en_zh', false);

  assert.equal(store.mistakes(1).length, 3);
  assert.deepEqual(store.mistakes(1, { sort: 'wrong' }).map((m) => m.word.word), ['bravo', 'charlie', 'alpha']);
  assert.deepEqual(store.mistakes(1, { sort: 'alpha' }).map((m) => m.word.word), ['alpha', 'bravo', 'charlie']);

  const searched = store.mistakes(1, { query: '乙' });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].word.word, 'bravo');

  const byWord = store.mistakes(1, { query: 'CHAR' });
  assert.equal(byWord.length, 1, '搜索不区分大小写');
});

test('手动移出错题本不写入对错记录', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', false);
  const logBefore = store.db.practiceLog.length;

  assert.equal(store.removeMistake(words[0].id), true);
  assert.equal(store.mistakes(1).length, 0);
  assert.equal(store.db.practiceLog.length, logBefore, '练习记录不受影响');
  assert.equal(store.removeMistake(words[0].id), false, '再移一次返回 false');
});

/* ---------- 已学过 ---------- */

test('已学过：只列当前词库练过的词，带等级与到期时间', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', true);
  store.recordAnswer(words[1].id, 'en_zh', true);

  const studied = store.studiedWords(1, 'all');
  assert.equal(studied.length, 2, '只算练过的两个');
  assert.deepEqual(studied.map((w) => w.word).sort(), ['alpha', 'bravo']);
  assert.ok(studied[0].dueAt > 0, '有下次复习时间');
  assert.equal(studied[0].level, 1);
});

test('已学过：按未掌握 / 已掌握 / 易忘筛选', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', true);                       // 1 级
  for (let i = 0; i < 5; i += 1) store.recordAnswer(words[1].id, 'en_zh', true); // 5 级

  const counts = store.studiedCounts(1);
  assert.equal(counts.all, 2);
  assert.equal(counts.mastered, 1);
  assert.equal(counts.unmastered, 1);

  assert.deepEqual(store.studiedWords(1, 'mastered').map((w) => w.word), ['bravo']);
  assert.deepEqual(store.studiedWords(1, 'unmastered').map((w) => w.word), ['alpha']);
});

test('已学过：答错过的词算易忘', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', true);
  store.recordAnswer(words[1].id, 'en_zh', false);

  const forgetting = store.studiedWords(1, 'forgetting');
  assert.equal(forgetting.length, 1);
  assert.equal(forgetting[0].word, 'bravo');
  assert.equal(store.studiedCounts(1).forgetting, 1);
});

test('已学过：不跨词库，屏蔽的词不出现', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', true);
  store.recordAnswer(words[1].id, 'en_zh', true);

  const other = store.addBook('另一本');
  const id = store.db.nextWordId++;
  store.db.words.push({
    id, bookId: other.id, ord: 1, word: 'echo', pos: 'n.', meaning: '戊',
    starred: false, blocked: false, createdAt: Date.now(),
  });
  store.recordAnswer(id, 'en_zh', true);

  assert.equal(store.studiedWords(1, 'all').length, 2, '词库 1 只有自己那两个');
  assert.equal(store.studiedWords(other.id, 'all').length, 1);

  store.setBlocked(words[0].id, true);
  assert.equal(store.studiedWords(1, 'all').length, 1, '屏蔽后不出现');
});

/* ---------- 未来复习量 ---------- */

test('未来 7 天复习量：过期与窗口外的都并入今天', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', true);
  store.recordAnswer(words[1].id, 'en_zh', true);

  const now = Date.now();
  const plan = store.upcomingReview(7, now);
  assert.equal(plan.length, 7, '7 天');

  const total = plan.reduce((n, d) => n + d.count, 0);
  assert.equal(total, 2, '两个练过的词都计入');

  // 把一个词改成 3 天后
  const r = store.db.review[0];
  const future = new Date(now + 3 * 86400000);
  r.dueAt = future.getTime();
  const plan2 = store.upcomingReview(7, now);
  const target = plan2.find((d) => d.date === dayKey(future));
  assert.equal(target.count, 1, '排到第 3 天');

  // 过期的算进今天
  store.db.review[1].dueAt = now - 5 * 86400000;
  const plan3 = store.upcomingReview(7, now);
  assert.equal(plan3[0].count, 1);
  assert.equal(plan3[0].overdue, true);

  // 超出 7 天窗口的也并入今天
  store.db.review[1].dueAt = now + 30 * 86400000;
  const plan4 = store.upcomingReview(7, now);
  assert.equal(plan4.reduce((n, d) => n + d.count, 0), 2);
  assert.equal(plan4[0].count, 1, '远的算回今天');
});

test('未来复习量第一项就是今天', () => {
  const store = tempStore();
  const plan = store.upcomingReview(7);
  assert.equal(plan[0].date, dayKey());
  assert.equal(plan[0].overdue, true);
});


