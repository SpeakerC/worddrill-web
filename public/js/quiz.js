/** 出题逻辑，与 Android 版 QuizEngine 一致。纯函数，浏览器与 Node 共用。 */

import { pickDistractors } from './confuse.js';

export const OPTION_COUNT = 4;

export const MODES = {
  en_zh: { label: '英译汉', desc: '看英文，从四个中文释义中选' },
  zh_en: { label: '汉译英', desc: '看中文，从四个英文单词中选' },
  spell: { label: '单词默写', desc: '看中文，自己拼写英文' },
  listen: { label: '听音拼写', desc: '听发音，自己拼出英文单词' },
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

export function makeItem(word, allWords, mode, rng = Math.random) {
  const text = word.word ?? word.w;
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
      spell: true,
      listen,
      hint: hint(text),
    };
  }
  const correct = mode === 'en_zh' ? meaningOf(word) : text;
  const distractors = pickDistractors(word, allWords, mode, { rng, count: OPTION_COUNT - 1 });
  const values = distractors.map((entry) => (mode === 'en_zh'
    ? meaningOf(entry)
    : String(entry.word ?? entry.w)));
  const options = shuffled([...new Set([correct, ...values])], rng);
  return {
    wordId: word.id,
    word: text,
    meaning: meaningOf(word),
    starred: Boolean(word.starred),
    prompt: mode === 'en_zh' ? text : meaningOf(word),
    answer: correct,
    options,
    correctOption: options.indexOf(correct),
    spell: false,
    listen: false,
    hint: '',
  };
}

export function buildItems(words, allWords, count, mode, rng = Math.random) {
  if (!Array.isArray(words) || words.length === 0 || count <= 0) return [];
  const seen = new Set();
  const picked = [];
  for (const word of shuffled(words, rng)) {
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
  return picked.map((word) => makeItem(word, pool, mode, rng));
}
