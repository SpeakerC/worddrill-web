import { test } from 'node:test';
import assert from 'node:assert';

import { Store, normalizeDb } from '../public/js/store.js';

const A = [
  { w: 'alpha', pos: 'n.', m: '甲' },
  { w: 'beta', pos: 'n.', m: '乙' },
];
const B = [
  { w: 'gamma', pos: 'n.', m: '丙' },
  { w: 'delta', pos: 'n.', m: '丁' },
];
const C = [{ w: 'omega', pos: 'n.', m: '欧米伽' }];

const V1 = [{ seedId: 'a', name: '词库 A', entries: A }];
const V2 = [...V1, { seedId: 'b', name: '词库 B', entries: B }];
const V3 = [...V2, { seedId: 'c', name: '词库 C', entries: C }];

test('新库默认 seedVersion 为 0', () => {
  assert.equal(new Store().db.seedVersion, 0);
  assert.equal(normalizeDb({}).seedVersion, 0);
  assert.equal(normalizeDb({ seedVersion: 2 }).seedVersion, 2);
});

test('首次播种整份清单，并写入版本号', () => {
  const store = new Store();
  const { added, version } = store.applyBuiltins(V2, 2);
  assert.deepEqual(added, ['词库 A', '词库 B']);
  assert.equal(version, 2);
  assert.equal(store.db.seedVersion, 2);
  assert.deepEqual(store.books().map((b) => b.name).sort(), ['词库 A', '词库 B']);
  assert.equal(store.books().reduce((n, b) => n + b.wordCount, 0), 4);
});

test('重复播种不会重复建库（幂等）', () => {
  const store = new Store();
  store.applyBuiltins(V2, 2);
  const again = store.applyBuiltins(V2, 2);
  assert.deepEqual(again.added, []);
  assert.equal(store.books().length, 2);
  assert.equal(store.db.words.length, 4);
});

test('版本升级只补新增的词库，老词库不动', () => {
  const store = new Store();
  store.applyBuiltins(V2, 2);
  // 用户练了词库 A 的第一个词
  const alpha = store.words(store.books()[0].id)[0];
  store.recordAnswer(alpha.id, 'en_zh', false);
  store.setStar(alpha.id, true);

  const upgrade = store.applyBuiltins(V3, 3);
  assert.deepEqual(upgrade.added, ['词库 C'], '只补第三本');
  assert.equal(upgrade.version, 3);
  assert.equal(store.books().length, 3);
  assert.equal(store.db.words.length, 5, '新词库 1 词 + 原有 4 词');

  // 已有记录、错题、星标都还在
  assert.equal(store.db.mistakes.length, 1);
  assert.equal(store.books().find((b) => b.name === '词库 A').blockedCount, 0);
  assert.equal(store.db.words.find((w) => w.id === alpha.id).starred, true);
  assert.equal(store.stats(store.books()[0].id).practiced, 1);
});

test('hasSeed 只认内置词库，用户自己建的同名词库不算', () => {
  const store = new Store();
  store.applyBuiltins(V1, 1);
  assert.equal(store.hasSeed('a'), true);
  assert.equal(store.hasSeed('b'), false);

  // 用户手动导入一个同名词库
  store.importEntries(null, '词库 B', B);
  assert.equal(store.hasSeed('b'), false, '用户词库没有 seedId，不该挡住内置词库补种');

  const upgrade = store.applyBuiltins(V2, 2);
  assert.deepEqual(upgrade.added, ['词库 B'], '仍然应该补种内置的 B');
  const names = store.books().map((b) => `${b.name}:${b.builtin}`);
  assert.deepEqual(names.sort(), ['词库 A:true', '词库 B:false', '词库 B:true']);
});

test('取不到词表的词库跳过，不影响其他词库与版本推进', () => {
  const store = new Store();
  store.applyBuiltins([
    { seedId: 'a', name: '词库 A', entries: A },
    { seedId: 'b', name: '空词库', entries: [] },
    { seedId: 'c', name: '词库 C', entries: C },
  ], 3);
  assert.equal(store.books().length, 2);
  assert.equal(store.db.seedVersion, 3);
});

test('新增词库在复习与统计里正常参与，但不影响老词库进度', () => {
  const store = new Store();
  store.applyBuiltins(V2, 2);
  const before = store.books().length;
  store.applyBuiltins(V3, 3);
  assert.equal(store.books().length, before + 1);

  const cBook = store.books().find((b) => b.name === '词库 C');
  const omega = store.words(cBook.id)[0];
  store.recordAnswer(omega.id, 'en_zh', true);

  // omega 进了复习范围，且属于新词库
  const due = store.reviewWordCount('all');
  assert.equal(due, 1);
  const list = store.reviewWords(200, 'all');
  assert.equal(list[0].word, 'omega');
  assert.equal(list[0].bookId, cBook.id);
});
