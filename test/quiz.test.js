'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { hint, isCorrect, buildItems, OPTION_COUNT, normalize } = require('../lib/quiz');

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
