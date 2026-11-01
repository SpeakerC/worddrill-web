'use strict';

/** 出题逻辑，与 Android 版 QuizEngine 一致。 */

const OPTION_COUNT = 4;

const MODES = {
  en_zh: { label: '英译汉', desc: '看英文，从四个中文释义中选' },
  zh_en: { label: '汉译英', desc: '看中文，从四个英文单词中选' },
  spell: { label: '单词默写', desc: '看中文，自己拼写英文' },
};

function normalize(input) {
  return String(input == null ? '' : input)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isCorrect(input, answer) {
  const value = normalize(input);
  return value.length > 0 && value === normalize(answer);
}

/** 拼写提示：每个单词（空格/连字符分隔）首字母 + 下划线，空格显示为 /。 */
function hint(answer) {
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

function shuffled(list, rng = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function meaningOf(word) {
  return word.pos ? `${word.pos} ${word.meaning}` : word.meaning;
}

function buildOptions(correct, allWords, selector, rng) {
  const seen = new Set();
  const candidates = [];
  for (const word of allWords) {
    const value = selector(word);
    if (!value || value === correct || seen.has(value)) continue;
    seen.add(value);
    candidates.push(value);
  }
  const distractors = candidates.length <= OPTION_COUNT - 1
    ? candidates
    : shuffled(candidates, rng).slice(0, OPTION_COUNT - 1);
  return shuffled([...distractors, correct], rng);
}

function makeItem(word, allWords, mode, rng = Math.random) {
  if (mode === 'spell') {
    return {
      wordId: word.id,
      word: word.word,
      meaning: meaningOf(word),
      starred: Boolean(word.starred),
      prompt: meaningOf(word),
      answer: word.word,
      options: [],
      correctOption: -1,
      spell: true,
      hint: hint(word.word),
    };
  }
  const correct = mode === 'en_zh' ? meaningOf(word) : word.word;
  const options = buildOptions(correct, allWords, mode === 'en_zh' ? meaningOf : (w) => w.word, rng);
  return {
    wordId: word.id,
    word: word.word,
    meaning: meaningOf(word),
    starred: Boolean(word.starred),
    prompt: mode === 'en_zh' ? word.word : meaningOf(word),
    answer: correct,
    options,
    correctOption: options.indexOf(correct),
    spell: false,
    hint: '',
  };
}

function buildItems(words, allWords, count, mode, rng = Math.random) {
  if (!Array.isArray(words) || words.length === 0 || count <= 0) return [];
  const seen = new Set();
  const picked = [];
  for (const word of shuffled(words, rng)) {
    if (seen.has(word.id)) continue;
    seen.add(word.id);
    picked.push(word);
    if (picked.length >= count) break;
  }
  return picked.map((word) => makeItem(word, allWords, mode, rng));
}

module.exports = { OPTION_COUNT, MODES, normalize, isCorrect, hint, buildItems, makeItem, shuffled, meaningOf };
