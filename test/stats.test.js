import { test } from 'node:test';
import assert from 'node:assert';

import { Store } from '../public/js/store.js';
import {
  DAY_MS, MAX_LEVEL, nextLevel, intervalDays, nextDueAt, dayKey, recentDayKeys, streak,
} from '../public/js/review.js';

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

test('复习曲线：答对升级，答错归零', () => {
  assert.equal(nextLevel(0, true), 1);
  assert.equal(nextLevel(6, true), MAX_LEVEL);
  assert.equal(nextLevel(6, true), 7);
  assert.equal(nextLevel(5, false), 0);

  assert.equal(intervalDays(1, true), 1);
  assert.equal(intervalDays(3, true), 4);
  assert.equal(intervalDays(4, true), 7);
  assert.equal(intervalDays(7, true), 60);
  assert.equal(intervalDays(4, false), 1);

  const now = 1_700_000_000_000;
  assert.equal(nextDueAt(0, true, now) - now, DAY_MS);
  assert.equal(nextDueAt(3, true, now) - now, 7 * DAY_MS);
});

test('日期键按本地时间，连续打卡从今天或昨天往前数', () => {
  assert.equal(dayKey(new Date(2026, 10, 3)), '2026-11-03');
  const keys = recentDayKeys(3, new Date(2026, 10, 3, 9).getTime());
  assert.deepEqual(keys, ['2026-11-01', '2026-11-02', '2026-11-03']);

  assert.equal(streak('2026-11-03', new Set(['2026-11-03', '2026-11-02'])), 2);
  // 今天还没练不算断签，从昨天开始数
  assert.equal(streak('2026-11-03', new Set(['2026-11-02', '2026-11-01'])), 2);
  assert.equal(streak('2026-11-03', new Set()), 0);
  // 中间断一天就停
  assert.equal(streak('2026-11-03', new Set(['2026-11-03', '2026-11-01'])), 1);
});

test('答题会写入复习排期与当日统计', () => {
  const store = tempStore();
  const [first] = store.words(1);
  store.recordAnswer(first.id, 'en_zh', true);

  const record = store.db.review.find((r) => r.wordId === first.id);
  assert.ok(record, '应生成复习记录');
  assert.equal(record.level, 1);
  assert.equal(record.lapses, 0);
  assert.ok(record.dueAt > Date.now());

  const day = store.db.daily.find((d) => d.date === dayKey());
  assert.equal(day.answered, 1);
  assert.equal(day.correct, 1);

  store.recordAnswer(first.id, 'en_zh', false);
  const afterWrong = store.db.review.find((r) => r.wordId === first.id);
  assert.equal(afterWrong.level, 0, '答错归零');
  assert.equal(afterWrong.lapses, 1);
  assert.equal(store.db.daily.find((d) => d.date === dayKey()).answered, 2);
  assert.equal(store.db.daily.find((d) => d.date === dayKey()).correct, 1);
});

test('掌握度按复习等级分三档', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', true); // 1 级 → 学习中
  for (let i = 0; i < 5; i += 1) store.recordAnswer(words[1].id, 'en_zh', true); // 5 级 → 已掌握

  const stats = store.masteryStats(1);
  assert.equal(stats.total, 4);
  assert.equal(stats.fresh, 2);
  assert.equal(stats.learning, 1);
  assert.equal(stats.mastered, 1);
  assert.equal(stats.masteredPercent, 25);
});

test('到期复习只返回没屏蔽的词，等级低的优先', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', true);
  store.recordAnswer(words[1].id, 'en_zh', true);
  store.recordAnswer(words[1].id, 'en_zh', true);

  // 都还没到期
  assert.equal(store.dueReviewCount(), 0);

  const past = Date.now() - 1000;
  store.db.review.forEach((r) => { r.dueAt = past; });
  store.setBlocked(words[1].id, true);

  const due = store.dueReviewWords(200);
  assert.equal(due.length, 1);
  assert.equal(due[0].word, 'alpha');

  store.setBlocked(words[1].id, false);
  const both = store.dueReviewWords(200);
  assert.equal(both.length, 2);
  assert.equal(both[0].word, 'alpha', '1 级应排在 2 级前面');
});

test('学习报告汇总今日题量、累计与最该复习的词', () => {
  const store = tempStore();
  const words = store.words(1);
  store.recordAnswer(words[0].id, 'en_zh', true);
  store.recordAnswer(words[1].id, 'en_zh', false);
  store.recordAnswer(words[1].id, 'en_zh', false);

  const summary = store.studySummary(7, 30);
  assert.equal(summary.todayAnswered, 3);
  assert.equal(summary.totalAnswered, 3);
  assert.equal(summary.totalCorrect, 1);
  assert.equal(summary.dailyGoal, 30);
  assert.equal(summary.streak, 1);
  assert.equal(summary.days.length, 7);

  const wrong = store.topWrongWords(1, 8);
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0].word.word, 'beta');
  assert.equal(wrong[0].wrong, 2);
});

test('删除词库会一起清掉复习排期', () => {
  const store = tempStore();
  const result = store.importEntries(null, '临时词库', [{ word: 'omega', pos: 'n.', meaning: '欧米伽' }]);
  const word = store.words(result.bookId)[0];
  store.recordAnswer(word.id, 'en_zh', true);
  assert.ok(store.db.review.some((r) => r.wordId === word.id));

  store.deleteBook(result.bookId);
  assert.ok(!store.db.review.some((r) => r.wordId === word.id));
});
