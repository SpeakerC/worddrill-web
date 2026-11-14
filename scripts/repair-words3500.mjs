/**
 * 一次性修复内置「高中 3500」词表。
 *
 * - 把释义里吞进来的下一条拆出来，补回缺失词（best / body / child / man / woman …）；
 * - 修正坏词头（v] → sort、afte → after、soft sɔft; → soft …）、词性/释义前缀残留、
 *   星号、音标、双连字符和连字符两侧空格；
 * - 已修好的数据不会被再次拆分，脚本可以重复执行。
 *
 * 用法：node scripts/repair-words3500.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'public', 'assets', 'words3500.json');
const OUT = SRC;
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const POS_UNIT = '(?:adv|modal|prep|conj|pron|art|num|int|aux|vt|vi|ad|n|v|a)';
const POS_SEQ = `${POS_UNIT}\\.?(?:\\s*(?:&|/|,)\\s*${POS_UNIT}\\.?)*`;
const posRe = new RegExp(`^\\s*(${POS_SEQ})\\s*`);
const mergeRe = new RegExp(`([A-Za-z][A-Za-z'’-]{1,})(?:\\s*[（(][^）)]{0,24}[）)])?\\s+${POS_UNIT}\\.`, 'g');
const META = new Set(['modal', 'nations', 'kingdom', 'america', 'television']);

const heads = new Set(raw.map((e) => normKey(e.w)));
const missing = new Set();
raw.forEach((e) => {
  mergeRe.lastIndex = 0;
  let m;
  while ((m = mergeRe.exec(String(e.m))) !== null) {
    const w = m[1].toLowerCase();
    if (['a', 'an', 'the'].includes(w)) continue;
    if (!heads.has(normKey(w)) && !META.has(w)) missing.add(w);
  }
});
const TAIL_WORDS = [...missing, ...META].sort((a, b) => b.length - a.length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tailRe = new RegExp(`(?:^|[\\s，。；、\\u4e00-\\u9fa5])(${TAIL_WORDS.map(esc).join('|')})(?=\\s|[（(])`, 'i');

function normKey(w) {
  return String(w).toLowerCase().replace(/\*/g, '').replace(/[ˈˌ]/g, "'").replace(/\s+/g, ' ').trim();
}

function normPos(pos) {
  const text = String(pos || '').trim();
  if (!text) return '';
  if (/^modal v\.?$/i.test(text)) return 'modal v.';
  return text
    .split(/[&/]/)
    .map((p) => p.trim().replace(/\.$/, ''))
    .filter(Boolean)
    .map((p) => `${p.toLowerCase()}.`)
    .join('&');
}

function trimMeaning(text) {
  return String(text || '')
    .replace(/[\u00A0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s,，;；、]+$/g, '')
    .trim();
}

function parseTail(tail, word) {
  let rest = tail.slice(word.length).trim();
  let paren = '';
  const pm = /^[（(][^）)]*[）)]/.exec(rest);
  if (pm) { paren = pm[0]; rest = rest.slice(pm[0].length).trim(); }
  let alias = '';
  const am = /^=\s*([^ ]+)\s*/.exec(rest);
  if (am) { alias = am[1]; rest = rest.slice(am[0].length).trim(); }
  const pm2 = posRe.exec(rest);
  const pos = pm2 ? normPos(pm2[1]) : '';
  const meaning = pm2 ? rest.slice(pm2[0].length).trim() : rest;
  return {
    w: word,
    pos,
    m: trimMeaning(`${paren ? `${paren} ` : ''}${meaning}`),
    alias,
  };
}

function splitEntry(entry) {
  const m = String(entry.m);
  const hit = tailRe.exec(m);
  if (!hit) return null;
  const word = hit[1];
  if (!missing.has(word.toLowerCase()) && !META.has(word.toLowerCase())) return null;
  const start = hit.index + (m[hit.index] === ' ' ? 1 : 0);
  const keep = trimMeaning(m.slice(0, start));
  if (!keep) return null;

  const added = [];
  let parsed = parseTail(m.slice(start).trim(), word);
  added.push(parsed);
  let guard = 0;
  while (guard < 3) {
    guard += 1;
    const next = tailRe.exec(parsed.m);
    if (!next) break;
    const nextWord = next[1];
    if (!missing.has(nextWord.toLowerCase())) break;
    const idx = next.index + (parsed.m[next.index] === ' ' ? 1 : 0);
    const head = parsed.m.slice(idx).trim();
    parsed.m = trimMeaning(parsed.m.slice(0, idx));
    const sub = parseTail(head, nextWord);
    added.push(sub);
    parsed = sub;
  }
  return {
    a: { w: entry.w, pos: entry.pos, m: keep },
    added: added.map((x) => ({ w: x.w, pos: x.pos, m: x.m })),
  };
}

// 需要人工拆的行（缩写、词性、变体）
const OVERRIDES = {
  lab: {
    a: { w: 'lab', pos: 'n.', m: '实验室（= laboratory）' },
    added: [{ w: 'labour', pos: 'n.', m: '劳动' }],
  },
  mixture: {
    a: { w: 'mixture', pos: 'n.', m: '混合物' },
    added: [{ w: 'mm', pos: 'n.', m: '毫米（= millimetre）' }],
  },
  police: {
    a: { w: 'police', pos: 'n.', m: '警察，警务人员' },
    added: [
      { w: 'policeman', pos: 'n.', m: '警察，巡警' },
      { w: 'policewoman', pos: 'n.', m: '女警察' },
    ],
  },
  tiny: {
    a: { w: 'tiny', pos: 'adj.', m: '极小的，微小的' },
    added: [],
  },
  tutor: {
    a: { w: 'tutor', pos: 'n.', m: '家庭教师，私人教师，导师' },
    added: [{ w: 'TV', pos: 'n.', m: '电视机（= television）' }],
  },
  ugly: {
    a: { w: 'ugly', pos: 'a.', m: '丑陋的；难看的' },
    added: [{ w: 'UK', pos: 'n.', m: '英国（= United Kingdom）' }],
  },
  umbrella: {
    a: { w: 'umbrella', pos: 'n.', m: '雨伞' },
    added: [{ w: 'UN', pos: 'n.', m: '联合国（= the United Nations）' }],
  },
  urgent: {
    a: { w: 'urgent', pos: 'a.', m: '紧急的，紧迫的' },
    added: [{ w: 'USA', pos: 'n.', m: '美国（= the United States of America）' }],
  },
  would: {
    a: { w: 'would', pos: 'modal v.', m: '（will 的过去时）将会，打算，想要，过去常常' },
    added: [],
  },
  no: {
    a: { w: 'no', pos: 'ad.&a.', m: '不，不是；没有，无' },
    added: [],
  },
  either: {
    a: { w: 'either', pos: 'a.&conj.&ad.', m: '两方任一方的；二者之一；要么……；(用于否定句或短语后)也' },
    added: [],
  },
  'Hong Kong': {
    a: { w: 'Hong Kong', pos: 'n.', m: '香港' },
    added: [{ w: 'honour', pos: 'n.&vt.', m: '荣誉，光荣；尊敬，给予荣誉' }],
  },
  'pencil- sharpener': {
    a: { w: 'pencil sharpener', pos: 'n.', m: '转笔刀' },
    added: [{ w: 'shave', pos: 'v.', m: '刮（脸，胡子）' }],
  },
  'best--seller': {
    a: { w: 'best-seller', pos: 'n.', m: '畅销书' },
    added: null, // 用默认拆出的 better
  },
  dozen: {
    a: { w: 'dozen', pos: 'n.', m: '十二个；几十，许多' },
    added: [{ w: 'Dr', pos: 'n.', m: '医生，大夫；博士（= Doctor）' }],
  },
  eyewitness: {
    a: { w: 'eyewitness', pos: 'n.', m: '目击证人' },
    added: [],
  },
  handy: {
    a: { w: 'handy', pos: 'a.', m: '便利的，顺手的' },
    added: [],
  },
  shine: {
    a: { w: 'shine', pos: 'n.&v.', m: '光泽；光彩；阳光；晴天；光(亮)；发光；照耀；杰出；擦亮' },
    added: [],
  },
  strike: {
    a: { w: 'strike', pos: 'v.&n.', m: '（钟）鸣；敲（响）；罢工；擦（打）火，侵袭' },
    added: [],
  },
};

// 词头 / 词性/释义残留的直接修正
const FIX = {
  afte: { w: 'after', pos: 'ad.&prep.&conj.', m: '在后；后来；在…之后；在…后面；在…以后' },
  cance: { w: 'cancer', pos: 'n.', m: '癌' },
  energ: { w: 'energy', pos: 'n.', m: '精力，能量' },
  federa: { w: 'federal', pos: 'a.', m: '中央的（政府）联邦的' },
  kilometr: { w: 'kilometre', pos: 'n.', m: '千米（公里）' },
  woo: { w: 'wool', pos: 'n.', m: '羊毛，羊绒' },
  shyv: { w: 'shy', pos: 'a.', m: '害羞的' },
  spaghettiv: { w: 'spaghetti', pos: 'n.', m: '意大利式面条' },
  tiresomev: { w: 'tiresome', pos: 'a.', m: '令人厌倦的' },
  'roller skatingn': { w: 'roller skating', pos: 'n.', m: '滑旱冰' },
  commericia: { w: 'commercial', pos: 'a.', m: '贸易的，商业的' },
  Tibeta: { w: 'Tibetan', pos: 'n.', m: '西藏人；西藏语' },
  'does doesnˈt': { w: 'does', pos: 'v.', m: '动词 do 的第三人称单数现在式' },
  'oˈclock': { w: "o'clock", pos: 'n.', m: '点钟' },
  'soft sɔft;': { w: 'soft', pos: 'a.', m: '软的，柔和的' },
  'v]': { w: 'sort', pos: 'v.&n.', m: '把…分类，拣选；种类，类别' },
  ladder: { w: 'ladder', pos: 'n.', m: '梯子' },
  anyway: { w: 'anyway', pos: 'ad.', m: '不管怎样' },
  publish: { w: 'publish', pos: 'vt.', m: '出版，发行' },
  butcher: { w: 'butcher', pos: 'n.&vt.', m: '肉店；屠夫；屠宰（动物）；残杀（人）' },
  design: { w: 'design', pos: 'n.&vt.', m: '设计，策划；图案，图样，样式' },
  pump: { w: 'pump', pos: 'vt.', m: '用泵抽水' },
  possibility: { w: 'possibility', pos: 'n.', m: '可能，可能性' },
  shirt: { w: 'shirt', pos: 'n.', m: '男衬衫' },
  sport: { w: 'sport', pos: 'n.', m: '体育运动，锻炼；(复，英)运动会' },
  tourist: { w: 'tourist', pos: 'n.', m: '旅行者，观光者' },
  shuttle: { w: 'shuttle', pos: 'n.&v.', m: '合拢；（往返于两个定点之间的）（火车、汽车、飞机）班车/机' },
  very: { w: 'very', pos: 'ad.', m: '很，非常' },
  welcome: { w: 'welcome', pos: 'int.&n.&v.&a.', m: '欢迎；受欢迎的' },
  'turning n': { w: 'turning', pos: 'n.', m: '拐弯处，拐角处' },
  'bus stop': { w: 'bus stop', pos: 'n.', m: '公共汽车站' },
  begin: { w: 'begin', pos: 'v.', m: '开始,着手' },
  catch: { w: 'catch', pos: 'v.', m: '接住；捉住；赶上；染上（疾病）' },
  cage: { w: 'cage', pos: 'n.', m: '笼；鸟笼' },
  chat: { w: 'chat', pos: 'n.&vi.', m: '聊天，闲谈' },
  conservation: { w: 'conservation', pos: 'n.', m: '保存；（自然资源的）保护，管理' },
  crayon: { w: 'crayon', pos: 'n.', m: '蜡笔；蜡笔画' },
  fantasy: { w: 'fantasy', pos: 'n.', m: '幻想，梦想' },
  missile: { w: 'missile', pos: 'n.', m: '导弹' },
  praise: { w: 'praise', pos: 'n.&vt.', m: '赞扬，表扬' },
  might: { w: 'might', pos: 'modal v.', m: '(may 的过去式，助动词) 可能，也许，或许' },
  shall: { w: 'shall', pos: 'modal v.', m: '（表示将来）将要，会；……好吗' },
  should: { w: 'should', pos: 'modal v.', m: '应当，应该，会；（shall 的过去时态）' },
  'could modal': { w: 'could', pos: 'modal v.', m: '（can 的过去式）可以…；（表示许可或请求）可以…，行' },
  'may modal': { w: 'may', pos: 'modal v.', m: '可以；也许，可能' },
  'must modal': { w: 'must', pos: 'modal v.', m: '必须，应当；必定是' },
  'department -store': { w: 'department store', pos: 'n.', m: '百货商场' },
  'English -speaking': { w: 'English-speaking', pos: 'a.', m: '说英语的' },
  'waiting -room': { w: 'waiting room', pos: 'n.', m: '候诊室,候车室' },
  'washing -machine': { w: 'washing machine', pos: 'n.', m: '洗衣机' },
  'zebra -crossing': { w: 'zebra crossing', pos: 'n.', m: '人行横道线（斑马线）' },
  'spoken man/ woman': { w: 'spokesman / spokeswoman', pos: 'n.', m: '发言人' },
  'statesman/ woman': { w: 'statesman / stateswoman', pos: 'n.', m: '政治家' },
  'telephone-booth / telephone-box': { w: 'telephone booth / telephone box', pos: 'n.', m: '公用电话间' },
  'p.m./pm, P.M. /PM': { w: 'p.m.', pos: 'n.', m: '下午，午后（缩写 pm / P.M.）' },
};

const DROP = new Set(['ad.']);

const out = [];
const report = { splitRows: 0, added: 0, fixed: 0, dropped: 0 };

raw.forEach((entry) => {
  const w = String(entry.w);
  if (DROP.has(w)) { report.dropped += 1; return; }

  let a = { w: entry.w, pos: entry.pos, m: entry.m };
  let added = [];

  const ov = OVERRIDES[w];
  if (ov) {
    a = { ...ov.a };
    added = ov.added === null ? null : (ov.added || []);
  }

  if (!ov) {
    const sp = splitEntry(entry);
    if (sp) {
      a = sp.a;
      added = sp.added;
      report.splitRows += 1;
    }
  } else if (added === null) {
    const sp = splitEntry(entry);
    added = sp ? sp.added : [];
    report.splitRows += 1;
  }

  if (FIX[w]) {
    a = { ...FIX[w] };
    report.fixed += 1;
  }

  // A 条清理
  a = {
    w: String(a.w).replace(/\*/g, '').replace(/[ˈˌ]/g, "'").replace(/--+/g, '-').replace(/\s+/g, ' ').trim(),
    pos: normPos(a.pos),
    m: trimMeaning(a.m),
  };
  out.push({ w: a.w, pos: a.pos, m: a.m });

  // 追加条清理
  for (const extra of added || []) {
    const item = {
      w: String(extra.w).replace(/\*/g, '').replace(/[ˈˌ]/g, "'").replace(/--+/g, '-').replace(/\s+/g, ' ').trim(),
      pos: normPos(extra.pos),
      m: trimMeaning(extra.m),
    };
    if (heads.has(normKey(item.w))) {
      // 已有同名词，不重复添加
      report.added += 0;
      continue;
    }
    out.push(item);
    report.added += 1;
  }
});

// 全局机械清理：*、音标撇号、双连字符、空格、私用区字符
const stripJunk = (s) => String(s).replace(/[\uE000-\uF8FF\u200B-\u200D\uFEFF]/g, '');
const cleaned = out.map((e) => ({
  w: stripJunk(e.w).replace(/\*/g, '').replace(/[ˈˌ]/g, "'").replace(/--+/g, '-').replace(/ {2,}/g, ' ').trim(),
  pos: stripJunk(e.pos).trim(),
  m: trimMeaning(stripJunk(e.m)),
}));

fs.writeFileSync(OUT, JSON.stringify(cleaned), 'utf8');

// 体检
const badW = [];
const badM = [];
const seen = new Map();
const dup = [];
const merged = [];
const POS_TEST = new RegExp(`([A-Za-z][A-Za-z'’-]{1,})(?:\\s*[（(][^）)]{0,24}[）)])?\\s+${POS_UNIT}\\.`);
for (const [i, e] of cleaned.entries()) {
  if (!/^[A-Za-z][A-Za-z0-9'’.\-/&\s]*$/.test(e.w) || /[ˈˌəɔɪʊʃʒθðŋæɑɜːɒʌ]/.test(e.w)) badW.push({ i: i + 1, ...e });
  if (!e.m || /[\u0250-\u02ff]/.test(e.m)) badM.push({ i: i + 1, ...e });
  const k = normKey(e.w);
  if (seen.has(k)) dup.push({ i: i + 1, w: e.w, first: seen.get(k) });
  else seen.set(k, i + 1);
  if (POS_TEST.test(e.m)) merged.push({ i: i + 1, w: e.w, m: e.m.slice(0, 60) });
}

console.log('原', raw.length, '→ 新', cleaned.length);
console.log(report);
console.log('坏词形', badW.length, badW.slice(0, 20));
console.log('坏释义', badM.length, badM.slice(0, 10));
console.log('重复词', dup.length, dup);
console.log('残留合并', merged.length, merged.slice(0, 20));
console.log('缺词已补?', [...missing].filter((w) => !cleaned.some((e) => normKey(e.w) === normKey(w))).length, '仍未补');
console.log('新增词数', report.added);