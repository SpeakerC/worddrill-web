/** 出题逻辑，与 Android 版 QuizEngine 一致。纯函数，浏览器与 Node 共用。 */

import { pickDistractors } from './confuse.js';

export const OPTION_COUNT = 4;

export const MODES = {
  en_zh: { label: '英译汉', desc: '看英文，从四个中文释义中选' },
  zh_en: { label: '汉译英', desc: '看中文，从四个英文单词中选' },
  spell: { label: '单词默写', desc: '看中文，自己拼写英文' },
  listen: { label: '听音拼写', desc: '听发音，自己拼出英文单词' },
  ex_spell: { label: '例句填词', desc: '看中文句意，填出例句里挖掉的单词' },
};

/** 需要出声的练习方式：英译汉（看词听音）和听音拼写。 */
export const HEARING_MODES = new Set(['en_zh', 'listen']);

export function normalize(input) {
  return String(input == null ? '' : input)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isCorrect(input, answer) {
  const value = normalize(input);
  return value.length > 0 && value === normalize(answer);
}

/** 除主答案外还接受其他写法（例句填词：原形和变形都算对）。 */
export function isAcceptable(input, answer, accept = []) {
  if (isCorrect(input, answer)) return true;
  return (Array.isArray(accept) ? accept : []).some((item) => isCorrect(input, item));
}

/** 拼写提示：每个单词（空格/连字符分隔）首字母 + 下划线，空格显示为 /。 */
export function hint(answer) {
  const text = String(answer);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (i > 0) out += ' ';
    const ch = text[i];
    const isWordStart = i === 0 || text[i - 1] === ' ' || text[i - 1] === '-';
    if (ch === ' ') out += '/';
    else if (ch === '-') out += '-';
    else if (isWordStart) out += ch;
    else out += '_';
  }
  return out;
}

/** 取词条例句：兼容拆好的 exampleEn/exampleZh 与 Android 的 ex="英文||中文"。 */
export function exampleOf(word) {
  if (!word) return { en: '', zh: '' };
  if (word.exampleEn || word.exampleZh) {
    return { en: String(word.exampleEn || '').trim(), zh: String(word.exampleZh || '').trim() };
  }
  const raw = String(word.ex || '').trim();
  const at = raw.indexOf('||');
  return at < 0
    ? { en: raw, zh: '' }
    : { en: raw.slice(0, at).trim(), zh: raw.slice(at + 2).trim() };
}

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 把例句里第一次出现的目标词（含 abandoned / leaves 这类变形）换成 ____。
 * 太短的词不挖（a / an 满篇都是）；没命中返回 null。
 */
export function blankExample(sentence, word) {
  const base = String(word || '').trim();
  const text = String(sentence || '');
  if (base.length < 3 || !text.trim()) return null;
  const match = new RegExp(`\\b${escapeRe(base)}[a-z]*\\b`, 'i').exec(text);
  if (!match) return null;
  return {
    line: `${text.slice(0, match.index)}____${text.slice(match.index + match[0].length)}`,
    token: match[0],
  };
}

export function shuffled(list, rng = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function meaningOf(word) {
  const meaning = word.meaning ?? word.m ?? '';
  return word.pos ? `${word.pos} ${meaning}` : meaning;
}

export function makeItem(word, allWords, mode, rng = Math.random, options = {}) {
  const text = word.word ?? word.w;
  if (mode === 'ex_spell') {
    const example = exampleOf(word);
    const blank = blankExample(example.en, text);
    if (!blank) return makeItem(word, allWords, 'en_zh', rng, options);
    return {
      wordId: word.id,
      word: text,
      meaning: meaningOf(word),
      starred: Boolean(word.starred),
      prompt: `${example.zh || '把这句话补完整'}\n${blank.line}`,
      answer: blank.token,
      accept: [text],
      options: [],
      correctOption: -1,
      optionMeanings: [],
      spell: true,
      listen: false,
      longPrompt: true,
      hint: hint(blank.token),
    };
  }
  if (mode === 'spell' || mode === 'listen') {
    const listen = mode === 'listen';
    return {
      wordId: word.id,
      word: text,
      meaning: meaningOf(word),
      starred: Boolean(word.starred),
      // 听音拼写不显示中文，题面只放一句提示
      prompt: listen ? '点这里再听一遍' : meaningOf(word),
      answer: text,
      options: [],
      correctOption: -1,
      optionMeanings: [],
      spell: true,
      listen,
      hint: hint(text),
    };
  }
  const correct = mode === 'en_zh' ? meaningOf(word) : text;
  const distractors = pickDistractors(word, allWords, mode, {
    rng,
    count: OPTION_COUNT - 1,
    vary: Boolean(options.vary),
  });
  const pairs = [
    { value: correct, meaning: meaningOf(word) },
    ...distractors.map((entry) => ({
      value: mode === 'en_zh' ? meaningOf(entry) : String(entry.word ?? entry.w),
      meaning: meaningOf(entry),
    })),
  ];
  // 释义/词形重复的候选只留第一条，保证四个选项互不重复
  const seen = new Set();
  const unique = [];
  for (const pair of pairs) {
    if (seen.has(pair.value)) continue;
    seen.add(pair.value);
    unique.push(pair);
  }
  const ordered = shuffled(unique, rng);
  const optionValues = ordered.map((pair) => pair.value);
  return {
    wordId: word.id,
    word: text,
    meaning: meaningOf(word),
    starred: Boolean(word.starred),
    prompt: mode === 'en_zh' ? text : meaningOf(word),
    answer: correct,
    options: optionValues,
    correctOption: optionValues.indexOf(correct),
    // 汉译英答对后可展示其余选项的中文，英译汉的选项本身就是释义
    optionMeanings: ordered.map((pair) => (mode === 'zh_en' ? pair.meaning : '')),
    spell: false,
    listen: false,
    hint: '',
  };
}

export function buildItems(words, allWords, count, mode, rng = Math.random, options = {}) {
  if (!Array.isArray(words) || words.length === 0 || count <= 0) return [];
  const eligible = mode === 'ex_spell'
    ? words.filter((word) => blankExample(exampleOf(word).en, word.word ?? word.w))
    : words;
  if (!eligible.length) return [];
  const seen = new Set();
  const picked = [];
  for (const word of shuffled(eligible, rng)) {
    if (seen.has(word.id)) continue;
    seen.add(word.id);
    picked.push(word);
    if (picked.length >= count) break;
  }
  // 干扰项只从本题涉及的词库里取：新练习 = 当前词库；跨库复习 = 涉及的几本
  const bookIds = new Set(picked.map((word) => word.bookId).filter((id) => id != null));
  const pool = Array.isArray(allWords)
    ? (bookIds.size ? allWords.filter((w) => bookIds.has(w.bookId)) : allWords)
    : [];
  return picked.map((word) => makeItem(word, pool, mode, rng, options));
}
