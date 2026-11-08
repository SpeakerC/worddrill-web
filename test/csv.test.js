import { test } from 'node:test';
import assert from 'node:assert';

import { mistakesCsv, csvFileName, CSV_BOM } from '../public/js/csv.js';

const ITEMS = [
  { word: { word: 'abandon', pos: 'v.', meaning: '抛弃，舍弃' }, wrong: 3, streak: 1 },
  { word: { word: 'benefit', pos: 'n.', meaning: '益处；好处' }, wrong: 1, streak: 0 },
  { word: { word: 'catch', pos: 'v.', meaning: '抓住' }, wrong: 0, streak: 0 },
];

test('复习版：英汉对照，带表头和复习提示', () => {
  const csv = mistakesCsv(ITEMS, { kind: 'review' });
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 4, '表头 + 3 行');
  assert.equal(lines[0], '英文,词性,中文释义,复习提示');
  assert.ok(lines[1].startsWith('abandon,v.,'), '英文和词性在前');
  assert.ok(lines[1].includes('抛弃，舍弃'), '中文释义保留');
  assert.ok(lines[1].includes('错 3 次'));
  assert.ok(lines[1].includes('已连对 1 次'));
});

test('复习版：没有错次时复习提示为空', () => {
  const csv = mistakesCsv([ITEMS[2]], { kind: 'review' });
  const line = csv.split('\r\n')[1];
  assert.equal(line, 'catch,v.,抓住,');
});

test('练习版留英文：只有一列', () => {
  const csv = mistakesCsv(ITEMS, { kind: 'practice', keep: 'en' });
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '英文');
  assert.deepEqual(lines.slice(1), ['abandon', 'benefit', 'catch']);
});

test('练习版留中文：只有一列，不出现英文', () => {
  const csv = mistakesCsv(ITEMS, { kind: 'practice', keep: 'zh' });
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '中文释义');
  assert.deepEqual(lines.slice(1), ['抛弃，舍弃', '益处；好处', '抓住']);
  assert.ok(!csv.includes('abandon'), '不该有英文');
});

test('练习版留中文：跳过的空释义不产生空行', () => {
  const csv = mistakesCsv([{ word: { word: 'x', meaning: '' } }], { kind: 'practice', keep: 'zh' });
  assert.equal(csv, '中文释义');
});

test('含逗号、引号的字段会被正确转义', () => {
  const csv = mistakesCsv([
    { word: { word: 'say "hi"', pos: 'v.', meaning: 'a,b' }, wrong: 1 },
  ], { kind: 'review' });
  const line = csv.split('\r\n')[1];
  assert.ok(line.includes('"say ""hi"""'), `引号应翻倍：${line}`);
  assert.ok(line.includes('"a,b"'), `逗号字段应加引号：${line}`);
});

test('空列表只有表头', () => {
  assert.equal(mistakesCsv([], { kind: 'review' }), '英文,词性,中文释义,复习提示');
  assert.equal(mistakesCsv([], { kind: 'practice', keep: 'en' }), '英文');
});

test('默认参数走复习版', () => {
  assert.equal(mistakesCsv(ITEMS).split('\r\n')[0], '英文,词性,中文释义,复习提示');
});

test('文件名区分版本', () => {
  const d = new Date(2026, 10, 8);
  assert.equal(csvFileName('review', 'en', d), '错题-复习版-20261108.csv');
  assert.equal(csvFileName('practice', 'en', d), '错题-练习版-英文-20261108.csv');
  assert.equal(csvFileName('practice', 'zh', d), '错题-练习版-中文-20261108.csv');
});

test('BOM 存在，避免 Excel 中文乱码', () => {
  assert.equal(CSV_BOM, '\uFEFF');
});
