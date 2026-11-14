import { test } from 'node:test';
import assert from 'node:assert';

import { hint, isCorrect, buildItems, OPTION_COUNT, normalize } from '../public/js/quiz.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const words = [
  { id: 1, word: 'apple', pos: 'n.', meaning: '苹果', starred: false },
  { id: 2, word: 'pear', pos: 'n.', meaning: '梨', starred: false },
  { id: 3, word: 'pick out', pos: '', meaning: '挑选', starred: false },
  { id: 4, word: 'lemon', pos: 'n.', meaning: '柠檬', starred: false },
  { id: 5, word: 'grape', pos: 'n.', meaning: '葡萄', starred: false },
];

test('拼写提示：每个单词首字母 + 下划线，空格显示为 /', () => {
  assert.equal(hint('apple'), 'a _ _ _ _');
  assert.equal(hint('pick out'), 'p _ _ _ / o _ _');
  assert.equal(hint('well-known'), 'w _ _ _ - k _ _ _ _');
});

test('拼写判定忽略大小写与多余空格', () => {
  assert.equal(normalize('  Pick   Out '), 'pick out');
  assert.ok(isCorrect('PICK  out', 'pick out'));
  assert.ok(!isCorrect('pickout', 'pick out'));
  assert.ok(!isCorrect('   ', 'pick out'));
});

test('选择题：四个不重复选项，且包含正确答案', () => {
  for (const mode of ['en_zh', 'zh_en']) {
    const items = buildItems(words, words, 3, mode);
    assert.equal(items.length, 3);
    for (const item of items) {
      assert.equal(item.options.length, OPTION_COUNT);
      assert.equal(new Set(item.options).size, OPTION_COUNT);
      assert.ok(item.options.includes(item.answer));
      assert.equal(item.options[item.correctOption], item.answer);
      assert.equal(item.spell, false);
    }
  }
});

test('默写题：有答案与提示，无选项', () => {
  const [item] = buildItems([words[2]], words, 1, 'spell');
  assert.equal(item.answer, 'pick out');
  assert.equal(item.prompt, '挑选');
  assert.equal(item.options.length, 0);
  assert.equal(item.spell, true);
  assert.equal(item.hint, 'p _ _ _ / o _ _');
});

test('选择题：干扰项走混淆算法，同义派生词被排除', () => {
  const pool = [
    { id: 1, word: 'adapt', pos: 'v.', meaning: '适应' },
    { id: 2, word: 'adopt', pos: 'v.', meaning: '采用' },
    { id: 3, word: 'adept', pos: 'a.', meaning: '熟练的' },
    { id: 4, word: 'adaptation', pos: 'n.', meaning: '适应，改编本' },
    { id: 5, word: 'apple', pos: 'n.', meaning: '苹果' },
  ];
  const [en] = buildItems([pool[0]], pool, 1, 'en_zh', seeded(5));
  assert.equal(en.options.length, OPTION_COUNT);
  assert.ok(en.options.includes('v. 适应'));
  assert.ok(!en.options.includes('n. 适应，改编本'), '同义的 adaptation 不能当干扰项');

  const [zh] = buildItems([pool[0]], pool, 1, 'zh_en', seeded(5));
  assert.equal(zh.options.length, OPTION_COUNT);
  assert.ok(zh.options.includes('adapt'));
  assert.ok(!zh.options.includes('adaptation'), '同义的 adaptation 不能当干扰项');
});

test('选择题：干扰项只从本题涉及的词库取', () => {
  const book1 = [
    { id: 1, bookId: 1, word: 'adapt', pos: 'v.', meaning: '适应' },
    { id: 2, bookId: 1, word: 'adopt', pos: 'v.', meaning: '采用' },
    { id: 3, bookId: 1, word: 'adept', pos: 'a.', meaning: '熟练的' },
    { id: 4, bookId: 1, word: 'apple', pos: 'n.', meaning: '苹果' },
  ];
  const book2 = [
    { id: 9, bookId: 2, word: 'adapter', pos: 'n.', meaning: '适配器' },
    { id: 10, bookId: 2, word: 'adeptly', pos: 'ad.', meaning: '熟练地' },
  ];
  const [item] = buildItems([book1[0]], [...book1, ...book2], 1, 'zh_en', seeded(1));
  assert.equal(item.options.length, OPTION_COUNT);
  assert.ok(item.options.includes('adapt'));
  assert.ok(!item.options.includes('adapter'));
  assert.ok(!item.options.includes('adeptly'));
});
