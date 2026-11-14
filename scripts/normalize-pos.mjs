/**
 * 统一两本内置词表的词性写法：形容词 a. → adj.，副词 ad. → adv.，
 * 其余词性也统一成「小写缩写 + 点」并用 & 连接；同时处理四级词表里
 * `n & v.`、`vt&vi&n.` 这类缺点的旧写法。
 *
 * 用法：node scripts/normalize-pos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES = [
  path.join(ROOT, 'public', 'assets', 'words3500.json'),
  path.join(ROOT, 'public', 'assets', 'words-cet4.json'),
];

export const POS_UNITS = {
  a: 'adj',
  adj: 'adj',
  ad: 'adv',
  adv: 'adv',
  n: 'n',
  v: 'v',
  vt: 'vt',
  vi: 'vi',
  prep: 'prep',
  conj: 'conj',
  pron: 'pron',
  num: 'num',
  art: 'art',
  int: 'int',
  interj: 'int',
  interjection: 'int',
  aux: 'aux',
  modal: 'modal v',
};

/** 把一条词性字符串写成统一形式；空串原样返回。 */
export function normalizePos(pos) {
  const text = String(pos || '').trim();
  if (!text) return '';
  if (/^modal\s+v\.?$/i.test(text)) return 'modal v.';

  const units = [];
  const seen = new Set();
  for (const raw of text.split(/[&/,]/)) {
    const key = raw.trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
    if (!key) continue;
    const unit = POS_UNITS[key];
    if (!unit) throw new Error(`未识别的词性：${JSON.stringify(pos)}（${key}）`);
    if (seen.has(unit)) continue;
    seen.add(unit);
    units.push(unit);
  }
  if (!units.length) return '';
  return units.map((unit) => `${unit}.`).join('&');
}

/** 少数词条的词性写在释义里（pos 为空），这里把可见的 a./ad. 也统一掉。 */
export function normalizeMeaning(meaning) {
  return String(meaning || '')
    .replace(/(^|[\s,，;；/])a\./g, '$1adj.')
    .replace(/(^|[\s,，;；/])ad\./g, '$1adv.')
    .replace(/\bvnum\./gi, 'num.');
}

function run() {
  for (const file of FILES) {
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    let changed = 0;
    for (const entry of entries) {
      const next = normalizePos(entry.pos);
      const meaning = normalizeMeaning(entry.m);
      if (next !== entry.pos || meaning !== entry.m) {
        entry.pos = next;
        entry.m = meaning;
        changed += 1;
      }
    }
    fs.writeFileSync(file, `${JSON.stringify(entries)}\n`);
    console.log(`${path.basename(file)}：${entries.length} 条，改写 ${changed} 条`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();