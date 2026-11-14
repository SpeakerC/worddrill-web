/**
 * 把 Android 内置词表里的例句（ex = "英文||中文"）合并进 Web 的两本词表。
 *
 * Web 词表是修过坏词头的版本，Android 还是原始版本，所以按小写词头匹配；
 * Android 里少数坏词头用 WORD_RENAMES 的旧名兜底（v] → sort、afte → after）。
 *
 * 用法：
 *   node scripts/merge-builtin-examples.mjs
 *   WORDDRILL_ANDROID_ASSETS=../WordDrill/app/src/main/assets node scripts/merge-builtin-examples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = process.env.WORDDRILL_ANDROID_ASSETS
  || path.join(ROOT, '..', 'WordDrill', 'app', 'src', 'main', 'assets');
const TAG = process.env.WORDDRILL_ANDROID_TAG || 'v1.6.0';
const REPO = path.resolve(SOURCE, '..', '..', '..', '..');

const FILES = [
  { web: 'words3500.json', android: 'words3500.json' },
  { web: 'words-cet4.json', android: 'words_cet4.json' },
];

/** 旧坏词头 → 修好后的词头；与 public/js/repo.js 的 WORD_RENAMES 保持一致。 */
const ALIASES = {
  'v]': 'sort',
  afte: 'after',
  cance: 'cancer',
  energ: 'energy',
  federa: 'federal',
  kilometr: 'kilometre',
  woo: 'wool',
  shyv: 'shy',
  spaghettiv: 'spaghetti',
  tiresomev: 'tiresome',
  'roller skatingn': 'roller skating',
  commericia: 'commercial',
  Tibeta: 'Tibetan',
  'ad.': 'either',
  'does doesnˈt': 'does',
  'oˈclock': "o'clock",
  'soft sɔft;': 'soft',
  'turning n': 'turning',
  'department -store': 'department store',
  'English -speaking': 'English-speaking',
  'waiting -room': 'waiting room',
  'washing -machine': 'washing machine',
  'zebra -crossing': 'zebra crossing',
  'pencil- sharpener': 'pencil sharpener',
  'best--seller': 'best-seller',
  'spoken man/ woman': 'spokesman / spokeswoman',
  'statesman/ woman': 'statesman / stateswoman',
  'telephone-booth / telephone-box': 'telephone booth / telephone box',
  'p.m./pm, P.M. /PM': 'p.m.',
  'could modal': 'could',
  'may modal': 'may',
  'must modal': 'must',
};

const ALIAS_BY_LOWER = new Map(
  Object.entries(ALIASES).map(([from, to]) => [from.toLowerCase(), to]),
);

function splitExample(raw) {
  const text = String(raw || '').trim();
  if (!text) return { exampleEn: '', exampleZh: '' };
  const at = text.indexOf('||');
  if (at < 0) return { exampleEn: text, exampleZh: '' };
  return {
    exampleEn: text.slice(0, at).trim(),
    exampleZh: text.slice(at + 2).trim(),
  };
}

/** 优先读工作区文件；没有就从事先 fetch 的 tag 里取（Android 工作区可能落后）。 */
function readAndroid(file) {
  const disk = path.join(SOURCE, file);
  if (fs.existsSync(disk)) {
    const parsed = JSON.parse(fs.readFileSync(disk, 'utf8'));
    if (parsed.some((entry) => entry.ex)) return parsed;
  }
  try {
    const raw = execFileSync(
      'git',
      ['-C', REPO, 'show', `${TAG}:app/src/main/assets/${file}`],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`读不到 Android 词表 ${file}（${TAG}）：${err.message}`);
  }
}

function run() {
  for (const item of FILES) {
    const webPath = path.join(ROOT, 'public', 'assets', item.web);
    const web = JSON.parse(fs.readFileSync(webPath, 'utf8'));
    const android = readAndroid(item.android);
    const byWord = new Map();
    for (const entry of android) {
      const key = String(entry.w || '').toLowerCase();
      if (!key || byWord.has(key) || !entry.ex) continue;
      byWord.set(key, entry.ex);
    }

    let added = 0;
    let withZh = 0;
    for (const entry of web) {
      const key = String(entry.w || '').toLowerCase();
      const raw = byWord.get(key) || byWord.get(String(ALIAS_BY_LOWER.get(key) || '').toLowerCase());
      if (!raw) continue;
      const { exampleEn, exampleZh } = splitExample(raw);
      if (!exampleEn) continue;
      entry.exampleEn = exampleEn;
      entry.exampleZh = exampleZh;
      if (exampleZh) withZh += 1;
      added += 1;
    }
    fs.writeFileSync(webPath, `${JSON.stringify(web)}\n`);
    const pct = ((added / web.length) * 100).toFixed(1);
    console.log(`${item.web}：${web.length} 词，有例句 ${added}（${pct}%），带中文 ${withZh}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();