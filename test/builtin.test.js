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

test('下架词库会连同单词、错题、练习记录、复习排期一起删掉', () => {
  const store = new Store();
  store.applyBuiltins(V2, 2);

  const bBook = store.books().find((b) => b.name === '词库 B');
  const gamma = store.words(bBook.id)[0];
  store.recordAnswer(gamma.id, 'en_zh', false);
  store.setStar(gamma.id, true);
  assert.equal(store.db.mistakes.length, 1);
  assert.equal(store.db.review.length, 1);

  const removed = store.removeBuiltins(['b']);
  assert.deepEqual(removed, ['词库 B']);
  assert.deepEqual(store.books().map((b) => b.name), ['词库 A']);
  assert.equal(store.db.words.length, A.length, '只留词库 A 的词');
  assert.equal(store.db.mistakes.length, 0, '错题一起清掉');
  assert.equal(store.db.practiceLog.length, 0, '练习记录一起清掉');
  assert.equal(store.db.review.length, 0, '复习排期一起清掉');
});

test('下架不会误删用户自建的同名词库', () => {
  const store = new Store();
  store.applyBuiltins(V2, 2);
  store.importEntries(null, '词库 B', C); // 用户自建，恰好同名，没有 seedId

  const removed = store.removeBuiltins(['b']);
  assert.deepEqual(removed, ['词库 B']);
  const left = store.books().map((b) => `${b.name}:${b.builtin}`);
  assert.deepEqual(left.sort(), ['词库 A:true', '词库 B:false'], '用户那本还在');
});

test('syncBuiltins：补新增、删下架，其余词库原样不动', () => {
  const store = new Store();
  store.applyBuiltins(V2, 2);            // A、B
  const aBook = store.books().find((b) => b.name === '词库 A');
  const alpha = store.words(aBook.id)[0];
  store.recordAnswer(alpha.id, 'en_zh', true);
  const beforeWords = store.db.words.length;

  // 新版清单：保留 A，B 下架，新增 C
  const next = [V1[0], { seedId: 'c', name: '词库 C', entries: C }];
  const result = store.syncBuiltins(next, 3, ['b']);

  assert.deepEqual(result.added, ['词库 C']);
  assert.deepEqual(result.removed, ['词库 B']);
  assert.equal(result.version, 3);
  assert.deepEqual(store.books().map((b) => b.name).sort(), ['词库 A', '词库 C']);
  assert.equal(store.db.words.length, beforeWords - B.length + C.length);
  // A 的练习记录不受影响
  assert.equal(store.db.words.find((w) => w.id === alpha.id) !== undefined, true);
  assert.equal(store.stats(aBook.id).practiced, 1);
  assert.equal(store.db.practiceLog.length, 1);
});

test('再次 sync 同一份清单不会重复建库，也不会重建已删掉的词库', () => {
  const store = new Store();
  const next = [V1[0], { seedId: 'c', name: '词库 C', entries: C }];
  store.syncBuiltins(next, 3, ['b']);
  const count = store.books().length;

  const again = store.syncBuiltins(next, 3, ['b']);
  assert.deepEqual(again.added, []);
  assert.deepEqual(again.removed, []);
  assert.equal(store.books().length, count, '不该重复建库');
  assert.equal(store.hasSeed('b'), false, '下架的 B 不该被重新种回来');
});

/* ---------- 早期版本没有 seedId 的老数据 ---------- */

/** 模拟 web-1.3 及以前种下的内置词库：builtin 为 true，但没有 seedId。 */
function legacyBook(store, entries, name) {
  const now = Date.now() - 100000;
  const book = { id: store.db.nextBookId++, name, builtin: true, createdAt: now };
  store.db.books.push(book);
  entries.forEach((entry, i) => {
    store.db.words.push({
      id: store.db.nextWordId++, bookId: book.id, ord: i + 1, word: entry.w,
      pos: entry.pos || '', meaning: entry.m, starred: false, blocked: false, createdAt: now,
    });
  });
  return book;
}

test('没有 seedId 的老词库能被认出来，不会重复种一本', () => {
  const store = new Store();
  const legacy = legacyBook(store, A, '词库 A');
  assert.equal(store.hasSeed('a', '词库 A'), true, '按名字应认得出这本老词库');

  const result = store.applyBuiltins(V1, 1);
  assert.deepEqual(result.added, [], '不该重复种');
  assert.equal(store.books().length, 1, '仍然只有一本');
  assert.equal(store.db.words.length, A.length, '单词没翻倍');
  // 顺手补上了 seedId
  assert.equal(store.db.books.find((b) => b.id === legacy.id).seedId, 'a');
});

test('老用户曾出现两个同名「高中 3500 词」：升级后合并成一本，进度归最早那本', () => {
  const store = new Store();
  const first = legacyBook(store, A, '词库 A');      // 老的那本，有练习记录
  const alpha = store.words(first.id)[0];
  store.recordAnswer(alpha.id, 'en_zh', false);
  store.setStar(alpha.id, true);

  // 旧 bug 又种出来的那本（同样没有 seedId 或带 seedId 都算重复）
  const dupe = legacyBook(store, A, '词库 A');
  const dupeWord = store.words(dupe.id)[0];
  store.recordAnswer(dupeWord.id, 'en_zh', false);

  assert.equal(store.books().length, 2, '前提：确实有两本同名词库');

  const result = store.applyBuiltins(V1, 1);
  assert.deepEqual(result.added, [], '不该再种');
  assert.equal(store.books().length, 1, '合并成一本');
  const left = store.db.books[0];
  assert.equal(left.id, first.id, '保留最早那本');
  assert.equal(left.seedId, 'a', '并补上 seedId');
  assert.equal(store.db.words.length, A.length, '单词不重复');
  // 最早那本的进度还在
  assert.equal(store.db.words.find((w) => w.id === alpha.id).starred, true);
  assert.equal(store.stats(first.id).practiced, 1);
  // 重复那本的记录被清掉，不留下悬空引用
  const dupeIds = new Set([dupeWord.id]);
  assert.equal(store.db.practiceLog.filter((p) => dupeIds.has(p.wordId)).length, 0);
  assert.equal(store.db.mistakes.filter((m) => dupeIds.has(m.wordId)).length, 0);
});

test('syncBuiltins 会把合并掉的重复词库计入 merged', () => {
  const store = new Store();
  legacyBook(store, A, '词库 A');
  legacyBook(store, A, '词库 A');
  const result = store.syncBuiltins(V1, 1, []);
  assert.deepEqual(result.added, []);
  assert.equal(result.merged, 1, '合并掉 1 本重复');
  assert.equal(store.books().length, 1);
});

test('用户自建的同名词库不会被当成内置词库合并掉', () => {
  const store = new Store();
  legacyBook(store, A, '词库 A');
  store.importEntries(null, '词库 A', C); // 用户自建，builtin = false

  store.applyBuiltins(V1, 1);
  const builtin = store.books().filter((b) => b.builtin);
  const custom = store.books().filter((b) => !b.builtin);
  assert.equal(builtin.length, 1, '内置只有一本');
  assert.equal(custom.length, 1, '用户那本必须保留');
});

test('dedupeBuiltins 不依赖清单版本，能修好已经在最新版本上的用户', () => {
  const store = new Store();
  // 已经是 seedVersion=3 的用户，但仍然有两本「高中 3500 词」：
  // 一本是老的无 seedId，一本是带 seedId 的重复
  const legacy = legacyBook(store, A, '高中 3500 词');
  const dupeId = store.db.nextBookId++;
  store.db.books.push({ id: dupeId, name: '高中 3500 词', builtin: true, seedId: 'senior-3500', createdAt: Date.now() });
  store.db.words.push({
    id: store.db.nextWordId++, bookId: dupeId, ord: 1, word: 'alpha',
    pos: 'n.', meaning: '甲', starred: false, blocked: false, createdAt: Date.now(),
  });
  store.db.seedVersion = 3;
  assert.equal(store.books().filter((b) => b.name === '高中 3500 词').length, 2);

  const { merged } = store.dedupeBuiltins();
  assert.equal(merged, 1);
  const left = store.db.books.filter((b) => b.builtin);
  assert.equal(left.length, 1);
  assert.equal(left[0].id, legacy.id, '保留最早那本');
  assert.equal(left[0].seedId, 'senior-3500', '从重复那本继承 seedId');
  assert.equal(store.db.words.length, A.length, '重复那本的单词删掉');

  // 再跑一次没东西可合并
  assert.equal(store.dedupeBuiltins().merged, 0);
});

test('dedupeBuiltins 不碰用户自建词库和不同 seedId 的内置词库', () => {
  const store = new Store();
  legacyBook(store, A, '词库 A');
  legacyBook(store, B, '词库 B');       // 不同名字、不同 seedId 的来源
  store.importEntries(null, '词库 A', C); // 用户自建，与内置同名

  const { merged } = store.dedupeBuiltins();
  assert.equal(merged, 0, '没有重复可合并');
  assert.equal(store.books().filter((b) => b.builtin).length, 2, '两本内置都在');
  assert.equal(store.books().filter((b) => !b.builtin).length, 1, '用户词库还在');
});
