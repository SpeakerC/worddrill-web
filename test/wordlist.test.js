import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 内置词表的结构校验。
 * 数据修复脚本：scripts/repair-words3500.mjs
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const ASSETS = path.join(ROOT, 'public', 'assets');

const readBook = (file) => JSON.parse(fs.readFileSync(path.join(ASSETS, file), 'utf8'));

const POS = '(?:n|v|a|ad|adv|vt|vi|prep|conj|pron|art|num|int|aux|modal)';
const MERGED_TAIL = new RegExp(`([A-Za-z][A-Za-z'’-]{1,})(?:\\s*[（(][^）)]{0,24}[）)])?\\s+${POS}\\.`);
const POS_PREFIX = new RegExp(`^${POS}\\.?\\s`);
const LATIN = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.\-/&\s]*$/;
const IPA = /[ˈˌəɔɪʊʃʒθðŋæɑɜːɒʌ]/;
const FORBIDDEN = /[*[\]{}<>\\|+=^%$#@!?;:",`~]/;
const PRIVATE = /[\uE000-\uF8FF\u200B-\u200D\uFEFF]/;
const POS_FORMAT = /^[a-z.&/ ]*$/;

const BOOKS = [
  { name: '高中 3500 词', file: 'words3500.json', min: 3500 },
  { name: '大学英语四级', file: 'words-cet4.json', min: 4500 },
];

function audit(list) {
  const bad = [];
  for (const [i, entry] of list.entries()) {
    const w = String(entry.w ?? '');
    const m = String(entry.m ?? '');
    const pos = String(entry.pos ?? '');
    const issues = [];
    if (!w) issues.push('空词头');
    if (w !== w.trim() || / {2,}/.test(w)) issues.push('空格不规范');
    if (!LATIN.test(w)) issues.push('词头含非法字符');
    if (FORBIDDEN.test(w)) issues.push('词头含括号/星号/标点');
    if (IPA.test(`${w}${m}`)) issues.push('音标残留');
    if (PRIVATE.test(`${w}${pos}${m}`)) issues.push('私用区字符');
    if (!m.trim()) issues.push('空释义');
    if (/[\n|]/.test(m)) issues.push('释义含换行或竖线');
    if (MERGED_TAIL.test(m)) issues.push('释义吞掉下一条');
    if (POS_PREFIX.test(m.trim())) issues.push('释义以词性开头');
    if (!POS_FORMAT.test(pos)) issues.push('词性格式');
    if (issues.length) bad.push({ line: i + 1, w, m: m.slice(0, 60), issues });
  }
  return bad;
}

for (const book of BOOKS) {
  test(`${book.name}：词表结构干净`, () => {
    const list = readBook(book.file);
    assert.ok(list.length >= book.min, `${book.name}只有 ${list.length} 条，少于 ${book.min}`);
    const bad = audit(list);
    const detail = bad
      .slice(0, 20)
      .map((b) => `第 ${b.line} 条 ${b.w}：${b.issues.join(' / ')} ｜ ${b.m}`)
      .join('\n');
    assert.deepEqual(bad, [], `${book.name}有 ${bad.length} 条坏数据：\n${detail}`);
  });

  test(`${book.name}：没有重复词条`, () => {
    const list = readBook(book.file);
    const exact = new Set();
    const lower = new Map();
    const problems = [];
    // May（月份）/ may（情态动词）是合法的同形不同词，只允许这一组大小写重复
    const allowedCasePairs = new Set(['may']);
    for (const [i, entry] of list.entries()) {
      const w = String(entry.w);
      if (exact.has(w)) problems.push(`第 ${i + 1} 条 ${w}：完全重复`);
      exact.add(w);
      const key = w.toLowerCase();
      if (lower.has(key) && lower.get(key) !== w && !allowedCasePairs.has(key)) {
        problems.push(`第 ${i + 1} 条 ${w}：与 ${lower.get(key)} 只差大小写`);
      } else if (!lower.has(key)) {
        lower.set(key, w);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });
}

test('高中 3500：之前吞词/坏词头都已修好', () => {
  const list = readBook('words3500.json');
  const words = new Set(list.map((e) => e.w));
  const shouldExist = [
    'sort', 'best', 'better', 'body', 'child', 'man', 'woman', 'sheep', 'tooth',
    'theatre', 'thief', 'honour', 'much', 'more', 'most', 'less', 'policeman',
    'policewoman', 'foot', 'leaf', 'life', 'mouse', 'smell', 'wolf',
  ];
  const missing = shouldExist.filter((w) => !words.has(w));
  assert.deepEqual(missing, [], `仍然缺词：${missing.join(', ')}`);

  const shouldNotExist = ['v]', 'afte', 'cance', 'energ', 'federa', 'kilometr', 'woo',
    'shyv', 'spaghettiv', 'tiresomev', 'commericia', 'soft sɔft;', 'ad.', 'does doesnˈt',
    'Egypt*', 'England*', 'Europe*', 'France*', 'Oceania*', 'Spain*'];
  const leftovers = shouldNotExist.filter((w) => words.has(w));
  assert.deepEqual(leftovers, [], `仍有坏词头：${leftovers.join(', ')}`);

  const sort = list.find((e) => e.w === 'sort');
  assert.deepEqual(sort, { w: 'sort', pos: 'v.&n.', m: '把…分类，拣选；种类，类别' });
});