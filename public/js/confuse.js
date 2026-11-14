/**
 * 干扰项（混淆项）选择，纯函数，浏览器与 Node 共用。
 *
 * 原则：
 *   - 形近词（adapt / adopt / adept）是可以安全使用的干扰项，两种模式都用它；
 *   - 同义词、同释义、释义互相包含的词不能当干扰项，否则会出现两个正确答案；
 *   - 只负责选词，不负责出题和渲染。UI 仍由 quiz.js 组装。
 *
 * 入口：pickDistractors(correct, pool, mode, options)
 *   mode = 'en_zh'（看英选汉）| 'zh_en'（看汉选英）
 */

const POS_UNIT = '(?:adv|modal|prep|conj|pron|art|num|int|aux|vt|vi|ad|n|v|a)';
const IPA = /[ˈˌəɔɪʊʃʒθðŋæɑɜːɒʌɚɝ]/;
const PRIVATE = /[\uE000-\uF8FF\u200B-\u200D\uFEFF]/;
const WORD_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9'’.\-/&\s]*$/;
const BAD_CHARS = /[*[\]{}<>\\|+=^%$#@!?;:",`~]/;
const STOP_CHARS = /[的地得了个些等或与和及]/g;
const PUNCT = /[，。；、：,.!?;:()（）[\]“”"'…·\s]/g;

/* 词表在一轮练习里是固定的，归一化/切词结果缓存起来，避免每题重复算几千次 */
const CACHE_LIMIT = 20000;
const normCache = new Map();
const coreCache = new Map();
const charsCache = new Map();
const bigramsCache = new Map();
const posCache = new Map();

function memo(cache, key, make) {
  if (cache.has(key)) return cache.get(key);
  const value = make();
  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

export const wordOf = (entry) => String((entry && (entry.word ?? entry.w)) || '').trim();
export const meaningOf = (entry) => String((entry && (entry.meaning ?? entry.m)) || '').trim();
export const idOf = (entry) => (entry && entry.id != null ? entry.id : null);

/** 归一化英文词形：大小写、全角、多余空格、星号、音标撇号。 */
export function normalizeWord(word) {
  const key = String(word ?? '');
  return memo(normCache, key, () => key
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[ˈˌ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim());
}

/** 去掉释义里的词性前缀、括号注释、标点和虚词，只留核心汉字/字母。 */
export function coreGloss(meaning) {
  const key = String(meaning ?? '');
  return memo(coreCache, key, () => key
    .normalize('NFKC')
    .replace(new RegExp(`^(?:${POS_UNIT}\\.?(?:\\s*[&/]\\s*${POS_UNIT}\\.?)*)+\\s*`, 'i'), '')
    .replace(/[（(][^）)]{0,80}[）)]/g, '')
    .replace(PUNCT, '')
    .replace(STOP_CHARS, '')
    .trim());
}

/** 释义里所有词性，vt/vi 归到 v，adv/ad 归到 ad。 */
export function posUnits(pos) {
  const key = String(pos ?? '').toLowerCase();
  return memo(posCache, key, () => {
    const units = key.match(/(?:adv|modal|prep|conj|pron|art|num|int|aux|vt|vi|ad|n|v|a)/g) || [];
    return new Set(units.map((u) => (u === 'vt' || u === 'vi' ? 'v' : (u === 'adv' || u === 'adj' ? 'ad' : u))));
  });
}

/** 词性相似度：1 有交集，0.5 都没写，0 不同。 */
export function posMatch(posA, posB) {
  const a = posUnits(posA);
  const b = posUnits(posB);
  if (!a.size && !b.size) return 0.5;
  if (!a.size || !b.size) return 0.35;
  for (const unit of a) if (b.has(unit)) return 1;
  return 0;
}

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

/** Damerau-Levenshtein（含相邻字符交换），按 code point 计算。 */
export function damerauLevenshtein(a, b) {
  const s = [...String(a)];
  const t = [...String(b)];
  const rows = s.length + 1;
  const cols = t.length + 1;
  const dp = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[rows - 1][cols - 1];
}

/** 同词族：长词以短词开头且只多一个后缀（adapt / adaptation）。 */
function sameFamily(a, b) {
  if (a.length === b.length) return false;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length < 4) return false;
  if (!long.startsWith(short)) return false;
  const suffix = long.slice(short.length);
  return /^(?:s|es|ed|ing|er|est|ly|tion|sion|ation|ition|ment|ness|ity|ive|al|ous|ic|ist|ism|ize|ise|y)$/.test(suffix)
    || suffix.length <= 3;
}

/** 形近分 0..1。越接近 1 越像。a/b 可以是词条对象，也可以直接是字符串。 */
export function orthoScore(a, b) {
  const ax = typeof a === 'string' ? { word: a, pos: '' } : a;
  const bx = typeof b === 'string' ? { word: b, pos: '' } : b;
  const x = normalizeWord(wordOf(ax));
  const y = normalizeWord(wordOf(bx));
  if (!x || !y) return 0;
  if (x === y) return 1;
  const maxLen = Math.max(x.length, y.length);
  const dist = damerauLevenshtein(x, y);
  const edit = 1 - dist / maxLen;
  const prefix = Math.min(commonPrefix(x, y), 4) / 4;
  const suffix = Math.min(commonSuffix(x, y), 3) / 3;
  const length = 1 - Math.abs(x.length - y.length) / maxLen;
  const family = sameFamily(x, y) ? 1 : 0;
  const score = 0.55 * edit + 0.2 * prefix + 0.1 * suffix + 0.15 * length
    + 0.15 * posMatch(ax.pos, bx.pos) + 0.15 * family;
  return Math.max(0, Math.min(1, score));
}

function charSet(text) {
  return memo(charsCache, String(text), () => new Set([...String(text)].filter((ch) => ch && !/\s/.test(ch))));
}

function bigramSet(text) {
  return memo(bigramsCache, String(text), () => {
    const chars = [...String(text)];
    const out = new Set();
    for (let i = 0; i < chars.length - 1; i += 1) out.add(chars[i] + chars[i + 1]);
    return out;
  });
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

/** 释义相似分 0..1。短释义靠汉字重合，长释义再算二元组。 */
export function glossScore(a, b) {
  const ca = coreGloss(a);
  const cb = coreGloss(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const chars = jaccard(charSet(ca), charSet(cb));
  const bigrams = dice(bigramSet(ca), bigramSet(cb));
  return Math.max(0, Math.min(1, 0.7 * chars + 0.3 * bigrams));
}

/**
 * 两条释义是否“同义 / 会构成两个正确答案”。
 * 完全相等、互相包含、或相似分 >= 0.6 都算。
 */
export function isAmbiguous(a, b) {
  const ca = coreGloss(a);
  const cb = coreGloss(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.length >= 2 && cb.length >= 2 && (ca.includes(cb) || cb.includes(ca))) return true;
  return glossScore(a, b) >= 0.6;
}

/** 词形是否可用于出题/选项。 */
export function isValidWord(word) {
  const w = String(word ?? '');
  if (!w || w !== w.trim()) return false;
  if (!WORD_RE.test(w)) return false;
  if (IPA.test(w) || PRIVATE.test(w) || BAD_CHARS.test(w)) return false;
  return true;
}

export function isValidEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!isValidWord(wordOf(entry))) return false;
  return coreGloss(meaningOf(entry)).length > 0;
}

function weightOf(kind, score) {
  if (kind === 'gloss') {
    // 目标相似度 0.35：越接近越容易被抽中，但不会只取最高的
    return 1 / (0.05 + Math.abs(score - 0.35)) ** 2;
  }
  return Math.max(0.01, score) ** 2;
}

function weightedSample(list, count, weightFn, rng) {
  const pool = [...list];
  const picked = [];
  while (picked.length < count && pool.length) {
    const weights = pool.map((item) => Math.max(1e-9, weightFn(item)));
    const total = weights.reduce((sum, n) => sum + n, 0);
    let target = rng() * total;
    let index = 0;
    for (; index < pool.length; index += 1) {
      target -= weights[index];
      if (target <= 0) break;
    }
    if (index >= pool.length) index = pool.length - 1;
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function optionKey(mode, entry) {
  return mode === 'en_zh' ? coreGloss(meaningOf(entry)) : normalizeWord(wordOf(entry));
}

function canTake(mode, entry, taken) {
  const key = optionKey(mode, entry);
  if (!key || taken.has(key)) return false;
  if (mode === 'en_zh') {
    // 选项是中文释义：两个干扰项不能几乎同义
    for (const prev of taken.values()) {
      if (glossScore(meaningOf(prev), meaningOf(entry)) >= 0.7) return false;
    }
  }
  return true;
}

/**
 * 选干扰项。
 * @param {object} correct 正确词条，需有 word/meaning（或 w/m）与 pos
 * @param {object[]} pool 候选池（同词库，已排除屏蔽词）
 * @param {'en_zh'|'zh_en'} mode 看英选汉 / 看汉选英
 * @param {{count?:number, rng?:()=>number, difficulty?:'easy'|'medium'|'hard'}} options
 * @returns {object[]} 最多 count 个干扰项，不含正确答案
 */
export function pickDistractors(correct, pool, mode = 'en_zh', options = {}) {
  const { count = 3, rng = Math.random, difficulty = 'medium' } = options;
  if (!correct || !Array.isArray(pool) || (mode !== 'en_zh' && mode !== 'zh_en')) return [];
  if (count <= 0) return [];

  const correctId = idOf(correct);
  const correctWord = normalizeWord(wordOf(correct));
  const correctMeaning = meaningOf(correct);
  if (!correctWord || !isValidEntry(correct)) return [];

  // 硬过滤：本题、同词、坏数据、同义/释义重合
  const candidates = pool.filter((entry) => {
    if (!entry || entry === correct) return false;
    if (correctId != null && idOf(entry) === correctId) return false;
    if (normalizeWord(wordOf(entry)) === correctWord) return false;
    if (!isValidEntry(entry)) return false;
    if (isAmbiguous(correctMeaning, meaningOf(entry))) return false;
    return true;
  });
  if (!candidates.length) return [];

  // 形近候选（同时要求词性不完全冲突）
  const ortho = [];
  for (const entry of candidates) {
    const score = orthoScore(correct, entry);
    if (score >= 0.4 && posMatch(correct.pos, entry.pos) > 0) {
      ortho.push({ entry, score });
    }
  }
  ortho.sort((a, b) => b.score - a.score);

  // 形近权重：easy 偏不相似，hard 偏相似
  const orthoWeight = (item) => {
    if (difficulty === 'easy') return Math.max(0.05, 1 - item.score);
    if (difficulty === 'hard') return Math.max(0.01, item.score) ** 3;
    return weightOf('ortho', item.score);
  };

  const picked = [];
  const taken = new Map();

  const take = (entry) => {
    if (!canTake(mode, entry, taken)) return false;
    picked.push(entry);
    taken.set(optionKey(mode, entry), entry);
    return true;
  };

  // 看英选汉：2 个形近词的释义 + 1 个释义相近但不同义的词
  if (mode === 'en_zh') {
    const orthoPicked = weightedSample(
      ortho.filter((item) => !isAmbiguous(correctMeaning, meaningOf(item.entry))),
      Math.min(2, count),
      orthoWeight,
      rng,
    );
    for (const item of orthoPicked) take(item.entry);

    if (picked.length < count) {
      const glossCandidates = candidates
        .filter((entry) => {
          if (normalizeWord(wordOf(entry)) === correctWord) return false;
          const score = glossScore(correctMeaning, meaningOf(entry));
          return score >= 0.2 && score <= 0.5 && !isAmbiguous(correctMeaning, meaningOf(entry));
        })
        .map((entry) => ({ entry, score: glossScore(correctMeaning, meaningOf(entry)) }))
        .sort((a, b) => Math.abs(a.score - 0.35) - Math.abs(b.score - 0.35));
      const glossPicked = weightedSample(glossCandidates, 1, (item) => weightOf('gloss', item.score), rng);
      for (const item of glossPicked) take(item.entry);
    }
  } else {
    // 看汉选英：全部用形近词
    const orthoPicked = weightedSample(
      ortho.filter((item) => !isAmbiguous(correctMeaning, meaningOf(item.entry))),
      count,
      orthoWeight,
      rng,
    );
    for (const item of orthoPicked) take(item.entry);
  }

  // 兜底：同词性 + 同首字母 / 同长度，最后任意合法词
  if (picked.length < count) {
    const rest = candidates
      .filter((entry) => normalizeWord(wordOf(entry)) !== correctWord)
      .filter((entry) => ![...taken.values()].includes(entry))
      .sort((a, b) => {
        const posA = posMatch(correct.pos, a.pos);
        const posB = posMatch(correct.pos, b.pos);
        if (posA !== posB) return posB - posA;
        const firstA = wordOf(a)[0]?.toLowerCase() === wordOf(correct)[0]?.toLowerCase() ? 1 : 0;
        const firstB = wordOf(b)[0]?.toLowerCase() === wordOf(correct)[0]?.toLowerCase() ? 1 : 0;
        if (firstA !== firstB) return firstB - firstA;
        return Math.abs(wordOf(a).length - wordOf(correct).length) - Math.abs(wordOf(b).length - wordOf(correct).length);
      });
    for (const entry of rest) {
      if (picked.length >= count) break;
      take(entry);
    }
  }

  return picked;
}