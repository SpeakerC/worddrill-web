import { test } from 'node:test';
import assert from 'node:assert';

import { Store } from '../public/js/store.js';

const SEED = [
  { w: 'alpha', pos: 'n.', m: '甲' },
  { w: 'beta', pos: 'n.', m: '乙' },
  { w: 'gamma', pos: 'n.', m: '丙' },
  { w: 'delta', pos: 'n.', m: '丁' },
];

function tempStore() {
  const store = new Store();
  store.seedBuiltin(SEED);
  return store;
}

/** 模拟「练过但复习排期丢失」的老数据：只有 practiceLog，没有 db.review。 */
function logOnly(store, wordId, lastAt = Date.now() - 1000) {
  store.db.practiceLog.push({ wordId, times: 1, lastAt });
  return { wordId, times: 1, lastAt };
}

test('答过题的单词：dueAt 在未来时不到期，过去时到期', () => {
  const store = tempStore();
  const [first] = store.words(1);
  store.recordAnswer(first.id, 'en_zh', true);

  const record = store.db.review.find((r) => r.wordId === first.id);
  assert.ok(record, '应生成复习记录');

  // 刚答完，下次复习在未来：今天不带复习，但仍在「全部练过的词」里
  assert.equal(store.reviewWordCount('due', record.dueAt - 1), 0, '到期前不应出现在今日复习');
  assert.equal(store.reviewWords(200, 'due', record.dueAt - 1).length, 0);
  assert.equal(store.reviewWordCount('all', record.dueAt - 1), 1, '练过的词永远在复习范围内');

  // 到期时刻及之后：进今日复习
  const due = store.reviewWords(200, 'due', record.dueAt);
  assert.equal(due.length, 1);
  assert.equal(due[0].word, 'alpha');
  assert.equal(due[0].overdue, true);

  // 明确把 dueAt 设到过去：到期
  store.db.review.find((r) => r.wordId === first.id).dueAt = Date.now() - 1000;
  assert.equal(store.reviewWordCount('due', Date.now()), 1);
});

test('只有 practiceLog 的词也被当作可复习（等级 0）', () => {
  const store = tempStore();
  const [, second] = store.words(1);
  logOnly(store, second.id);

  assert.equal(store.db.review.length, 0, '前提：没有任何复习记录');

  const due = store.reviewWords(200, 'due');
  assert.equal(due.length, 1);
  assert.equal(due[0].word, 'beta');
  assert.equal(due[0].level, 0, '没排过的练过的词按等级 0 处理');
  assert.equal(store.reviewWordCount('due'), 1);
  assert.equal(store.reviewWordCount('due', 0), 1, '缺记录等价于 dueAt = 0，任何时刻都该复习');
});

test('ensureReviewRecords 为练习日志补记录，且幂等', () => {
  const store = tempStore();
  const [, second] = store.words(1);
  const lastAt = Date.now() - 1000;
  logOnly(store, second.id, lastAt);

  const created = store.ensureReviewRecords();
  assert.equal(created, 1, '应补 1 条复习记录');

  const record = store.db.review.find((r) => r.wordId === second.id);
  assert.ok(record, '应生成复习记录');
  assert.equal(record.level, 0);
  assert.equal(record.dueAt, 0, '未记录过的词立即到期');
  assert.equal(record.lastAt, lastAt, '沿用 practiceLog 的 lastAt');

  assert.equal(store.ensureReviewRecords(), 0, '再次调用不应重复补记录');
  assert.equal(store.db.review.length, 1);
});

test('从没练过的词不出现在到期复习里', () => {
  const store = tempStore();
  const [, second] = store.words(1);
  logOnly(store, second.id);

  const due = store.reviewWords(200, 'due');
  assert.equal(due.length, 1);
  assert.ok(due.every((w) => w.word !== 'alpha' && w.word !== 'gamma' && w.word !== 'delta'));
  assert.equal(store.reviewWordCount('due'), 1);
});

test('屏蔽掉的练过的词不出现在到期复习里', () => {
  const store = tempStore();
  const [, second] = store.words(1);
  logOnly(store, second.id);

  assert.equal(store.reviewWordCount('due'), 1);
  store.setBlocked(second.id, true);
  assert.equal(store.reviewWords(200, 'due').length, 0);
  assert.equal(store.reviewWordCount('due'), 0);

  store.setBlocked(second.id, false);
  assert.equal(store.reviewWordCount('due'), 1);
});

test('到期复习排序：到期的在前，同级按 dueAt 升序，limit 生效', () => {
  const store = tempStore();
  const now = Date.now();
  const [a, b, c, d] = store.words(1);

  // a：等级 1，早已到期
  store.db.practiceLog.push({ wordId: a.id, times: 2, lastAt: now - 5000 });
  store.db.review.push({ wordId: a.id, level: 1, dueAt: now - 5000, lastAt: now - 5000, lapses: 0 });
  // b、c：等级 0（无复习记录），有效 dueAt 视为 0，最该先复习
  logOnly(store, b.id, now - 3000);
  logOnly(store, c.id, now - 1000);
  // d：等级 0，但 dueAt 明确在更早的过去
  store.db.practiceLog.push({ wordId: d.id, times: 1, lastAt: now - 6000 });
  store.db.review.push({ wordId: d.id, level: 0, dueAt: now - 6000, lastAt: now - 6000, lapses: 0 });

  const all = store.reviewWords(200, 'due', now);
  assert.equal(all.length, 4);
  assert.deepEqual(all.map((w) => w.word), ['beta', 'gamma', 'delta', 'alpha'], '缺排期的 dueAt=0 最靠前，等级高的排后面');
  assert.deepEqual(all.map((w) => w.level), [0, 0, 0, 1]);

  // limit 生效
  const one = store.reviewWords(1, 'due', now);
  assert.equal(one.length, 1);
  assert.equal(one[0].word, 'beta');
  assert.equal(store.reviewWords(0, 'due', now).length, 0);
});

test('读到期的接口没有副作用，连续两次结果一致', () => {
  const store = tempStore();
  const [, second] = store.words(1);
  logOnly(store, second.id);

  const firstCount = store.reviewWordCount('due');
  const firstList = store.reviewWords(200, 'due');
  const secondCount = store.reviewWordCount('due');
  const secondList = store.reviewWords(200, 'due');

  assert.equal(firstCount, secondCount);
  assert.equal(secondCount, 1);
  assert.equal(firstList.length, secondList.length);
  assert.deepEqual(firstList.map((w) => w.word), secondList.map((w) => w.word));
  assert.equal(store.db.practiceLog.length, 1, '读取接口不应改动练习日志');
});
