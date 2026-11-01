'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseMarkdown, decodeText } = require('../lib/vocab');

test('解析四列表格，忽略序号列与表头、分隔行', () => {
  const text = [
    '| # | 英文 | 词性 | 汉语 |',
    '|---|------|------|------|',
    '| 1 | pick out | 动词短语 | 精心挑选；认出来 |',
    '| 2 | competence | n. | 能力；胜任 |',
  ].join('\n');
  const entries = parseMarkdown(text);
  assert.deepEqual(entries, [
    { word: 'pick out', pos: '动词短语', meaning: '精心挑选；认出来' },
    { word: 'competence', pos: 'n.', meaning: '能力；胜任' },
  ]);
});

test('三列表格与不带首尾竖线的行都能解析', () => {
  const text = [
    'tricky | adj. | 难对付的，棘手的',
    '| mindset | n. | 思维模式；心态 |',
  ].join('\n');
  const entries = parseMarkdown(text);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].word, 'tricky');
  assert.equal(entries[1].meaning, '思维模式；心态');
});

test('同一个词只保留第一次出现，大小写不敏感', () => {
  const entries = parseMarkdown('| Apple | n. | 苹果 |\n| apple | n. | 苹果（重复） |');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].meaning, '苹果');
});

test('无效行会被忽略', () => {
  const entries = parseMarkdown('普通文字\n\n| 1 | 2 |\n| 123 | abc | n. | 释义 |');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].word, 'abc');
});

test('UTF-8 BOM 与 GB18030 都能解码', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('| word | n. | 词 |', 'utf8')]);
  assert.ok(decodeText(bom).startsWith('| word'));

  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // “中文” 的 GBK 编码
  assert.equal(decodeText(gbk), '中文');
});
