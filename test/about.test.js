import { test } from 'node:test';
import assert from 'node:assert';

import { parseAbout, richText, escapeHtml } from '../public/js/about.js';

test('about.txt 按字段解析，缩进行接到上一条', () => {
  const info = parseAbout([
    '# 注释',
    '名称 = 单词练习',
    '版本 = 1.2.3',
    '简介 = 第一行',
    '       第二行',
    '信息 = 词库 | 内置 3500 词',
    '备注 = 仅供学习',
  ].join('\n'));
  assert.equal(info.name, '单词练习');
  assert.equal(info.version, '1.2.3');
  assert.equal(info.summary, '第一行\n第二行');
  assert.deepEqual(info.rows, [{ label: '词库', value: '内置 3500 词' }]);
  assert.equal(info.note, '仅供学习');
});

test('备注里的 Markdown 链接会变成可点的链接', () => {
  const html = richText('[开放源代码许可](https://github.com/SpeakerC/worddrill-web/blob/main/LICENSE) 仅供学习');
  assert.ok(html.includes('<a href="https://github.com/SpeakerC/worddrill-web/blob/main/LICENSE"'));
  assert.ok(html.includes('>开放源代码许可</a>'));
  assert.ok(html.includes(' rel="noopener noreferrer"'));
  assert.ok(html.endsWith(' 仅供学习'));
});

test('备注里直接写 <a> 标签也能变成链接（兼容两种写法）', () => {
  const html = richText('<a href="https://example.com/LICENSE" target="_blank">许可</a> 其余文字');
  assert.ok(html.includes('<a href="https://example.com/LICENSE"'));
  assert.ok(html.includes('>许可</a>'));
  assert.ok(!html.includes('&lt;a'));
});

test('普通文字里的尖括号、引号都被转义，不会当作 HTML 执行', () => {
  const html = richText('<script>alert(1)</script> 与 "引号"');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&quot;引号&quot;'));
});

test('只认 http/https，javascript: 之类的写法原样转义', () => {
  const html = richText('[点我](javascript:alert(1))');
  assert.equal(html, '[点我](javascript:alert(1))');
  assert.ok(!html.includes('<a '));
});

test('escapeHtml 覆盖五个特殊字符', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});
