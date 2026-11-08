/**
 * 把 KyleBing/english-vocabulary 的词表转成本项目用的 {w,pos,m} 结构。
 *
 *   源：https://github.com/KyleBing/english-vocabulary （BSD-3-Clause）
 *   输入：json/3-CET4-顺序.json（高中扩展词表已下架，不再构建）
 *   输出：public/assets/words-cet4.json
 *
 * 用法：先把原始 JSON 放到 _src/，再 node scripts/build-builtin-words.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, '_src');
const OUT = path.join(ROOT, 'public', 'assets');

/** 词性归一：源数据里类型很多（adj/n/vt/…），统一成国内词表常见的缩写。 */
const POS_MAP = {
  n: 'n.', v: 'v.', vt: 'vt.', vi: 'vi.', adj: 'a.', adv: 'ad.', a: 'a.', ad: 'ad.',
  prep: 'prep.', conj: 'conj.', pron: 'pron.', num: 'num.', art: 'art.',
  int: 'int.', interj: 'int.', aux: 'aux.', modal: 'modal v.', abbr: 'abbr.',
  phrase: 'phr.', phrasal: 'phr.',
};

function normPos(raw) {
  const key = String(raw || '').trim().toLowerCase().replace(/\.$/, '');
  if (!key) return '';
  return POS_MAP[key] || `${key}.`;
}

/** 去掉中文释义里的首尾空白和源数据里多余的标记。 */
function cleanMeaning(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s;；,，:：]+|[\s;；,，]+$/g, '')
    .trim();
}

/** 一条源记录 → { w, pos, m }，多词性合并成一条。 */
function convert(entry) {
  const word = String(entry.word || '').trim();
  if (!word) return null;
  const parts = [];
  const posSeen = [];
  for (const t of Array.isArray(entry.translations) ? entry.translations : []) {
    const meaning = cleanMeaning(t && t.translation);
    if (!meaning) continue;
    const pos = normPos(t && t.type);
    parts.push(meaning);
    if (pos && !posSeen.includes(pos)) posSeen.push(pos);
  }
  if (!parts.length) return null;
  return { w: word, pos: posSeen.join('&'), m: parts.join('；') };
}

function build(file, target, label) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
  const out = [];
  const seen = new Set();
  let dropped = 0;
  for (const entry of raw) {
    const item = convert(entry);
    if (!item) { dropped += 1; continue; }
    // 同一本词库里按小写去重，保留第一次出现（源数据是「顺序」版，前面的更基础）
    const key = item.w.toLowerCase();
    if (seen.has(key)) { dropped += 1; continue; }
    seen.add(key);
    out.push(item);
  }
  fs.writeFileSync(path.join(OUT, target), JSON.stringify(out), 'utf8');
  const kb = (fs.statSync(path.join(OUT, target)).size / 1024).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(`${label}: ${out.length} 词（跳过 ${dropped}），${kb} KB -> assets/${target}`);
  return out;
}

const cet4 = build('cet4.json', 'words-cet4.json', '大学英语四级');
